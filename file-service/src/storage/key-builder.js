// Builds and checks object keys. Pure functions — no MinIO calls — so the
// whole folder convention can be unit-tested without a running server.
//
// Layout:
//   {zoduId}/{branchId}/{module}/{entityId}[/{category}]/{uuid}.{ext}    e.g. purchase/PUR-B1-001/bill/…
//   {zoduId}/{branchId}/menu-items/{uuid}.{ext}                          modules without entity folders
//   {zoduId}/_shared/{module}/{entityId}[/{category}]/{uuid}.{ext}
//   _staging/uploads/{zoduId|anon}/{yyyy}/{mm}/{uuid}.{ext}     ← not yet claimed by a record
//
// Branch folders sit directly under the zodu ID, next to "_shared", so branch
// IDs may not start with "_" (that name space is reserved for tenant areas).

const crypto = require('crypto');
const { getModule, EXT_BY_MIME } = require('./modules');

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function assertSafeId(label, value) {
  if (!SAFE_ID.test(String(value || ''))) {
    throw httpError(400, `Invalid ${label}: only letters, numbers, "-" and "_" are allowed`);
  }
}

// Prefix that every file of this tenant (and branch, if given) lives under.
// "staging" holds uploads that no record has claimed yet; it belongs to no tenant.
function scopePrefix({ zoduId, branchId, scope = 'branch' }) {
  if (scope === 'staging') return '_staging/';
  assertSafeId('zoduId', zoduId);
  if (scope === 'tenant') return `${zoduId}/_shared/`;
  assertSafeId('branchId', branchId);
  if (branchId.startsWith('_')) throw httpError(400, 'Invalid branchId: must not start with "_"');
  return `${zoduId}/${branchId}/`;
}

// Folder for one record's files (the module folder itself for modules
// without entity folders). "undefined" / "null" are a missing id turned into
// text by the caller, never a record.
function entityPrefix({ zoduId, branchId, module, entityId }) {
  const mod = getModule(module);
  assertSafeId('entityId', entityId);
  if (/^(undefined|null)$/i.test(String(entityId))) throw httpError(400, 'Invalid entityId: the record id is missing');
  const base = `${scopePrefix({ zoduId, branchId, scope: mod.scope })}${module}/`;
  return mod.entityFolder === false ? base : `${base}${entityId}/`;
}

// fileId: the file's tbl_files id, used as the object name so a key (and a
// presigned URL) names its file. A fresh UUID when not given.
function buildKey({ zoduId, branchId, module, entityId, mimeType, category, fileId, now = new Date() }) {
  const mod = getModule(module);

  const ext = EXT_BY_MIME[mimeType];
  if (!ext || !mod.allowedTypes.includes(mimeType)) {
    throw httpError(415, `File type "${mimeType}" is not allowed for module "${module}"`);
  }

  const parts = [entityPrefix({ zoduId, branchId, module, entityId }).slice(0, -1)];

  if (category) {
    if (!mod.categories?.includes(category)) {
      throw httpError(400, `Invalid category "${category}" for module "${module}"`);
    }
    parts.push(category);
  }

  if (mod.datePartition) {
    parts.push(String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'));
  }

  // UUID file name: never collides, never overwrites, leaks nothing from the original name.
  if (fileId !== undefined && !UUID.test(String(fileId))) throw httpError(400, 'Invalid file id');
  parts.push(`${fileId ? String(fileId).toLowerCase() : crypto.randomUUID()}.${ext}`);
  return parts.join('/');
}

// Ownership check used before any read/delete: the key must sit inside the
// caller's tenant, and inside their branch (or the tenant's _shared area).
// A foreign key answers 404, not 403, so callers can't probe which files exist.
// A tenant-only context (no branch) may reach only the _shared area.
function assertKeyBelongsTo(key, { zoduId, branchId }) {
  if (typeof key !== 'string' || key.includes('..') || key.includes('\\') || key.startsWith('/')) {
    throw httpError(400, 'Invalid file key');
  }
  const allowed = [scopePrefix({ zoduId, scope: 'tenant' })];
  if (branchId) allowed.push(scopePrefix({ zoduId, branchId, scope: 'branch' }));
  if (!allowed.some((prefix) => key.startsWith(prefix))) {
    throw httpError(404, 'File not found');
  }
}

module.exports = { buildKey, entityPrefix, scopePrefix, assertKeyBelongsTo, httpError };
