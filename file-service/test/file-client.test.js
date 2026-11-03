// The services' client (clients/file-client.js) against a real file-service app
// on a local port, with in-memory storage: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { makeApp, INTERNAL_TOKEN, USERS, PNG, pdf } = require('./helpers');

let server;
let fs;
let client;
test.before(async () => {
  fs = makeApp();
  server = fs.app.listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  process.env.FILE_SERVICE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.INTERNAL_TOKEN = INTERNAL_TOKEN;
  client = require('../clients/file-client');
});
test.after(() => server.close());

const ctx = { zoduId: 'Z001', branchId: 'B1', userId: USERS.admin, clientIp: '::ffff:203.0.113.9' };
const multerFile = (buffer, originalname, mimetype) => ({ buffer, originalname, mimetype, size: buffer.length });

test('upload / resolve / remove round trip', async () => {
  const [f] = await client.upload(ctx, { module: 'expense', entityId: 'E1', files: [multerFile(PNG, 'a.png', 'image/png')] });
  assert.ok(client.isFileId(f.file_id));
  const urls = await client.resolve(ctx, [f.file_id, 'junk']);
  assert.match(urls.get(f.file_id), /X-Amz-Expires=900/);
  await client.remove(ctx, [f.file_id]);
  assert.equal((await client.resolve(ctx, [f.file_id])).size, 0);
});

test('errors carry the file-service status and message', async () => {
  await assert.rejects(
    client.upload(ctx, { module: 'expense', entityId: 'E1', files: [multerFile(PNG, 'a.pdf', 'application/pdf')] }),
    (err) => err.status === 415 && /nothing was uploaded/.test(err.message) && err.details.length === 1,
  );
});

test('stage → toRefs claims what the record uses and keeps old URLs', async () => {
  const staged = await client.stage({ clientIp: '203.0.113.10' }, [
    multerFile(PNG, 'one.png', 'image/png'), multerFile(pdf(), 'two.pdf', 'application/pdf'),
  ]);
  const legacy = { id: 'x', filename: 'old.png', url: 'https://api.myzodu.com/restaurant/file/1712-old.webp' };
  const entries = [
    { id: '1', filename: 'one.png', url: staged[0].url, size: 10 },
    staged[1].url,   // string entries are allowed by some schemas
    legacy,
    { filename: 'foreign', url: 'https://api.test/files/v/00000000-0000-4000-8000-000000000000' },
  ];
  const stored = await client.toRefs(ctx, entries, { module: 'expense', entityId: 'EXP9' });
  assert.equal(stored.length, 3);
  assert.deepEqual(stored[0], { id: '1', filename: 'one.png', size: 10, file_id: staged[0].file_id, file_ctx: 'Z001/B1', url_key: 'url' });
  assert.deepEqual(stored[1], { file_id: staged[1].file_id, file_ctx: 'Z001/B1', as_string: true });
  assert.deepEqual(stored[2], legacy);
  assert.equal(fs.repo.rows.get(staged[0].file_id).entity_id, 'EXP9');

  // Saving again with the stored refs (or the resolved response echoed back) is a no-op.
  const again = await client.toRefs(ctx, stored, { module: 'expense', entityId: 'EXP9' });
  assert.deepEqual(again, stored);
  const shown = await client.fileUrls(stored);
  const echoed = await client.toRefs(ctx, shown, { module: 'expense', entityId: 'EXP9' });
  assert.deepEqual(echoed.map((e) => e.file_id), stored.map((e) => e.file_id));
  assert.deepEqual(client.refIds(stored), [staged[0].file_id, staged[1].file_id]);
});

