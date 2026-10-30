// Everything the API (and other services, through /internal) can do with files.
// Adapted from the POC's media-service: same inspection, all-or-nothing batches,
// key layout and headers, with tbl_files as the index instead of MinIO listings.
//
// The caller passes a context { userId, zoduId, branchId, ip } that comes from
// the verified token (or a trusted internal caller), never from the request body.
// Every ownership failure is a 404 so file ids can't be probed.

const crypto = require('crypto');
const path = require('path');
const { FILE_TYPES, MAX_FILES_PER_UPLOAD, getModule } = require('../storage/modules');
const { inspectFile } = require('../storage/file-inspector');
const { transformFile } = require('../storage/transform');
const { onScan } = require('../storage/scan');
const { buildKey, assertKeyBelongsTo, httpError } = require('../storage/key-builder');
const { NotFoundError, ValidationError } = require('../utils/error/errors');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isFileId = (v) => typeof v === 'string' && UUID.test(v);

function createFileService({ repo, storage, config }) {
  const { internal, signer, bucket } = storage;
  const { PRESIGNED_URL_TTL, PUBLIC_FILE_BASE_URL } = config;

  // ── context helpers ──────────────────────────────────────────────────────
  // Branch modules need a branch; tenant modules live in _shared (branch null).
  function scopeFor(ctx, mod) {
    if (mod.scope === 'tenant') return null;
    if (!ctx.branchId) throw ValidationError('X-Branch-Id header is required for this module');
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
        const key = buildKey({ zoduId: ctx.zoduId, branchId, module, entityId, category, mimeType: out.mime });
        const ready = { buffer: out.buffer, mime: out.mime, size: out.buffer.length, name, module };
        await onScan(ready);
        checked.push({ ...ready, key, fileId: crypto.randomUUID() });
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
        zodu_id: ctx.zoduId,
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
    const ids = [...new Set(fileIds.filter(isFileId).map((s) => s.toLowerCase()))];
    if (!ids.length) return [];
    const byId = new Map((await repo.findReadyMany(ids)).map((r) => [r.file_id, r]));
    return ids.map((id) => byId.get(id)).filter((row) => canSee(ctx, row));
  }

  // Force the safe headers on the link itself, whatever is stored on the object.
  async function presign(row, { download = false } = {}) {
    return signer.presignedGetObject(bucket, row.object_key, PRESIGNED_URL_TTL, {
      'response-content-type':        row.mime_type,
      'response-content-disposition': contentDisposition(row.mime_type, row.original_name, download),
    });
  }

  const stableUrl = (row) => `${PUBLIC_FILE_BASE_URL}/files/v/${row.file_id}`;
  const contentUrl = (row) => `${PUBLIC_FILE_BASE_URL}/files/${row.file_id}/content`;
  const isLink = (row) => getModule(row.module).access === 'link';
  const isStreamOnly = (row) => Boolean(getModule(row.module).streamOnly);
  const expiresIn = (row) => (isLink(row) || isStreamOnly(row) ? null : PRESIGNED_URL_TTL);

  // 'link' files: their permanent cacheable URL. Stream-only files: the
  // authorised /content URL (needs the Authorization header). Other private
  // files: a presigned URL.
  function urlFor(row) {
    if (isLink(row)) return stableUrl(row);
    if (isStreamOnly(row)) return contentUrl(row);
    return presign(row);
  }

  // Issuing a presigned URL counts as a download; a /content URL is logged when it is used.
  const logIssued = (ctx, rows, action) => logPrivate(ctx, rows.filter((row) => !isStreamOnly(row)), action);

  async function getDownloadUrl(ctx, row, { download = false } = {}) {
    const url = isStreamOnly(row)
      ? `${contentUrl(row)}${download ? '?download=1' : ''}`
      : await presign(row, { download });
    await logIssued(ctx, [row], 'url');
    return { file_id: row.file_id, url, mime_type: row.mime_type, expires_in_seconds: expiresIn(row) };
  }

  async function urlsFor(ctx, rows, action) {
    const out = await Promise.all(rows.map(async (row) => ({
      file_id: row.file_id,
      module: row.module,
      mime_type: row.mime_type,
      original_name: row.original_name,
      url: await urlFor(row),
      expires_in_seconds: expiresIn(row),
    })));
    await logIssued(ctx, rows, action);
    return out;
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

  // GET /files/v/:fileId — 'link' modules only, no auth. The unguessable UUID is
  // the protection, which is why private modules answer 404 here.
  async function streamPublic(fileId, res) {
    if (!isFileId(fileId)) throw NotFoundError();
    const row = await repo.findReady(fileId);
    if (!row || !isLink(row)) throw NotFoundError();
    const stream = await openObject(row);
    sendHeaders(res, row);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    // <img> from the web app, Electron and invoice templates on other origins.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
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
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Even if a file were misdetected, the browser must not run it as a page.
    // PDFs are the exception: Chrome's viewer won't open under a sandbox, and
    // PDFs were already checked for scripts on upload.
    if (type === 'application/pdf') res.removeHeader('Content-Security-Policy');
    else res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
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

  return {
    uploadMany, getAuthorisedFile, getAuthorisedFiles, getDownloadUrl, urlsFor,
    listEntityFiles, streamFile, streamPublic, deleteFile, deleteEntityFiles, isFileId,
  };
}

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
