// Client for file-service, copied into every service as src/utils/file-client.js
// (each service builds from its own folder). Canonical copy:
// file-service/clients/file-client.js. Keep the copies identical.
//
// Services never talk to MinIO. They store file_ids (scalar *_file_id columns,
// or "file refs" inside their JSONB attachment arrays) and turn them back into
// URLs when they answer.
//
//   ctx = { zoduId, branchId, userId, clientIp }   from the request being served
//
// File refs: an attachment entry the client sent as a URL becomes
//   { ...entry, file_id, file_ctx: 'Z001/B1', url_key: 'url' }      (object entries)
//   { file_id, file_ctx: 'Z001/B1', as_string: true }               (string entries)
// and fileUrls() turns it back into the same shape with a fresh URL, so
// clients see what they always saw (plus file_id on object entries).

// Load the service's .env before the values below are read (absent in the canonical copy).
try { require('../config'); } catch { /* no config module next to this copy */ }

// This service's X-Internal-Token (INTERNAL_TOKEN) and the current request id.
const { internalHeaders } = require('@zodu/security');

const BASE = String(process.env.FILE_SERVICE_URL || 'http://file-service:4007').replace(/\/+$/, '');
const TIMEOUT_MS = 30_000;

const FILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_RE = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
// The URL forms file-service hands out, each naming the file_id:
//   .../files/v/<id>[?exp=&sig=]  link modules, staged uploads (signed in responses)
//   .../files/<id>/content       authorised stream
//   .../<key path>/<id>.<ext>?X-Amz-…   presigned (objects are named after their file_id)
const FILE_URLS = [
  new RegExp(`/files/v/${UUID_RE}(?=$|[?#])`, 'i'),
  new RegExp(`/files/${UUID_RE}/content(?=$|[?#])`, 'i'),
  new RegExp(`/${UUID_RE}\\.[a-z0-9]{2,5}\\?(?=.*X-Amz-Signature=)`, 'i'),
];
const URL_KEYS = ['url', 'fileUrl', 'file_url'];
// Stored URLs that work only signed (?exp=&sig=, expiring): /files/v/<id>
// (logo, invoice images, menu photos, staged uploads) and old URLs from before
// file-service (<origin>/<service>/file/<key>). Responses carry them signed;
// file-service refuses them unsigned.
const SIGNED_URLS = [
  new RegExp(`^https?://[^/?#]+/files/v/${UUID_RE}(?:\\?[^#]*)?$`, 'i'),
  /^https?:\/\/[^/?#]+\/(?:auth|employee|restaurant|retail|checklist)\/file\/[^?#]+(?:\?[^#]*)?$/i,
];
const isSignableUrl = (v) => typeof v === 'string' && v.length <= 2048 && SIGNED_URLS.some((re) => re.test(v));

// A request body with the signatures taken off those URLs, so a record saved
// from a response stores the plain URL it always had.
function unsignLinks(value, depth = 0) {
  if (typeof value === 'string') return isSignableUrl(value) ? value.split('?')[0] : value;
  if (!value || typeof value !== 'object' || depth > 12 || Buffer.isBuffer(value)) return value;
  if (Array.isArray(value)) return value.map((v) => unsignLinks(v, depth + 1));
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = unsignLinks(v, depth + 1);
  return out;
}

class FileServiceError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'FileServiceError';
    this.status = status;
    this.details = details;
  }
}

function headers(ctx = {}) {
  const h = internalHeaders();
  if (ctx.zoduId) h['X-Zodu-Id'] = String(ctx.zoduId);
  if (ctx.branchId) h['X-Branch-Id'] = String(ctx.branchId);
  if (ctx.userId) h['X-User-Id'] = String(ctx.userId);
  if (ctx.clientIp) h['X-Client-Ip'] = String(ctx.clientIp).replace(/^::ffff:/, '');
  return h;
}