test('fileUrlsMiddleware answers with the old shapes and fresh URLs', async () => {
  const [f] = await client.upload(ctx, { module: 'checklist', entityId: 'C1', category: 'attachments', files: [multerFile(PNG, 'p.png', 'image/png')] });
  const app = express();
  app.use(client.fileUrlsMiddleware);
  app.get('/x', (_req, res) => res.json({
    success: true,
    data: [{
      id: 1, created_at: new Date('2026-01-01'),
      attachment_url: [
        { file_id: f.file_id, file_ctx: 'Z001/B1', url_key: 'file_url', file_name: 'p.png' },
        'https://api.myzodu.com/checklist/file/old.pdf',
      ],
      photo: { file_id: f.file_id, file_ctx: 'Z001/B1', as_string: true },
      gone: { file_id: '00000000-0000-4000-8000-000000000000', file_ctx: 'Z001/B1', url_key: 'url' },
    }],
  }));
  app.get('/plain', (_req, res) => res.json({ a: 1 }));
  app.get('/old', (_req, res) => res.json({ item: { image_url: 'http://localhost:5001/restaurant/file/1712-tea.webp', other: 'https://cdn.test/a.png' } }));
  app.get('/logo', (_req, res) => res.json({ company_logo_url: `http://localhost:5001/files/v/${f.file_id}` }));

  const res = await request(app).get('/x');
  const row = res.body.data[0];
  assert.match(row.attachment_url[0].file_url, /X-Amz-Expires=900/);
  assert.equal(row.attachment_url[0].file_id, f.file_id);
  assert.equal(row.attachment_url[0].file_ctx, undefined);
  // old URLs go out signed (same URL plus an expiring signature)
  assert.match(row.attachment_url[1], /^https:\/\/api\.myzodu\.com\/checklist\/file\/old\.pdf\?exp=\d+&sig=[\w-]{43}$/);
  assert.match(row.photo, /X-Amz-Expires=900/);
  assert.equal(row.gone.url, null);
  assert.equal(row.created_at, '2026-01-01T00:00:00.000Z');
  assert.deepEqual((await request(app).get('/plain')).body, { a: 1 });
  const old = (await request(app).get('/old')).body.item;
  assert.match(old.image_url, /^http:\/\/localhost:5001\/restaurant\/file\/1712-tea\.webp\?exp=\d+&sig=/);
  assert.equal(old.other, 'https://cdn.test/a.png');
  // a stored /files/v link (logo, invoice images, menu photos) goes out signed too
  const logo = (await request(app).get('/logo')).body.company_logo_url;
  assert.match(logo, new RegExp(`^http://localhost:5001/files/v/${f.file_id}\\?exp=\\d+&sig=[\\w-]{43}$`));
});

test('request bodies lose the signature on /files/v and old URLs, nothing else changes', async () => {
  const app = express();
  app.use(express.json());
  app.use(client.fileUrlsMiddleware);
  // what the route sees (sent as text: a JSON response would be signed again)
  app.post('/save', (req, res) => res.type('text').send(JSON.stringify(req.body)));
  const body = {
    item: { image_url: 'https://api.myzodu.com/restaurant/file/1712-tea.webp?exp=1793639700&sig=abc', price: 10 },
    list: ['http://localhost:5001/auth/file/logo.png?exp=1&sig=x', 'https://cdn.test/a.png?v=2', null],
    company_logo_url: 'http://localhost:5001/files/v/0b6a3f1e-0000-4000-8000-000000000000?exp=1&sig=y',
  };
  const res = await request(app).post('/save').send(body);
  assert.deepEqual(JSON.parse(res.text), {
    item: { image_url: 'https://api.myzodu.com/restaurant/file/1712-tea.webp', price: 10 },
    list: ['http://localhost:5001/auth/file/logo.png', 'https://cdn.test/a.png?v=2', null],
    company_logo_url: 'http://localhost:5001/files/v/0b6a3f1e-0000-4000-8000-000000000000',
  });
});

test('file-service down: refs come back with url null, the response still succeeds', async () => {
  const saved = process.env.FILE_SERVICE_URL;
  delete require.cache[require.resolve('../clients/file-client')];
  process.env.FILE_SERVICE_URL = 'http://127.0.0.1:1';
  const down = require('../clients/file-client');
  process.env.FILE_SERVICE_URL = saved;
  delete require.cache[require.resolve('../clients/file-client')];

  const app = express();
  app.use(down.fileUrlsMiddleware);
  app.get('/x', (_req, res) => res.json({ a: [{ file_id: '00000000-0000-4000-8000-000000000000', file_ctx: 'Z001/B1', url_key: 'url', n: 1 }] }));
  app.get('/old', (_req, res) => res.json({ logo: 'https://api.myzodu.com/auth/file/logo.png' }));
  const res = await request(app).get('/x');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { a: [{ file_id: '00000000-0000-4000-8000-000000000000', n: 1, url: null }] });
  assert.deepEqual((await request(app).get('/old')).body, { logo: 'https://api.myzodu.com/auth/file/logo.png' });
  await assert.rejects(down.stage({}, [multerFile(PNG, 'a.png', 'image/png')]), { status: 503 });
});
