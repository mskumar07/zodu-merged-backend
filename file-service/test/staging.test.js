// Phase 2: staged uploads, claim, discard, legacy URLs: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const {
  makeApp, token, USERS, INTERNAL_TOKEN, PNG, pdf,
} = require('./helpers');

const svc = (extra = {}) => ({ 'X-Internal-Token': INTERNAL_TOKEN, 'X-Client-Ip': '203.0.113.9', ...extra });
const tenant = (branch = 'B1') => svc({ 'X-Zodu-Id': 'Z001', 'X-Branch-Id': branch, 'X-User-Id': USERS.admin });

async function stage(app, headers = svc(), files = [[PNG, 'bill.png']]) {
  const req = request(app).post('/internal/upload?module=uploads').set(headers);
  for (const [buf, name] of files) req.attach('files', buf, name);
  const res = await req;
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data;
}

const claim = (app, body, headers = tenant()) => request(app).post('/internal/claim').set(headers).send(body);

test('anonymous staged upload: under _staging, served as a stable link', async () => {
  const { app, repo } = makeApp();
  const [f] = await stage(app);
  const row = repo.rows.get(f.file_id);
  assert.match(row.object_key, /^_staging\/uploads\/anon\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/);   // keeps its format until claimed
  assert.equal(row.zodu_id, '_staging');
  assert.equal(f.url, `https://api.test/files/v/${f.file_id}`);
  assert.equal((await request(app).get(`/v/${f.file_id}`)).status, 200);
});

test('staging needs no tenant, every other internal call does', async () => {
  const { app } = makeApp();
  const res = await request(app).post('/internal/upload?module=expense&entity_id=E1').set(svc()).attach('files', PNG, 'a.png');
  assert.equal(res.status, 400);
  assert.equal((await request(app).post('/internal/resolve').set(svc()).send({ file_ids: ['x'] })).status, 400);
});

test('users cannot reach the staging module through the public API', async () => {
  const { app } = makeApp();
  const res = await request(app).post('/uploads/E1').set({ Authorization: `Bearer ${token()}`, 'X-Branch-Id': 'B1' })
    .attach('files', PNG, 'a.png');
  assert.equal(res.status, 400);
});

