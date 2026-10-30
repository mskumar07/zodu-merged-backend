const http = require('http');
const request = require('supertest');

// Every service points at a stub that echoes what reached it.
const seen = [];
const stub = http.createServer((req, res) => {
  seen.push({ url: req.url, method: req.method, headers: req.headers });
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ reached: req.url }));
});

let app;
let isBlockedPath;
beforeAll(async () => {
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  const target = `http://127.0.0.1:${stub.address().port}`;
  for (const s of ['AUTH', 'RETAIL', 'EMPLOYEE', 'RESTAURANT', 'CHECKLIST', 'ADMIN', 'FILE']) {
    process.env[`${s}_SERVICE_URL`] = target;
  }
  process.env.CORS_ORIGINS = 'https://app.myzodu.com,https://myzodu.com';
  process.env.AUTH_RATE_LIMIT_PER_MIN = '3';
  process.env.MAX_BODY_BYTES = '1000';
  ({ app, isBlockedPath } = require('../gateway'));
});
afterAll(() => stub.close());

const lastSeen = () => seen.at(-1);

test('/files is proxied to file-service with the prefix stripped, client IP and request id forwarded', async () => {
  const res = await request(app).get('/files/v/0b6a3f1e-0000-4000-8000-000000000000');
  expect(res.status).toBe(200);
  expect(res.body.reached).toBe('/v/0b6a3f1e-0000-4000-8000-000000000000');
  expect(lastSeen().headers['x-forwarded-for']).toBeTruthy();
  expect(lastSeen().headers['x-request-id']).toBe(res.headers['x-request-id']);
});

test('normal routes still pass, document numbers with encoded slashes too', async () => {
  for (const p of ['/auth/api/my-companies', '/restaurant/api/menu/get', '/files/expense/EXP1', '/retail/api/sales/INV%2F25-26%2F001']) {
    const res = await request(app).get(p);
    expect(res.status).toBe(200);
    expect(res.body.reached).toBe(p.replace(/^\/[^/]+/, ''));
  }
});

describe('blocked paths', () => {
  const blocked = [
    ['POST', '/files/internal/upload'],
    ['GET', '/files/internal'],
    ['GET', '/auth/internal/company/Z001'],
    ['GET', '/auth/internal/user-branch-access?user_id=x'],
    ['POST', '/restaurant/internal/seed-defaults'],
    ['GET', '/retail/internal/admin/invoices/stats'],
    ['POST', '/employee/internal/employee/by-user'],
    ['POST', '/checklist/internal/companies/Z1/purge'],
    ['GET', '/admin/internal/x'],
    ['GET', '/auth/%69nternal/company/Z001'],
    ['GET', '/auth/%2569nternal/company/Z001'],
    ['GET', '/auth%2Finternal/company/Z001'],
    ['GET', '/auth//internal/company'],
    ['GET', '/AUTH/Internal/company'],
    ['GET', '/auth/internal;x/company'],
    ['GET', '/files/x/../internal/upload'],
    ['GET', '/files/x/%2e%2e/internal/upload'],
    ['GET', '/auth/./api/login'],
    ['GET', '/auth/api%5c..%5cinternal'],
    ['GET', '/auth/api/%00'],
    ['GET', '/auth/api/%E0%A4%A'],
    ['DELETE', '/restaurant/delete/file/abc.png'],
    ['DELETE', '/checklist/delete/file/x'],
    ['DELETE', '/restaurant/file/x.png'],
    ['PUT', '/retail/file/x.png'],
    ['GET', '/payroll/file/x.png'],
  ];

  test.each(blocked)('%s %s → 404 without reaching a service', async (method, p) => {
    const before = seen.length;
    const res = await request(app)[method.toLowerCase()](p);
    expect(res.status).toBe(404);
    expect(seen.length).toBe(before);
  });

  test('isBlockedPath allows ordinary paths', () => {
    expect(isBlockedPath('/auth/api/login', 'POST')).toBe(false);
    expect(isBlockedPath('/retail/api/sales/INV%2F001', 'GET')).toBe(false);
    expect(isBlockedPath('/restaurant/file/a.png', 'GET')).toBe(false);
  });
});

test('old /{service}/file/* URLs go read-only to file-service /legacy', async () => {
  const cases = {
    '/auth/file/company-logo-Z001-1712.png': '/legacy/company-logo-Z001-1712.png',
    '/restaurant/file/internal.png': '/legacy/internal.png',
    '/retail/file/1712-bill.webp': '/legacy/1712-bill.webp',
    '/employee/file/1712-pan.webp': '/legacy/1712-pan.webp',
    '/checklist/file/checklist-attachments/abc/17-a%20b.pdf': '/legacy/checklist-attachments/abc/17-a%20b.pdf',
  };
  for (const [p, expected] of Object.entries(cases)) {
    const res = await request(app).get(p);
    expect(res.body.reached).toBe(expected);
    expect(res.headers['content-security-policy']).toBeUndefined();   // file-service decides
  }
});

test('client-supplied internal headers never reach a service', async () => {
  await request(app).get('/files/x/y').set('X-Internal-Token', 'stolen').set('X-Internal-Key', 'stolen');
  expect(lastSeen().headers['x-internal-token']).toBeUndefined();
  expect(lastSeen().headers['x-internal-key']).toBeUndefined();
});

describe('CORS', () => {
  test('listed origin: allowed with credentials and the app headers', async () => {
    const res = await request(app).options('/files/x/y')
      .set('Origin', 'https://app.myzodu.com')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,x-branch-id,x-client-platform');
    expect(res.headers['access-control-allow-origin']).toBe('https://app.myzodu.com');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-allow-headers']).toMatch(/X-Branch-Id/);
    expect(res.headers['access-control-allow-headers']).toMatch(/X-Client-Platform/);
  });

  test('unknown origin: no Access-Control-Allow-Origin', async () => {
    const res = await request(app).get('/auth/api/my-companies').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

test('security headers on API responses', async () => {
  const res = await request(app).get('/auth/api/my-companies');
  expect(res.headers['x-powered-by']).toBeUndefined();
  expect(res.headers['x-content-type-options']).toBe('nosniff');
  expect(res.headers['content-security-policy']).toMatch(/default-src 'none'/);
  expect(res.headers['x-request-id']).toBeTruthy();
});

test('declared bodies over MAX_BODY_BYTES → 413', async () => {
  const before = seen.length;
  const res = await request(app).post('/retail/api/expense').send({ a: 'x'.repeat(2000) });
  expect(res.status).toBe(413);
  expect(seen.length).toBe(before);
});

test('login, sign-up and refresh share a tight per-IP limit with Retry-After', async () => {
  const codes = [];
  for (let i = 0; i < 4; i++) codes.push((await request(app).post('/auth/api/login')).status);
  expect(codes).toEqual([200, 200, 200, 429]);
  const res = await request(app).post('/auth/api/refresh-token');
  expect(res.status).toBe(429);
  expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  // other auth routes are not affected
  expect((await request(app).get('/auth/api/my-companies')).status).toBe(200);
});

test('payroll is not proxied', async () => {
  expect((await request(app).get('/payroll/api/salary')).status).toBe(404);
});
