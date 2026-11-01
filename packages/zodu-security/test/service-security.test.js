const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const request = require('supertest');
const jose = require('jose');
const { createAccessTokenVerifier, createServiceSecurity, crud } = require('..');

let key; let keySet;
beforeAll(async () => {
  key = await jose.generateKeyPair('ES256', { extractable: true });
  keySet = jose.createLocalJWKSet({ keys: [{ ...(await jose.exportJWK(key.publicKey)), kid: 'k1', alg: 'ES256' }] });
});

const sign = (extra = {}) => new jose.SignJWT({
  sub: 'u-1', zid: 'Z001', bid: 'B1', role: 'Cashier', perms: ['expense:read', 'expense:create'],
  utype: 'employee', plt: 'web', sid: 'fam-1', ...extra,
}).setProtectedHeader({ alg: 'ES256', typ: 'at+jwt', kid: 'k1' })
  .setIssuer('zodu-auth').setAudience('zodu-api').setIssuedAt().setNotBefore('0s').setExpirationTime('15m')
  .setJti(crypto.randomUUID()).sign(key.privateKey);

// auth-service's answer: the user may also use B2, where they may only read expenses.
function fakeAccess() {
  const calls = [];
  return {
    calls,
    async getAccess(q) {
      calls.push(q);
      const ok = q.zoduId === 'Z001' && ['B1', 'B2'].includes(q.branchId);
      return {
        is_member: q.zoduId === 'Z001', branch_exists: ['B1', 'B2', 'B3'].includes(q.branchId),
        has_branch_access: ok, is_admin: false,
        permissions: { Expense: { read: true, create: false, edit: false, delete: false } },
      };
    },
  };
}

function makeApp({ access = fakeAccess(), events = [] } = {}) {
  const logger = { warn: (o) => events.push(o) };
  const security = createServiceSecurity({
    rules: [
      { path: '/health', public: true },
      { method: 'GET', path: '/api/me', authenticated: true },
      ...crud('/api/expense', 'expense'),
      { method: 'GET', path: /^\/api\/reports\/gst/, perm: ['report:read', 'gst:export'] },
    ],
    verifier: createAccessTokenVerifier({ keySet }),
    accessClient: access,
    logger,
    maxLimit: 100,
    respond: (req, res, status, message) => res.status(status).json({ error: message }),
  });
  const app = express();
  app.use(express.json());
  app.use(security.middleware);
  const router = security.protectParams(express.Router());
  const echo = (req, res) => res.json({
    tenant: req.tenant, query: req.query, body: req.body, params: req.params, perms: req.auth?.perms,
  });
  router.get('/health', (req, res) => res.json({ ok: true }));
  router.get('/api/me', echo);
  router.get('/api/expense', echo);
  router.post('/api/expense', echo);
  router.delete('/api/expense/:id', echo);
  router.get('/api/expense/:zodu_id/:branch_id/list', echo);
  router.post('/api/expense/upload', multer().none(), security.tenantBody, echo);
  router.get('/api/unmapped', echo);
  router.get('/api/reports/gst', echo);
  app.use(router);
  return { app, access, events };
}

const bearer = async (extra) => ({ Authorization: `Bearer ${await sign(extra)}` });

test('public routes need no token; every other route does', async () => {
  const { app } = makeApp();
  expect((await request(app).get('/health')).status).toBe(200);
  const res = await request(app).get('/api/expense');
  expect(res.status).toBe(401);
  expect(res.headers['www-authenticate']).toMatch(/Bearer/);
});

test('a route without a rule is closed (403), even for a valid token', async () => {
  const { app, events } = makeApp();
  expect((await request(app).get('/api/unmapped').set(await bearer())).status).toBe(403);
  expect(events.some((e) => e.security_event === 'permission_denied')).toBe(true);
});

test('permission per method: read and create allowed, delete refused', async () => {
  const { app } = makeApp();
  const h = await bearer();
  expect((await request(app).get('/api/expense').set(h)).status).toBe(200);
  expect((await request(app).post('/api/expense').set(h).send({})).status).toBe(200);
  expect((await request(app).delete('/api/expense/E1').set(h)).status).toBe(403);
  expect((await request(app).get('/api/reports/gst').set(h)).status).toBe(403);
});

test('the Admin role passes every permission check', async () => {
  const { app } = makeApp();
  const h = await bearer({ role: 'Admin', perms: [] });
  expect((await request(app).delete('/api/expense/E1').set(h)).status).toBe(200);
  expect((await request(app).get('/api/reports/gst').set(h)).status).toBe(200);
});