test('claim into a private module: new key, same id, link stops working, URL is presigned', async () => {
  const { app, repo, storage } = makeApp();
  const [f] = await stage(app, svc(), [[pdf(), 'bill.pdf']]);
  const before = repo.rows.get(f.file_id).object_key;

  const res = await claim(app, { file_ids: [f.file_id], module: 'expense', entity_id: 'EXP12' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data[0].file_id, f.file_id);
  assert.match(res.body.data[0].url, /X-Amz-Expires=900/);

  const row = repo.rows.get(f.file_id);
  assert.match(row.object_key, /^Z001\/B1\/expense\/EXP12\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.pdf$/);
  assert.deepEqual([row.zodu_id, row.branch_id, row.module, row.entity_id], ['Z001', 'B1', 'expense', 'EXP12']);
  assert.equal(storage.objects.has(before), false);
  assert.equal(storage.objects.has(row.object_key), true);
  assert.equal((await request(app).get(`/v/${f.file_id}`)).status, 404);
});

test('claim into a link module keeps the same stable URL', async () => {
  const { app } = makeApp();
  const [f] = await stage(app);
  const res = await claim(app, { file_ids: [f.file_id], module: 'menu-items', entity_id: 'M1' });
  assert.equal(res.body.data[0].url, f.url);
  assert.equal((await request(app).get(`/v/${f.file_id}`)).status, 200);
});

test('claim into menu-items converts the staged picture to webp; other modules keep it', async () => {
  const { app, repo, storage } = makeApp();
  const [f] = await stage(app);
  await claim(app, { file_ids: [f.file_id], module: 'menu-items', entity_id: 'M1' });
  const row = repo.rows.get(f.file_id);
  assert.equal(row.mime_type, 'image/webp');
  assert.equal(row.original_name, 'bill.webp');
  assert.match(row.object_key, /\.webp$/);
  assert.equal(row.size_bytes, storage.objects.get(row.object_key).buffer.length);
  const served = await request(app).get(`/v/${f.file_id}`);
  assert.equal(served.status, 200);
  assert.equal(served.headers['content-type'], 'image/webp');

  const [g] = await stage(app);
  await claim(app, { file_ids: [g.file_id], module: 'expense', entity_id: 'E1' });
  assert.equal(repo.rows.get(g.file_id).mime_type, 'image/png');
  assert.match(repo.rows.get(g.file_id).object_key, /\.png$/);
});

test('claim is idempotent, skips foreign and unknown ids, refuses wrong types', async () => {
  const { app } = makeApp();
  const [mine] = await stage(app);
  const [other] = await stage(app, svc({ 'X-Zodu-Id': 'Z002' }));
  const body = { file_ids: [mine.file_id, other.file_id, '00000000-0000-4000-8000-000000000000'], module: 'expense', entity_id: 'E1' };

  const first = await claim(app, body);
  assert.deepEqual(first.body.data.map((d) => d.file_id), [mine.file_id]);
  const again = await claim(app, body);
  assert.deepEqual(again.body.data.map((d) => d.file_id), [mine.file_id]);

  // already claimed by E1: another record can't take it
  const steal = await claim(app, { ...body, entity_id: 'E2' });
  assert.deepEqual(steal.body.data, []);

  const [csv] = await stage(app, svc(), [[Buffer.from('a,b\n1,2\n'), 'x.csv']]);
  const bad = await claim(app, { file_ids: [csv.file_id], module: 'menu-items', entity_id: 'M1' });
  assert.equal(bad.status, 415);
});

test('a tenant staged upload can only be claimed by that tenant', async () => {
  const { app } = makeApp();
  const [f] = await stage(app, tenant());
  const res = await claim(app, { file_ids: [f.file_id], module: 'expense', entity_id: 'E1' },
    svc({ 'X-Zodu-Id': 'Z002', 'X-Branch-Id': 'B1' }));
  assert.deepEqual(res.body.data, []);
});

test('discard drops unclaimed staged files only', async () => {
  const { app, repo } = makeApp();
  const [a] = await stage(app);
  const [b] = await stage(app);
  await claim(app, { file_ids: [b.file_id], module: 'expense', entity_id: 'E1' });
  const res = await request(app).post('/internal/discard').set(tenant()).send({ file_ids: [a.file_id, b.file_id] });
  assert.deepEqual(res.body.data.file_ids, [a.file_id]);
  assert.equal(repo.rows.get(a.file_id).status, 'deleted');
  assert.equal(repo.rows.get(b.file_id).status, 'ready');

  // anonymous: only staged files nobody owns
  const [anon] = await stage(app);
  const [owned] = await stage(app, tenant());
  const res2 = await request(app).post('/internal/discard').set(svc()).send({ file_ids: [anon.file_id, owned.file_id] });
  assert.deepEqual(res2.body.data.file_ids, [anon.file_id]);
});

test('internal resolve presigns employee files (old clients open links without a token)', async () => {
  const { app } = makeApp();
  const up = await request(app).post('/internal/upload?module=employee&entity_id=EMP1&category=documents')
    .set(tenant()).attach('file', pdf(), 'pan.pdf');
  const res = await request(app).post('/internal/resolve').set(tenant()).send({ file_ids: [up.body.data[0].file_id] });
  assert.match(res.body.data[0].url, /X-Amz-Expires=900/);
  assert.equal(res.body.data[0].expires_in_seconds, 900);
});

test('staged uploads from one address share the per-user upload limit', async () => {
  const { app } = makeApp();
  let last;
  for (let i = 0; i < 31; i++) {
    last = await request(app).post('/internal/upload?module=uploads').set(svc()).attach('files', PNG, 'a.png');
  }
  assert.equal(last.status, 429);
  const other = await request(app).post('/internal/upload?module=uploads').set(svc({ 'X-Client-Ip': '198.51.100.1' }))
    .attach('files', PNG, 'a.png');
  assert.equal(other.status, 201);
});

test('legacy URLs stream from the old bucket with long caching and 304s', async () => {
  const { app, storage } = makeApp();
  storage.internal.legacy.set('1712-menu.webp', { buffer: Buffer.from('RIFF....WEBP') });
  storage.internal.legacy.set('checklist-attachments/abc/17-report final.pdf', { buffer: pdf() });
  storage.internal.legacy.set('evil.html', { buffer: Buffer.from('<script>alert(1)</script>') });

  const img = await request(app).get('/legacy/1712-menu.webp');
  assert.equal(img.status, 200);
  assert.equal(img.headers['content-type'], 'image/webp');
  assert.equal(img.headers['cache-control'], 'public, max-age=31536000, immutable');
  assert.equal(img.headers.etag, '"etag-1"');
  assert.match(img.headers['content-disposition'], /^inline;/);

  const again = await request(app).get('/legacy/1712-menu.webp').set('If-None-Match', '"etag-1"');
  assert.equal(again.status, 304);

  const nested = await request(app).get('/legacy/checklist-attachments/abc/17-report%20final.pdf');
  assert.equal(nested.status, 200);
  assert.match(nested.headers['content-disposition'], /filename="17-report final.pdf"/);

  const html = await request(app).get('/legacy/evil.html');
  assert.equal(html.headers['content-type'], 'application/octet-stream');
  assert.match(html.headers['content-disposition'], /^attachment;/);
  assert.equal(html.headers['content-security-policy'], "default-src 'none'; sandbox");

  assert.equal((await request(app).get('/legacy/missing.png')).status, 404);
  assert.equal((await request(app).get('/legacy/a/../b.png')).status, 404);
});
