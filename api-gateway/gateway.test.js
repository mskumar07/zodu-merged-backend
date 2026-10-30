// node --test gateway.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

// Point every service at a stub that echoes what reached it.
const seen = [];
const stub = http.createServer((req, res) => {
  seen.push({ url: req.url, headers: req.headers });
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ reached: req.url }));
});

let base;
let server;
test.after(() => { server?.close(); stub.close(); });
test.before(async () => {
  await new Promise((r) => stub.listen(0, r));
  const target = `http://127.0.0.1:${stub.address().port}`;
  for (const s of ['AUTH', 'RETAIL', 'EMPLOYEE', 'RESTAURANT', 'CHECKLIST', 'ADMIN', 'FILE']) {
    process.env[`${s}_SERVICE_URL`] = target;
  }
  const { app } = require('./gateway');
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

const get = (path, init) => fetch(base + path, init);

test('/files is proxied to file-service with the prefix stripped', async () => {
  const res = await get('/files/v/0b6a3f1e-0000-4000-8000-000000000000');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).reached, '/v/0b6a3f1e-0000-4000-8000-000000000000');
  assert.ok(seen.at(-1).headers['x-forwarded-for'], 'client IP is forwarded');
});

test('internal routes of every service are 404 at the gateway', async () => {
  const blocked = [
    '/files/internal/upload',
    '/files/internal',
    '/auth/internal/company/Z001',
    '/auth/internal/user-branch-access?user_id=x',
    '/restaurant/internal/seed-defaults',
    '/retail/internal/x',
    '/employee/internal/employee/by-user',
    '/checklist/internal/x',
    '/admin/internal/x',
    '/auth/%69nternal/company/Z001',
    '/auth/%2569nternal/company/Z001',
    '/auth//internal/company',
    '/AUTH/Internal/company',
    '/files/x/../internal/upload',
    '/auth/./internal/company',
    '/auth/internal;x/company',
  ];
  const before = seen.length;
  for (const path of blocked) {
    const res = await get(path, { method: 'POST' });
    assert.equal(res.status, 404, path);
  }
  assert.equal(seen.length, before, 'nothing reached a service');
});

test('a client-supplied X-Internal-Token never reaches a service', async () => {
  await get('/files/x/y', { headers: { 'X-Internal-Token': 'stolen' } });
  assert.equal(seen.at(-1).headers['x-internal-token'], undefined);
});

test('normal routes still pass', async () => {
  for (const path of ['/auth/api/login', '/restaurant/api/menu/get', '/files/expense/EXP1', '/auth/file/internal.png']) {
    const res = await get(path);
    assert.equal(res.status, 200, path);
  }
});

test('CORS allows the X-Branch-Id header', async () => {
  const res = await get('/files/x/y', {
    method: 'OPTIONS',
    headers: { Origin: 'https://app.test', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-branch-id' },
  });
  assert.match(res.headers.get('access-control-allow-headers'), /X-Branch-Id/);
});
