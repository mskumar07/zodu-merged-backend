const express = require('express');
const request = require('supertest');
const {
  createInternalAuth, callerTokensFromEnv, internalHeaders, createInternalHttp, requestId,
} = require('..');

const AUTH = 'a'.repeat(64);
const ADMIN = 'b'.repeat(64);

function app(guard) {
  const a = express();
  a.use('/internal', guard);
  a.get('/internal/x', (req, res) => res.json({ caller: req.internalCaller }));
  return a;
}

describe('requireInternal', () => {
  const { requireInternal } = createInternalAuth({ tokens: { auth: AUTH, admin: ADMIN } });

  test('no token → 401', async () => {
    const res = await request(app(requireInternal())).get('/internal/x');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, message: 'Invalid internal token' });
  });

  test('unknown token → 401', async () => {
    const res = await request(app(requireInternal())).get('/internal/x').set('X-Internal-Token', 'c'.repeat(64));
    expect(res.status).toBe(401);
  });

  test('known token: the route learns which service called', async () => {
    const res = await request(app(requireInternal())).get('/internal/x').set('X-Internal-Token', AUTH);
    expect(res.status).toBe(200);
    expect(res.body.caller).toBe('auth');
  });

  test("another service's token → 403", async () => {
    const res = await request(app(requireInternal('auth'))).get('/internal/x').set('X-Internal-Token', ADMIN);
    expect(res.status).toBe(403);
  });

  test('a route can narrow an app-wide guard', async () => {
    const a = express();
    a.use('/internal', requireInternal());
    a.get('/internal/admin-only', requireInternal('admin'), (req, res) => res.json({ ok: true }));
    expect((await request(a).get('/internal/admin-only').set('X-Internal-Token', AUTH)).status).toBe(403);
    expect((await request(a).get('/internal/admin-only').set('X-Internal-Token', ADMIN)).status).toBe(200);
  });

  test('custom error format', async () => {
    const { requireInternal: guard } = createInternalAuth({
      tokens: { auth: AUTH },
      respond: (req, res, status, message) => res.status(status).json({ error: message }),
    });
    const res = await request(app(guard())).get('/internal/x');
    expect(res.body).toEqual({ error: 'Invalid internal token' });
  });
});

test('tokens come from INTERNAL_TOKEN_<CALLER>; short ones are ignored', () => {
  expect(callerTokensFromEnv({
    INTERNAL_TOKEN_AUTH: AUTH,
    INTERNAL_TOKEN_RETAIL: 'short',
    INTERNAL_TOKEN: ADMIN,          // this service's own token, not a caller
    OTHER: AUTH,
  })).toEqual({ auth: AUTH });
  const { identify } = createInternalAuth({ tokens: { weak: 'short' } });
  expect(identify({ get: () => 'short' })).toBeNull();
});

describe('outgoing internal calls', () => {
  test('carry this service token and the current request id', async () => {
    process.env.INTERNAL_TOKEN = AUTH;
    const a = express();
    a.use(requestId());
    a.get('/', (req, res) => res.json(internalHeaders()));
    const res = await request(a).get('/').set('X-Request-Id', 'req-12345678');
    expect(res.body).toEqual({ 'X-Internal-Token': AUTH, 'X-Request-Id': 'req-12345678' });
    delete process.env.INTERNAL_TOKEN;
  });

  test('createInternalHttp adds the headers and a timeout to every request', async () => {
    process.env.INTERNAL_TOKEN = ADMIN;
    let interceptor;
    const fakeAxios = {
      create: (cfg) => ({ cfg, interceptors: { request: { use: (fn) => { interceptor = fn; } } } }),
    };
    const http = createInternalHttp(fakeAxios, { baseURL: 'http://auth-service:4000' });
    expect(http.cfg).toMatchObject({ baseURL: 'http://auth-service:4000', timeout: 10000 });
    const out = interceptor({ headers: { 'Content-Type': 'application/json' } });
    expect(out.headers).toEqual({ 'Content-Type': 'application/json', 'X-Internal-Token': ADMIN });
    delete process.env.INTERNAL_TOKEN;
  });
});