async function call(path, { ctx, json, form }) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { ...headers(ctx), ...(json && { 'Content-Type': 'application/json' }) },
      body: form || JSON.stringify(json),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new FileServiceError(503, 'File storage is unavailable. Please try again.', err.message);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 4xx are the user's problem (wrong type, too big, rejected content): pass them on.
    const status = res.status >= 500 ? 502 : res.status;
    throw new FileServiceError(status, body.error || 'File storage request failed', body.details);
  }
  return body.data;
}

// ── files ──────────────────────────────────────────────────────────────────
// files: multer files ({ buffer, originalname, mimetype }).
// → [{ file_id, original_name, mime_type, size_kb, url }]
async function upload(ctx, { module, entityId, category, files }) {
  const form = new FormData();
  for (const f of files) {
    form.append('files', new Blob([f.buffer], { type: f.mimetype || 'application/octet-stream' }), f.originalname || 'file');
  }
  const q = new URLSearchParams({ module, ...(entityId && { entity_id: String(entityId) }), ...(category && { category }) });
  return call(`/internal/upload?${q}`, { ctx, form });
}

// Generic "upload now, save the record later" routes: files wait in the
// staging area until the record claims them. No tenant needed.
const stage = (ctx, files) => upload(ctx, { module: 'uploads', files });

// entityId: the saved record's id. Claim after the record has one (ids the
// database generates exist only after the INSERT), never "undefined".
const claim = (ctx, { module, entityId, category, fileIds }) => {
  if (!fileIds.length) return [];
  if (entityId == null || entityId === '') {
    return Promise.reject(new FileServiceError(400, `No record id to file the ${module} files under`));
  }
  return call('/internal/claim', { ctx, json: { module, entity_id: String(entityId), file_ids: fileIds, ...(category && { category }) } });
};

// → Map(file_id → url). Unknown, foreign and deleted ids are missing.
async function resolve(ctx, fileIds) {
  const ids = [...new Set(fileIds.filter(isFileId))];
  const map = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    for (const f of await call('/internal/resolve', { ctx, json: { file_ids: ids.slice(i, i + 100) } })) {
      map.set(f.file_id, f.url);
    }
  }
  return map;
}

// → Map(stored URL → signed URL). Other URLs are missing.
async function signLinks(ctx, urls) {
  const list = [...new Set(urls.filter(isSignableUrl))];
  const map = new Map();
  for (let i = 0; i < list.length; i += 100) {
    for (const u of await call('/internal/sign-links', { ctx, json: { urls: list.slice(i, i + 100) } })) {
      map.set(u.url, u.signed);
    }
  }
  return map;
}

const remove = (ctx, fileIds) => {
  const ids = fileIds.filter(isFileId);
  return ids.length ? call('/internal/delete', { ctx, json: { file_ids: ids } }) : null;
};
const removeEntity = (ctx, module, entityId) =>
  call('/internal/delete', { ctx, json: { module, entity_id: String(entityId) } });
const discard = (ctx, fileIds) => {
  const ids = fileIds.filter(isFileId);
  return ids.length ? call('/internal/discard', { ctx, json: { file_ids: ids } }) : null;
};

// Best effort, for cleanup after a failed save: never throws.
const quietly = (p) => Promise.resolve(p).catch((err) => console.warn('[file-service] cleanup failed:', err.message));

const isFileId = (v) => typeof v === 'string' && FILE_ID.test(v);

// Claim the file behind one stored URL (an image field) into a record. The
// URL stays valid (same file_id). → the claimed file, or null.
async function claimUrl(ctx, url, { module, entityId, category }) {
  const id = fileIdFromUrl(url);
  if (!id) return null;
  const [claimed] = await claim(ctx, { module, entityId, category, fileIds: [id] });
  return claimed || null;
}