describe('company: only the token\'s', () => {
  test('another zodu_id in query, body or path → 404, logged', async () => {
    const { app, events } = makeApp();
    const h = await bearer();
    expect((await request(app).get('/api/expense?zodu_id=Z002').set(h)).status).toBe(404);
    expect((await request(app).post('/api/expense').set(h).send({ zodu_id: 'Z002' })).status).toBe(404);
    expect((await request(app).get('/api/expense/Z002/B1/list').set(h)).status).toBe(404);
    expect(events.filter((e) => e.security_event === 'cross_tenant_attempt')).toHaveLength(3);
  });

  test('the Admin role cannot reach another company either', async () => {
    const { app } = makeApp();
    const h = await bearer({ role: 'Admin', perms: [] });
    expect((await request(app).get('/api/expense?zodu_id=Z002').set(h)).status).toBe(404);
  });

  test('the token\'s own zodu_id passes; tenant is set', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/expense/Z001/B1/list').set(await bearer());
    expect(res.status).toBe(200);
    expect(res.body.tenant).toEqual({ zoduId: 'Z001', branchId: 'B1' });
  });
});

describe('branch', () => {
  test('the token branch needs no lookup', async () => {
    const { app, access } = makeApp();
    const res = await request(app).get('/api/expense?zodu_id=Z001&branch_id=B1').set(await bearer());
    expect(res.status).toBe(200);
    expect(access.calls).toHaveLength(0);
  });

  test('another branch the user may use: allowed, with that branch\'s permissions', async () => {
    const { app } = makeApp();
    const h = await bearer();
    const res = await request(app).get('/api/expense?branch_id=B2').set(h);
    expect(res.status).toBe(200);
    expect(res.body.tenant.branchId).toBe('B2');
    expect(res.body.perms).toEqual(['expense:read']);
    // in B2 the user may not create
    expect((await request(app).post('/api/expense').set(h).send({ branch_id: 'B2' })).status).toBe(403);
  });

  test('a branch the user may not use, or that does not exist → 404', async () => {
    const { app } = makeApp();
    const h = await bearer();
    expect((await request(app).get('/api/expense?branch_id=B3').set(h)).status).toBe(404);
    expect((await request(app).get('/api/expense?branch_id=B9').set(h)).status).toBe(404);
    expect((await request(app).get('/api/expense/Z001/B3/list').set(h)).status).toBe(404);
  });

  test('with AUTH_ALLOW_REQUESTED_BRANCH=false only the token branch works', async () => {
    process.env.AUTH_ALLOW_REQUESTED_BRANCH = 'false';
    try {
      const { app } = makeApp();
      expect((await request(app).get('/api/expense?branch_id=B2').set(await bearer())).status).toBe(404);
    } finally {
      delete process.env.AUTH_ALLOW_REQUESTED_BRANCH;
    }
  });

  test('access check down → 503', async () => {
    const { app } = makeApp({ access: { getAccess: async () => { throw Object.assign(new Error('x'), { status: 503 }); } } });
    expect((await request(app).get('/api/expense?branch_id=B2').set(await bearer())).status).toBe(503);
  });
});

test('mass assignment: zodu_id / branch_id in the body are the checked values', async () => {
  const { app } = makeApp();
  const res = await request(app).post('/api/expense').set(await bearer()).send({ zodu_id: 'Z001', amount: 5 });
  expect(res.body.body).toEqual({ zodu_id: 'Z001', amount: 5 });
  expect(res.body.tenant).toEqual({ zoduId: 'Z001', branchId: 'B1' });
});

test('multipart bodies are checked after multer (tenantBody)', async () => {
  const { app } = makeApp();
  const h = await bearer();
  expect((await request(app).post('/api/expense/upload').set(h).field('zodu_id', 'Z002')).status).toBe(404);
  expect((await request(app).post('/api/expense/upload').set(h).field('zodu_id', 'Z001').field('branch_id', 'B3')).status).toBe(404);
  const ok = await request(app).post('/api/expense/upload').set(h).field('zodu_id', 'Z001').field('branch_id', 'B1');
  expect(ok.status).toBe(200);
});

describe('list queries', () => {
  test('limit is capped; bad numbers fall back', async () => {
    const { app } = makeApp();
    const h = await bearer();
    expect((await request(app).get('/api/expense?limit=100000').set(h)).body.query.limit).toBe('100');
    expect((await request(app).get('/api/expense?limit=abc&page=-3').set(h)).body.query).toMatchObject({ limit: '50', page: '1' });
  });

  test('injection in order / sort is refused', async () => {
    const { app } = makeApp();
    const h = await bearer();
    expect((await request(app).get('/api/expense?order=DESC;DROP%20TABLE%20x').set(h)).status).toBe(400);
    expect((await request(app).get('/api/expense?sort_by=name;--').set(h)).status).toBe(400);
    expect((await request(app).get('/api/expense?sort_by=created_at%20DESC&order=asc').set(h)).status).toBe(200);
  });
});
