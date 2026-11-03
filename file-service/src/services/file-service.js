// Everything the API (and other services, through /internal) can do with files.
// Adapted from the POC's media-service: same inspection, all-or-nothing batches,
// key layout and headers, with tbl_files as the index instead of MinIO listings.
//
// The caller passes a context { userId, zoduId, branchId, ip } that comes from
// the verified token (or a trusted internal caller), never from the request body.
// Every ownership failure is a 404 so file ids can't be probed.

const crypto = require('crypto');
const path = require('path');
const { FILE_TYPES, MAX_FILES_PER_UPLOAD, STAGING, getModule } = require('../storage/modules');
const { inspectFile } = require('../storage/file-inspector');
const { transformFile, imageNeedsTransform } = require('../storage/transform');
const { onScan } = require('../storage/scan');
const { buildKey, assertKeyBelongsTo, httpError } = require('../storage/key-builder');
const { NotFoundError, ValidationError } = require('../utils/error/errors');
const { fileResponseHeaders } = require('../utils/file-headers');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isFileId = (v) => typeof v === 'string' && UUID.test(v);

function createFileService({ repo, storage, config, links }) {
  const { internal, signer, bucket } = storage;
  const { PRESIGNED_URL_TTL, PUBLIC_FILE_BASE_URL, FILE_LINKS_UNSIGNED } = config;

  // ── context helpers ──────────────────────────────────────────────────────
  // Branch modules need a branch; tenant modules live in _shared (branch null).
  function scopeFor(ctx, mod) {
    if (mod.scope === 'tenant' || mod.scope === 'staging') return null;
    if (!ctx.branchId) throw ValidationError('A branch is required for this module');
    return ctx.branchId;
  }

  function canSee(ctx, row) {
    if (!row || row.zodu_id !== ctx.zoduId) return false;
    if (row.branch_id !== null && row.branch_id !== ctx.branchId) return false;
    try {
      assertKeyBelongsTo(row.object_key, ctx);   // defence in depth: the key must agree with the row
      return true;
    } catch {
      return false;
    }
  }

  // ── upload ───────────────────────────────────────────────────────────────
  // Several files for one record. All-or-nothing: every file is checked first,
  // and if any is rejected nothing is stored. If storing fails half way, the
  // objects already written are removed again; same if the DB insert fails.
  async function uploadMany(ctx, { module, entityId, category, files }) {
    if (!files?.length) throw httpError(400, 'At least one file is required (multipart field "files")');
    if (files.length > MAX_FILES_PER_UPLOAD) {
      throw httpError(400, `Too many files: at most ${MAX_FILES_PER_UPLOAD} per upload`);
    }
    const mod = getModule(module);
    const branchId = scopeFor(ctx, mod);
    // Staged uploads may come from a caller with no verified tenant (the old
    // anonymous /upload routes); they are filed under "anon" until claimed.
    const staging = module === STAGING;
    if (staging) entityId = ctx.zoduId || 'anon';

    const checked = [];
    const errors = [];
    for (const file of files) {
      const name = safeFileName(file.originalname);
      try {
        if (file.size > mod.maxSizeMb * 1024 * 1024) {
          throw httpError(413, `File exceeds ${mod.maxSizeMb}MB limit for module "${module}"`);
        }
        const { mime: detected } = inspectFile(file.buffer, name);
        // Fail fast on a type the module refuses, before spending CPU on a transform.
        buildKey({ zoduId: ctx.zoduId, branchId, module, entityId, category, mimeType: detected });

        let out;
        try {
          out = await transformFile(file.buffer, detected, mod.transform);
        } catch {
          throw httpError(422, 'Image could not be processed (damaged or too large)');
        }
        // Key from the final type: a transform may have turned a PNG into WEBP.
        const fileId = crypto.randomUUID();
        const key = buildKey({ zoduId: ctx.zoduId, branchId, module, entityId, category, mimeType: out.mime, fileId });
        const ready = { buffer: out.buffer, mime: out.mime, size: out.buffer.length, name: nameFor(name, out.mime), module };
        await onScan(ready);
        checked.push({ ...ready, key, fileId });
      } catch (err) {
        if (!err.status) throw err;
        errors.push({ file: name, status: err.status, error: err.message });
      }
    }
    if (errors.length) {
      const status = errors.every((e) => e.status === errors[0].status) ? errors[0].status : 422;
      throw Object.assign(
        httpError(status, `${errors.length} of ${files.length} file(s) rejected; nothing was uploaded`),
        { details: errors },
      );
    }

    const stored = [];
    try {
      for (const f of checked) {
        // One putObject call. The "folders" in the key appear automatically.
        // Header values must be ASCII, so the original name is percent-encoded.
        await internal.putObject(bucket, f.key, f.buffer, f.size, {
          'Content-Type':        f.mime,
          'Content-Disposition': contentDisposition(f.mime, f.name),
          'X-Amz-Meta-Original-Name': encodeURIComponent(f.name),
          'X-Amz-Meta-File-Id':       f.fileId,
          'X-Amz-Meta-Uploaded-By':   String(ctx.userId || ''),
        });
        stored.push(f.key);
      }
      const rows = await repo.insertFiles(checked.map((f) => ({
        file_id: f.fileId,
        zodu_id: ctx.zoduId || STAGING_OWNER,
        branch_id: branchId,
        module,
        category: category || null,
        entity_id: entityId,
        object_key: f.key,
        mime_type: f.mime,
        size_bytes: f.size,
        original_name: f.name,
        uploaded_by: ctx.userId || null,
      })));
      return Promise.all(rows.map(async (row) => ({
        file_id: row.file_id,
        original_name: row.original_name,
        mime_type: row.mime_type,
        size_kb: Math.round(Number(row.size_bytes) / 1024),
        url: await urlFor(row),
      })));
    } catch (err) {
      if (stored.length) await internal.removeObjects(bucket, stored).catch(() => {});
      throw err;
    }
  }

  // ── read ─────────────────────────────────────────────────────────────────
  async function getAuthorisedFile(ctx, fileId) {
    if (!isFileId(fileId)) throw NotFoundError();
    const row = await repo.findReady(fileId);
    if (!canSee(ctx, row)) throw NotFoundError();
    return row;
  }

  // Ids the caller may see, in request order; foreign, deleted and unknown ids are left out.
  async function getAuthorisedFiles(ctx, fileIds) {
    return (await getRows(fileIds)).filter((row) => canSee(ctx, row));
  }

  // Force the safe headers on the link itself, whatever is stored on the object.
  async function presign(row, { download = false } = {}) {
    return signer.presignedGetObject(bucket, row.object_key, PRESIGNED_URL_TTL, {
      'response-content-type':        row.mime_type,
      'response-content-disposition': contentDisposition(row.mime_type, row.original_name, download),
    });
  }

  // /files/v/:id with an expiring signature. The services store it without
  // (they strip ?exp=&sig= on save) and sign it again on every response.
  const stableUrl = (row) => links.sign(`${PUBLIC_FILE_BASE_URL}/files/v/${row.file_id}`);
  const contentUrl = (row) => `${PUBLIC_FILE_BASE_URL}/files/${row.file_id}/content`;
  const isLink = (row) => getModule(row.module).access === 'link';
  const isStreamOnly = (row) => Boolean(getModule(row.module).streamOnly);
  const expiresIn = (row) => (isStreamOnly(row) ? null : PRESIGNED_URL_TTL);

  // 'link' files: their permanent cacheable URL. Stream-only files: the
  // authorised /content URL (needs the Authorization header). Other private
  // files: a presigned URL.
  //
  // presignStreamOnly: /internal/resolve fills the old URL fields of clients
  // that can't send an Authorization header with a link yet (Phase 2), so
  // stream-only files get a presigned URL there too. Drop it once clients
  // use *_file_id with /files/:id/content.
  function urlFor(row, { presignStreamOnly = false } = {}) {
    if (isLink(row)) return stableUrl(row);
    if (isStreamOnly(row) && !presignStreamOnly) return contentUrl(row);
    return presign(row);
  }

  // Issuing a presigned URL counts as a download; a /content URL is logged when it is used.
  const logIssued = (ctx, rows, action, { presignStreamOnly = false } = {}) =>
    logPrivate(ctx, presignStreamOnly ? rows : rows.filter((row) => !isStreamOnly(row)), action);

  async function getDownloadUrl(ctx, row, { download = false } = {}) {
    const url = isStreamOnly(row)
      ? `${contentUrl(row)}${download ? '?download=1' : ''}`
      : await presign(row, { download });
    await logIssued(ctx, [row], 'url');
    return { file_id: row.file_id, url, mime_type: row.mime_type, expires_in_seconds: expiresIn(row) };
  }

  async function urlsFor(ctx, rows, action, opts = {}) {
    const out = await Promise.all(rows.map(async (row) => {
      const expiring = isLink(row) || !isStreamOnly(row) || Boolean(opts.presignStreamOnly);
      return {
        file_id: row.file_id,
        module: row.module,
        mime_type: row.mime_type,
        original_name: row.original_name,
        url: await urlFor(row, opts),
        expires_in_seconds: expiring ? PRESIGNED_URL_TTL : null,
      };
    }));
    await logIssued(ctx, rows, action, opts);
    return out;
  }

  // ── claim ────────────────────────────────────────────────────────────────
  // Moves staged uploads into the record that now uses them:
  //   _staging/uploads/...  →  {zoduId}/{branchId}/{module}/{entityId}/...
  // The file_id stays the same, so a stable /files/v/:id link keeps working
  // for link modules. Idempotent: a file already in this record is returned
  // as is (saving a record twice re-sends the same ids). Ids that are neither
  // staged nor this record's, or belong to another tenant, are left out.
  async function claim(ctx, { module, entityId, category, fileIds }) {
    const mod = getModule(module);
    if (mod.internalOnly) throw httpError(400, `Files can't be claimed into "${module}"`);
    const branchId = scopeFor(ctx, mod);
    const rows = await getRows(fileIds);

    const out = [];
    for (const row of rows) {
      const already = row.module === module && row.entity_id === entityId
        && row.zodu_id === ctx.zoduId && row.branch_id === branchId;
      if (already) { out.push(row); continue; }

      const staged = row.module === STAGING && (row.zodu_id === ctx.zoduId || row.zodu_id === STAGING_OWNER);
      if (!staged) continue;

      if (!mod.allowedTypes.includes(row.mime_type)) {
        throw httpError(415, `"${row.original_name}" (${FILE_TYPES[row.mime_type]?.ext || row.mime_type}) is not allowed for ${module}`);
      }
      if (Number(row.size_bytes) > mod.maxSizeMb * 1024 * 1024) {
        throw httpError(413, `"${row.original_name}" exceeds the ${mod.maxSizeMb}MB limit for ${module}`);
      }
      // Re-encoded only when this module wants the picture smaller or in another
      // format (a staged upload saved into a menu item); otherwise copied as is.
      const reencoded = await reencodeFor(mod, row);
      const mime = reencoded?.mime || row.mime_type;
      const key = buildKey({
        zoduId: ctx.zoduId, branchId, module, entityId, category, mimeType: mime, fileId: row.file_id,
      });
      if (reencoded) {
        const name = nameFor(row.original_name, mime);
        await internal.putObject(bucket, key, reencoded.buffer, reencoded.buffer.length, {
          'Content-Type':        mime,
          'Content-Disposition': contentDisposition(mime, name),
          'X-Amz-Meta-Original-Name': encodeURIComponent(name),
          'X-Amz-Meta-File-Id':       row.file_id,
        });
      } else {
        await internal.copyObject(bucket, key, `/${bucket}/${row.object_key}`);
      }
      let moved;
      try {
        moved = await repo.reassign(row.file_id, {
          zodu_id: ctx.zoduId, branch_id: branchId, module, category: category || null, entity_id: entityId, object_key: key,
          ...(reencoded && {
            mime_type: mime, size_bytes: reencoded.buffer.length, original_name: nameFor(row.original_name, mime),
          }),
        });
      } catch (err) {
        await internal.removeObject(bucket, key).catch(() => {});
        throw err;
      }
      if (!moved) {   // claimed by a concurrent request in the meantime
        await internal.removeObject(bucket, key).catch(() => {});
        continue;
      }
      await internal.removeObject(bucket, row.object_key).catch(() => {});
      out.push(moved);
    }
    return urlsFor(ctx, out, 'claim');
  }

  async function reencodeFor(mod, row) {
    const opts = mod.transform?.image;
    if (!opts || !row.mime_type.startsWith('image/')) return null;
    const buffer = await readObject(row.object_key);
    if (!(await imageNeedsTransform(buffer, row.mime_type, opts))) return null;
    try {
      return await transformFile(buffer, row.mime_type, { image: opts });
    } catch {
      throw httpError(422, `"${row.original_name}" could not be processed`);
    }
  }

  async function readObject(key) {
    const chunks = [];
    for await (const chunk of await internal.getObject(bucket, key)) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  async function getRows(fileIds) {
    const ids = [...new Set(fileIds.filter(isFileId).map((s) => s.toLowerCase()))];
    if (!ids.length) return [];
    const byId = new Map((await repo.findReadyMany(ids)).map((r) => [r.file_id, r]));
    return ids.map((id) => byId.get(id)).filter(Boolean);
  }

  async function listEntityFiles(ctx, { module, entityId }) {
    const mod = getModule(module);
    const rows = await repo.listEntity({
      zodu_id: ctx.zoduId, branch_id: scopeFor(ctx, mod), module, entity_id: entityId,
    });
    const urls = await Promise.all(rows.map(urlFor));
    await logIssued(ctx, rows, 'url');
    return rows.map((row, i) => ({ ...toDto(row), url: urls[i] }));
  }

  // Through the API (POC streamFile): required for 'employee', allowed for every module.
  async function streamFile(ctx, row, res, { download = false } = {}) {
    const stream = await openObject(row);
    sendHeaders(res, row, { download });
    await logPrivate(ctx, [row], 'content');
    pipe(stream, res);
  }

  // GET /files/v/:fileId?exp=&sig= — 'link' modules only, no Authorization
  // header (an <img> can't send one): the signature from an API response is
  // the proof. Unsigned, expired, private or unknown → 404, so ids can't be probed.
  async function streamPublic(fileId, res, query = {}) {
    if (!isFileId(fileId)) throw NotFoundError();
    const validFor = links.checkStable(fileId, query);
    if (!validFor && !FILE_LINKS_UNSIGNED) throw NotFoundError();
    const row = await repo.findReady(fileId);
    if (!row || !isLink(row)) throw NotFoundError();
    const stream = await openObject(row);
    sendHeaders(res, row);
    res.setHeader('Cache-Control', validFor ? `private, max-age=${validFor}` : 'public, max-age=31536000, immutable');
    pipe(stream, res);
  }

  async function openObject(row) {
    try {
      return await internal.getObject(bucket, row.object_key);
    } catch (err) {
      if (err.code === 'NoSuchKey' || err.code === 'NotFound') throw NotFoundError();
      throw err;
    }
  }

  function sendHeaders(res, row, { download = false } = {}) {
    const type = row.mime_type || 'application/octet-stream';
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Length', String(row.size_bytes));
    res.setHeader('Content-Disposition', contentDisposition(type, row.original_name, download));
    fileResponseHeaders(res, type, config.FRAME_ANCESTORS);
  }

  function pipe(stream, res) {
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }

  // ── delete ───────────────────────────────────────────────────────────────
  // Soft delete. Accounting modules keep the object for good; the others are
  // removed from storage by the purge job PURGE_AFTER_DAYS later.
  async function deleteFile(ctx, row) {
    const deleted = await repo.softDelete(row.file_id);
    if (!deleted) throw NotFoundError();
    await repo.logAccess([accessEntry(ctx, deleted, 'delete')]);
    return { file_id: deleted.file_id, deleted: true };
  }

  async function deleteEntityFiles(ctx, { module, entityId }) {
    const mod = getModule(module);
    const rows = await repo.softDeleteEntity({
      zodu_id: ctx.zoduId, branch_id: scopeFor(ctx, mod), module, entity_id: entityId,
    });
    await repo.logAccess(rows.map((row) => accessEntry(ctx, row, 'delete')));
    return { module, entity_id: entityId, deleted_count: rows.length, file_ids: rows.map((r) => r.file_id) };
  }

  // ── audit ────────────────────────────────────────────────────────────────
  function accessEntry(ctx, row, action) {
    return { file_id: row.file_id, user_id: ctx.userId, zodu_id: row.zodu_id, action, ip: ctx.ip };
  }

  async function logPrivate(ctx, rows, action) {
    const priv = rows.filter((row) => !isLink(row));
    if (priv.length) await repo.logAccess(priv.map((row) => accessEntry(ctx, row, action)));
  }

  // Staged files are not anyone's yet: the service that took the upload may
  // discard one (old DELETE /delete/file/:name) as long as nothing claimed it.
  async function discardStaged(ctx, fileIds) {
    const rows = (await getRows(fileIds)).filter((row) => row.module === STAGING
      && (row.zodu_id === ctx.zoduId || row.zodu_id === STAGING_OWNER));
    for (const row of rows) await deleteFile(ctx, row);
    return rows.map((r) => r.file_id);
  }

  return {
    uploadMany, getAuthorisedFile, getAuthorisedFiles, getDownloadUrl, urlsFor, claim, discardStaged,
    listEntityFiles, streamFile, streamPublic, deleteFile, deleteEntityFiles, isFileId,
  };
}

// tbl_files.zodu_id of a staged upload whose caller had no verified tenant.
const STAGING_OWNER = '_staging';

function toDto(row) {
  return {
    file_id: row.file_id,
    module: row.module,
    category: row.category,
    entity_id: row.entity_id,
    original_name: row.original_name,
    mime_type: row.mime_type,
    size_kb: Math.round(Number(row.size_bytes) / 1024),
    created_at: row.created_at,
  };
}

// The original name is only ever shown back to users, never used in a path.
// Strip any directory part, control characters and odd lengths.
// The stored name ends in the stored type's extension (blob → blob.png,
// dosa.jpg re-encoded as WebP → dosa.webp), so downloads open in the right app.
function nameFor(name, mime) {
  const type = FILE_TYPES[mime];
  const ext = path.extname(name).slice(1).toLowerCase();
  if (!type || type.names.includes(ext)) return name;
  const base = ext ? name.slice(0, -(ext.length + 1)) : name;
  return `${base || 'file'}.${type.ext}`;
}

function safeFileName(name) {
  const base = path.basename(String(name || '').replace(/\\/g, '/'))
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f"<>|*?:]/g, '')
    .trim();
  if (!base) return 'file';
  if (base.length <= 150) return base;
  const ext = path.extname(base).slice(0, 10);
  return base.slice(0, 150 - ext.length) + ext;
}

// Images and PDFs may open in the browser; everything else (Office, CSV) is
// always a download, and so is anything asked for with ?download=1.
// ASCII fallback plus RFC 5987 UTF-8 name.
function contentDisposition(mime, name, forceDownload = false) {
  const disposition = !forceDownload && FILE_TYPES[mime]?.inline ? 'inline' : 'attachment';
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${rfc5987(name)}`;
}

function rfc5987(value) {
  return encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

module.exports = { createFileService, safeFileName, contentDisposition, isFileId };