// file_id named by a file-service URL (what /upload hands out, or a URL a
// response carried and the client sent back), else null.
function fileIdFromUrl(url) {
  if (typeof url !== 'string') return null;
  for (const re of FILE_URLS) {
    const m = re.exec(url);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

// ── file refs inside JSONB arrays ──────────────────────────────────────────
const fileCtx = (ctx) => `${ctx.zoduId}/${ctx.branchId || ''}`;

function refOf(entry) {
  if (typeof entry === 'string') return { id: fileIdFromUrl(entry), urlKey: null };
  if (!entry || typeof entry !== 'object') return { id: null };
  if (isFileId(entry.file_id) && entry.file_ctx !== undefined) return { id: entry.file_id, urlKey: entry.url_key, ref: true };
  if (isFileId(entry.file_id)) return { id: entry.file_id, urlKey: URL_KEYS.find((k) => typeof entry[k] === 'string') || 'url' };
  const urlKey = URL_KEYS.find((k) => typeof entry[k] === 'string' && fileIdFromUrl(entry[k]));
  return { id: urlKey ? fileIdFromUrl(entry[urlKey]) : null, urlKey };
}

// Before saving a record: claim every uploaded file in `entries` into the
// record and return the entries to store. Old URLs (not file-service links)
// are kept, without their response signature; links to files that can't be claimed (another tenant's,
// another record's, deleted) are dropped.
async function toRefs(ctx, entries, { module, entityId, category }) {
  if (entries == null) return entries;
  const list = Array.isArray(entries) ? entries : [entries];
  const refs = list.map(refOf);
  const claimed = new Set((await claim(ctx, {
    module, entityId, category, fileIds: [...new Set(refs.filter((r) => r.id).map((r) => r.id))],
  })).map((f) => f.file_id));

  const out = [];
  list.forEach((entry, i) => {
    const { id, urlKey } = refs[i];
    if (!id) { out.push(unsignLinks(entry)); return; }
    if (!claimed.has(id)) return;
    if (typeof entry === 'string' || entry.as_string) {
      out.push({ file_id: id, file_ctx: fileCtx(ctx), as_string: true });
      return;
    }
    const { file_ctx: _c, url_key: _k, ...rest } = entry;
    if (urlKey) delete rest[urlKey];
    out.push({ ...rest, file_id: id, file_ctx: fileCtx(ctx), url_key: urlKey || 'url' });
  });
  return out;
}

// A table row that owns a file (file_id + zodu_id + branch_id columns) as a
// ref: the response middleware fills row[urlKey] with a fresh URL. Rows
// without a file_id (old URL rows) are returned untouched.
const ref = (row, { urlKey = 'file_url' } = {}) => (row && isFileId(row.file_id)
  ? { ...row, file_ctx: `${row.zodu_id}/${row.branch_id || ''}`, url_key: urlKey }
  : row);

// The company/branch a stored ref was saved under (for deletes on routes that
// carry no tenant of their own).
const ctxOfRef = (r) => {
  const [zoduId, branchId] = String(r?.file_ctx || '').split('/');
  return { zoduId: zoduId || null, branchId: branchId || null };
};

// file_ids of the refs in a stored JSONB value (for deletes).
const refIds = (entries) => (Array.isArray(entries) ? entries : [])
  .map((e) => (e && typeof e === 'object' && e.file_ctx !== undefined && isFileId(e.file_id) ? e.file_id : null))
  .filter(Boolean);

// ── responses ──────────────────────────────────────────────────────────────
const isRef = (v) => v && typeof v === 'object' && !Array.isArray(v) && isFileId(v.file_id) && typeof v.file_ctx === 'string';

// found: file refs; links (optional Set): signable URLs, wherever they appear.
function collect(value, found, depth = 0, links = null) {
  if (links && isSignableUrl(value)) { links.add(value); return; }
  if (!value || typeof value !== 'object' || depth > 12) return;
  if (isRef(value)) { found.push(value); return; }
  if (value instanceof Date || Buffer.isBuffer(value)) return;
  for (const v of Array.isArray(value) ? value : Object.values(value)) collect(v, found, depth + 1, links);
}

// Signable URLs without a signed form (file-service unreachable) stay as they are.
function rebuild(value, urls, depth = 0, signed = null) {
  if (signed && typeof value === 'string') return signed.get(value) ?? value;
  if (!value || typeof value !== 'object' || depth > 12 || value instanceof Date || Buffer.isBuffer(value)) return value;
  if (isRef(value)) {
    const url = urls.get(value.file_id) ?? null;
    if (value.as_string) return url;
    const { file_ctx: _c, url_key: key, as_string: _s, ...rest } = value;
    return { ...rest, [key || 'url']: url };
  }
  if (Array.isArray(value)) return value.map((v) => rebuild(v, urls, depth + 1, signed));
  if (typeof value.toJSON === 'function') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = rebuild(v, urls, depth + 1, signed);
  return out;
}

// Replaces every file ref in `value` with a fresh URL (one resolve call per
// company/branch), and signs every stored /files/v or old file URL. Refs that
// can't be resolved get url null.
async function fileUrls(value, ctxExtra = {}) {
  const found = [];
  const links = new Set();
  collect(value, found, 0, links);
  if (!found.length && !links.size) return value;
  const signing = links.size
    ? signLinks(ctxExtra, [...links]).catch((err) => {
      console.warn('[file-service] could not sign file links:', err.message);
      return new Map();
    })
    : null;
  const groups = new Map();
  for (const ref of found) {
    if (!groups.has(ref.file_ctx)) groups.set(ref.file_ctx, []);
    groups.get(ref.file_ctx).push(ref.file_id);
  }
  const urls = new Map();
  await Promise.all([...groups].map(async ([scope, ids]) => {
    const [zoduId, branchId] = scope.split('/');
    for (const [id, url] of await resolve({ ...ctxExtra, zoduId, branchId: branchId || null }, ids)) urls.set(id, url);
  }));
  return rebuild(value, urls, 0, signing && await signing);
}

// Express middleware: every JSON response goes through fileUrls(), so all read
// paths (lists, details, reports) answer with fresh URLs without each query
// knowing about file-service. If file-service is down the refs come back with
// url null instead of failing the whole response.
//
// /files/v and old file URLs: signed in responses for the requesting user, and
// unsigned again in parsed request bodies (multipart fields go through toRefs,
// or are re-signed when read).
function fileUrlsMiddleware(req, res, next) {
  if (req.body && typeof req.body === 'object') req.body = unsignLinks(req.body);
  const json = res.json.bind(res);
  res.json = (body) => {
    const found = [];
    const links = new Set();
    collect(body, found, 0, links);
    if (!found.length && !links.size) return json(body);
    // Links are signed for the user this response is for (req.auth from
    // authenticate(); req.fileLinkUserId where a route signs the user in).
    const userId = req.auth?.userId ?? req.user?.user_id ?? req.fileLinkUserId ?? null;
    fileUrls(body, { clientIp: req.ip, userId })
      .then(json, (err) => {
        console.warn('[file-service] could not resolve file URLs:', err.message);
        json(rebuild(body, new Map()));
      });
    return res;
  };
  next();
}

// Request context for calls made on behalf of an end user.
function requestCtx(req, { zoduId, branchId, userId } = {}) {
  return {
    zoduId: zoduId ?? null,
    branchId: branchId ?? null,
    userId: userId ?? req.auth?.userId ?? null,
    clientIp: req.ip,
  };
}

module.exports = {
  FileServiceError,
  upload, stage, claim, claimUrl, resolve, signLinks, remove, removeEntity, discard, quietly,
  toRefs, refIds, ref, ctxOfRef, fileUrls, fileUrlsMiddleware, fileIdFromUrl, isFileId, isSignableUrl, unsignLinks, requestCtx,
};
