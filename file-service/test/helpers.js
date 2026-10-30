// In-memory stand-ins for Postgres (tbl_files), MinIO and auth-service, so the
// whole HTTP surface can be tested without infrastructure.
process.env.NODE_ENV = 'test';

const { Readable } = require('stream');
const jwt = require('jsonwebtoken');
const { createApp } = require('../src/express-app');
const { createMemoryStore } = require('../src/middleware/rate-limit');

const SECRET = 'test-app-secret';
const INTERNAL_TOKEN = 'i'.repeat(40);
const USERS = {
  admin:   '11111111-1111-4111-8111-111111111111',
  cashier: '22222222-2222-4222-8222-222222222222',
  other:   '33333333-3333-4333-8333-333333333333',
};

const token = (userId = USERS.admin, zoduId = 'Z001', secret = SECRET) =>
  jwt.sign({ user_id: userId, zodu_id: zoduId, user_type: 'owner' }, secret, { expiresIn: '1h' });

function fakeRepo() {
  const rows = new Map();
  const log = [];
  const clone = (r) => r && { ...r };
  const repo = {
    rows, log,
    failInsert: false,
    async insertFiles(list) {
      if (repo.failInsert) throw new Error('db down');
      return list.map((r) => {
        const row = { ...r, status: 'ready', created_at: new Date(), deleted_at: null };
        rows.set(r.file_id, row);
        return clone(row);
      });
    },
    async findReady(id) {
      const r = rows.get(id);
      return r && r.status === 'ready' ? clone(r) : null;
    },
    async findReadyMany(ids) {
      return ids.map((id) => rows.get(id)).filter((r) => r && r.status === 'ready').map(clone);
    },
    async listEntity(q) {
      return [...rows.values()].filter((r) => r.status === 'ready' && r.zodu_id === q.zodu_id
        && r.branch_id === q.branch_id && r.module === q.module && r.entity_id === q.entity_id).map(clone);
    },
    async softDelete(id) {
      const r = rows.get(id);
      if (!r || r.status !== 'ready') return null;
      Object.assign(r, { status: 'deleted', deleted_at: new Date() });
      return clone(r);
    },
    async softDeleteEntity(q) {
      const hit = (await repo.listEntity(q)).map((r) => r.file_id);
      return Promise.all(hit.map((id) => repo.softDelete(id)));
    },
    async logAccess(entries) { log.push(...entries); },
    async reassign(id, t) {
      const r = rows.get(id);
      if (!r || r.module !== 'uploads' || r.status !== 'ready') return null;
      Object.assign(r, t);
      return clone(r);
    },
  };
  return repo;
}

function fakeStorage() {
  const objects = new Map();
  const storage = {
    objects,
    bucket: 'zodu-files',
    failPutAfter: Infinity,
    internal: {
      async putObject(_b, key, buffer, size, meta) {
        if (objects.size >= storage.failPutAfter) throw new Error('minio down');
        objects.set(key, { buffer, size, meta });
      },
      async getObject(bucket, key) {
        const o = bucket === 'zodu' ? storage.internal.legacy.get(key) : objects.get(key);
        if (!o) throw Object.assign(new Error('missing'), { code: 'NoSuchKey' });
        return Readable.from([o.buffer]);
      },
      async removeObjects(_b, keys) { keys.forEach((k) => objects.delete(k)); },
      async removeObject(_b, key) { objects.delete(key); },
      async copyObject(bucket, key, source) {
        const o = objects.get(source.slice(bucket.length + 2));
        if (!o) throw Object.assign(new Error('missing'), { code: 'NoSuchKey' });
        objects.set(key, { ...o });
      },
      // The old "zodu" bucket, for /legacy.
      legacy: new Map(),
      async statObject(bucket, key) {
        const o = bucket === 'zodu' ? storage.internal.legacy.get(key) : objects.get(key);
        if (!o) throw Object.assign(new Error('missing'), { code: 'NotFound' });
        return { size: o.buffer.length, etag: 'etag-1', lastModified: new Date('2026-01-01') };
      },
    },
    signer: {
      // Mirrors the real call's shape so tests can check expiry and forced headers.
      async presignedGetObject(bucket, key, expiry, reqParams) {
        const q = new URLSearchParams({ 'X-Amz-Expires': String(expiry), ...reqParams, 'X-Amz-Signature': 'sig' });
        return `https://files.test/${bucket}/${key}?${q}`;
      },
    },
  };
  return storage;
}

// Z001: admin (all branches), cashier (B1 only, Expense read/create only).
function fakeAuth() {
  const calls = [];
  return {
    calls,
    async getAccess({ userId, zoduId, branchId }) {
      calls.push({ userId, zoduId, branchId });
      const branches = { Z001: ['B1', 'B2'], Z002: ['B1'] };
      const exists = !branchId || (branches[zoduId] || []).includes(branchId);
      if (userId === USERS.admin && zoduId === 'Z001') {
        return { is_member: true, branch_exists: exists, has_branch_access: true, is_admin: true, permissions: {} };
      }
      if (userId === USERS.cashier && zoduId === 'Z001') {
        return {
          is_member: true, branch_exists: exists, has_branch_access: !branchId || branchId === 'B1', is_admin: false,
          permissions: { Expense: { read: true, create: true, edit: false, delete: false } },
        };
      }
      if (userId === USERS.other && zoduId === 'Z002') {
        return { is_member: true, branch_exists: exists, has_branch_access: true, is_admin: true, permissions: {} };
      }
      return { is_member: false, branch_exists: exists, has_branch_access: false, is_admin: false, permissions: {} };
    },
  };
}

function makeApp(overrides = {}) {
  const repo = fakeRepo();
  const storage = fakeStorage();
  const authClient = fakeAuth();
  const config = {
    APP_SECRET: SECRET,
    PRESIGNED_URL_TTL: 900,
    PUBLIC_FILE_BASE_URL: 'https://api.test',
    INTERNAL_TOKENS: { restaurant: INTERNAL_TOKEN },
    MAX_CONCURRENT_UPLOADS: 4,
    UPLOAD_QUEUE_TIMEOUT_MS: 1000,
    CORS_ORIGINS: [],
    TRUST_PROXY: false,
    LEGACY_BUCKET_NAME: 'zodu',
    ...overrides.config,
  };
  const app = createApp({ config, repo, storage, authClient, rateLimitStore: overrides.store || createMemoryStore() });
  return { app, repo, storage, authClient };
}

// ── sample files ───────────────────────────────────────────────────────────
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const pdf = (body = '') => Buffer.from(`%PDF-1.4\n1 0 obj<<${body}>>endobj\ntrailer<<>>\n%%EOF\n`);

// Minimal stored (uncompressed) ZIP, enough for a macro-enabled .docx.
function zip(files) {
  const zlib = require('zlib');
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content);
    const nameBuf = Buffer.from(name);
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length / 2, 8); end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const DOCX_CT = '<?xml version="1.0"?><Types><Override PartName="/x" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
const docx = (extra = {}) => zip({ '[Content_Types].xml': DOCX_CT, 'word/document.xml': '<w:document/>', ...extra });

module.exports = { SECRET, INTERNAL_TOKEN, USERS, token, makeApp, PNG, pdf, docx };
