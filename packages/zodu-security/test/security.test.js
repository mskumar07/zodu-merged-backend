const express = require('express');
const request = require('supertest');
const { applySecurity, createRateLimit, parseTrustProxy, setServerTimeouts } = require('..');

const ORIGINS = ['https://app.myzodu.com'];

function makeApp(opts = {}) {
  const app = express();
  applySecurity(app, { express, corsOrigins: ORIGINS, trustProxy: 1, ...opts });
  app.get('/x', (req, res) => res.json({ ip: req.ip, id: req.id }));
  app.post('/x', (req, res) => res.json({ size: JSON.stringify(req.body).length }));
  return app;
}

// Minimal ioredis stand-in: MULTI with INCR / PEXPIRE NX / PTTL.
function fakeRedis() {
  const data = new Map();
  const redis = {
    data,
    multi() {
      const ops = [];
      const chain = {
        incr: (k) => { ops.push(() => { const v = (data.get(k)?.v ?? 0) + 1; data.set(k, { ...data.get(k), v }); return v; }); return chain; },
        pexpire: (k, ms) => { ops.push(() => { const e = data.get(k); if (!e.exp) e.exp = Date.now() + ms; return 1; }); return chain; },
        pttl: (k) => { ops.push(() => data.get(k).exp - Date.now()); return chain; },
        exec: async () => ops.map((op) => [null, op()]),
      };
      return chain;
    },
    decr: async (k) => { data.get(k).v -= 1; },
    del: async (k) => { data.delete(k); },
  };
  return redis;
}

describe('headers', () => {
  test('security headers are set and x-powered-by is gone', async () => {
    const res = await request(makeApp()).get('/x');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBe("default-src 'none';frame-ancestors 'none'");
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  test('request id: generated when missing, kept when well-formed, replaced when not', async () => {
    const app = makeApp();
    const gen = await request(app).get('/x');
    expect(gen.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(gen.body.id).toBe(gen.headers['x-request-id']);
    expect((await request(app).get('/x').set('X-Request-Id', 'abc-12345')).headers['x-request-id']).toBe('abc-12345');
    expect((await request(app).get('/x').set('X-Request-Id', 'bad id; drop')).headers['x-request-id']).not.toBe('bad id; drop');
  });
});

describe('CORS', () => {
  test('a listed origin is allowed with credentials', async () => {
    const res = await request(makeApp()).get('/x').set('Origin', 'https://app.myzodu.com');
    expect(res.headers['access-control-allow-origin']).toBe('https://app.myzodu.com');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  test('an unknown origin gets no Access-Control-Allow-Origin', async () => {
    const res = await request(makeApp()).get('/x').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    const pre = await request(makeApp()).options('/x').set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(pre.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('requests without an Origin (mobile, desktop, curl) still work', async () => {
    const res = await request(makeApp()).get('/x');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('"*" is refused', () => {
    expect(() => makeApp({ corsOrigins: ['*'] })).toThrow(/not "\*"/);
  });
});

describe('body limit', () => {
  test('JSON over 100kb → 413', async () => {
    const app = makeApp();
    expect((await request(app).post('/x').send({ a: 'x'.repeat(1000) })).status).toBe(200);
    expect((await request(app).post('/x').send({ a: 'x'.repeat(101 * 1024) })).status).toBe(413);
  });
});

describe('trust proxy', () => {
  test('only the configured hops are trusted: a spoofed X-Forwarded-For entry is ignored', async () => {
    const res = await request(makeApp()).get('/x').set('X-Forwarded-For', '6.6.6.6, 10.0.0.9');
    expect(res.body.ip).toBe('10.0.0.9');
  });

  test('parseTrustProxy', () => {
    expect(parseTrustProxy(undefined)).toBe(1);
    expect(parseTrustProxy('2')).toBe(2);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('loopback, uniquelocal')).toEqual(['loopback', 'uniquelocal']);
  });
});

describe('rate limit', () => {
  test('per IP, shared through Redis, 429 with Retry-After', async () => {
    const redis = fakeRedis();
    const a = makeApp({ redis, ipLimitPerMinute: 2 });
    const b = makeApp({ redis, ipLimitPerMinute: 2 });   // second replica, same counters
    expect((await request(a).get('/x')).status).toBe(200);
    expect((await request(b).get('/x')).status).toBe(200);
    const res = await request(a).get('/x');
    expect(res.status).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(res.body).toEqual({ success: false, message: 'Too many requests, please try again later.' });
    expect([...redis.data.keys()][0]).toMatch(/^rl:ip:/);
  });

  test('Redis down: requests pass and the failure is reported', async () => {
    const errors = [];
    const broken = { multi: () => ({ incr() { return this; }, pexpire() { return this; }, pttl() { return this; }, exec: async () => { throw new Error('ECONNREFUSED'); } }) };
    const app = express();
    app.use(createRateLimit({ name: 'login', limit: 1, redis: broken, onStoreError: (e, n) => errors.push([n, e.message]) }));
    app.get('/', (req, res) => res.send('ok'));
    expect((await request(app).get('/')).status).toBe(200);
    expect((await request(app).get('/')).status).toBe(200);
    expect(errors[0]).toEqual(['login', 'ECONNREFUSED']);
  });

  test('custom key: per user', async () => {
    const app = express();
    app.use((req, res, next) => { req.user = req.get('X-User'); next(); });
    app.use(createRateLimit({ name: 'user', limit: 1, key: (req) => req.user }));
    app.get('/', (req, res) => res.send('ok'));
    expect((await request(app).get('/').set('X-User', 'u1')).status).toBe(200);
    expect((await request(app).get('/').set('X-User', 'u2')).status).toBe(200);
    expect((await request(app).get('/').set('X-User', 'u1')).status).toBe(429);
  });
});

test('server timeouts', () => {
  const server = setServerTimeouts({});
  expect(server).toEqual({ headersTimeout: 20000, requestTimeout: 120000, keepAliveTimeout: 65000 });
});
