// Access cache, upload semaphore, purge job, rate-limit store: npm test
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthClient } = require('../src/clients/auth-client');
const { createUploadSlots } = require('../src/middleware/upload');
const { createPurgeJob, PURGEABLE } = require('../src/jobs/purge-deleted');
const { createRedisStore } = require('../src/middleware/rate-limit');
const { internalTokens } = require('../src/config');
const { MODULES, PERM } = require('../src/storage/modules');

test('registry: every module has access, permission and a sane limit', () => {
  const perms = new Set(Object.values(PERM));
  for (const [name, m] of Object.entries(MODULES)) {
    assert.ok(['link', 'private'].includes(m.access), name);
    assert.ok(m.internalOnly || perms.has(m.permission), name);
    assert.ok(m.maxSizeMb > 0 && m.maxSizeMb <= 25, name);
    assert.ok(['branch', 'tenant', 'staging'].includes(m.scope), name);
  }
  assert.equal(MODULES.employee.access, 'private');
  assert.deepEqual(PURGEABLE.sort(),
    ['branding', 'checklist', 'documents', 'employee', 'invoice-settings', 'menu-items', 'uploads']);
});

test('access answers are cached for the TTL, per user/company/branch', async () => {
  let calls = 0;
  const http = { get: async (_url, { params, headers }) => {
    calls++;
    assert.equal(headers['X-Internal-Token'], 'tok');
    return { data: { success: true, data: { is_member: true, branch: params.branch_id } } };
  } };
  const client = createAuthClient({ baseUrl: 'http://auth', token: 'tok', ttlMs: 50, http });
  await client.getAccess({ userId: 'u', zoduId: 'Z001', branchId: 'B1' });
  await client.getAccess({ userId: 'u', zoduId: 'Z001', branchId: 'B1' });
  assert.equal(calls, 1);
  await client.getAccess({ userId: 'u', zoduId: 'Z001', branchId: 'B2' });
  assert.equal(calls, 2);
  await new Promise((r) => setTimeout(r, 60));
  await client.getAccess({ userId: 'u', zoduId: 'Z001', branchId: 'B1' });
  assert.equal(calls, 3);
});

test('auth-service down → 503, not cached', async () => {
  let fail = true;
  const http = { get: async () => { if (fail) throw new Error('ECONNREFUSED'); return { data: { data: { is_member: true } } }; } };
  const client = createAuthClient({ baseUrl: 'http://auth', token: 't', ttlMs: 60_000, http });
  await assert.rejects(client.getAccess({ userId: 'u', zoduId: 'Z001' }), { status: 503 });
  fail = false;
  assert.equal((await client.getAccess({ userId: 'u', zoduId: 'Z001' })).is_member, true);
});

test('upload slots: at most N at once, the rest queue, then 503', async () => {
  const slots = createUploadSlots({ max: 2, timeoutMs: 30 });
  const res = () => {
    const handlers = {};
    return { on: (ev, fn) => { handlers[ev] = fn; }, end: () => handlers.finish?.() };
  };
  const take = () => new Promise((resolve) => {
    const r = res();
    slots.middleware({}, r, (err) => resolve({ err, r }));
  });
  const a = await take();
  const b = await take();
  assert.deepEqual(slots.stats(), { active: 2, waiting: 0 });
  const waiting = take();
  assert.equal(slots.stats().waiting, 1);
  a.r.end();
  const c = await waiting;
  assert.equal(c.err, undefined);
  assert.equal(slots.stats().active, 2);
  const late = await take();   // nobody releases → times out
  assert.equal(late.err.status, 503);
  b.r.end(); c.r.end();
  assert.deepEqual(slots.stats(), { active: 0, waiting: 0 });
});

test('purge job removes objects of old soft-deleted, non-accounting files only', async () => {
  const removed = [];
  let asked;
  const repo = {
    async withPurgeBatch(q, fn) {
      asked = q;
      return (await fn([{ file_id: 'f1', object_key: 'Z001/B1/menu-items/M1/a.webp' }])).length;
    },
  };
  const storage = { bucket: 'b', internal: { removeObjects: async (_b, keys) => removed.push(...keys) } };
  const n = await createPurgeJob({ repo, storage, olderThanDays: 30 }).runOnce();
  assert.equal(n, 1);
  assert.deepEqual(removed, ['Z001/B1/menu-items/M1/a.webp']);
  assert.equal(asked.olderThanDays, 30);
  for (const m of ['expense', 'purchase', 'customer-payment', 'invoice', 'reports']) assert.ok(!asked.modules.includes(m), m);
});

test('redis store: one shared counter with a window expiry', async () => {
  const cmds = [];
  const redis = {
    multi() {
      const chain = {
        incr: (k) => { cmds.push(['incr', k]); return chain; },
        pexpire: (k, ms, nx) => { cmds.push(['pexpire', k, ms, nx]); return chain; },
        pttl: (k) => { cmds.push(['pttl', k]); return chain; },
        exec: async () => [[null, 3], [null, 1], [null, 42_000]],
      };
      return chain;
    },
  };
  const r = await createRedisStore(redis).hit('rl:x', 60_000);
  assert.deepEqual(r, { count: 3, resetMs: 42_000 });
  assert.deepEqual(cmds[1], ['pexpire', 'rl:x', 60_000, 'NX']);
});

test('internal tokens: one per service, short ones ignored', () => {
  const t = internalTokens({
    INTERNAL_SERVICE_TOKEN_RESTAURANT: 'r'.repeat(32),
    INTERNAL_SERVICE_TOKEN_RETAIL: 'short',
    OTHER: 'x'.repeat(40),
  });
  assert.deepEqual(t, { restaurant: 'r'.repeat(32) });
});
