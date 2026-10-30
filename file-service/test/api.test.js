// HTTP behaviour against in-memory fakes: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const sharp = require('sharp');
const {
  makeApp, token, USERS, INTERNAL_TOKEN, PNG, pdf, docx,
} = require('./helpers');
const { MODULES } = require('../src/storage/modules');

const auth = (t = token()) => ({ Authorization: `Bearer ${t}` });
const asAdmin = (branch = 'B1') => ({ ...auth(), ...(branch && { 'X-Branch-Id': branch }) });
const asCashier = (branch = 'B1') => ({ ...auth(token(USERS.cashier)), 'X-Branch-Id': branch });
const asOtherTenant = () => ({ ...auth(token(USERS.other, 'Z002')), 'X-Branch-Id': 'B1' });

async function upload(app, { module, entity = 'E1', files, headers = asAdmin(), category }) {
  const req = request(app).post(`/${module}/${entity}${category ? `?category=${category}` : ''}`).set(headers);
  for (const [buf, name] of files) req.attach('files', buf, name);
  return req;
}

const jpegWithExif = () => sharp({ create: { width: 2400, height: 1200, channels: 3, background: '#c33' } })
  .jpeg()
  .withExif({ IFD0: { Make: 'SecretCam', Artist: 'Owner Name' }, IFD3: { GPSLatitudeRef: 'N' } })
  .toBuffer();

// ── upload: per-module types and limits ────────────────────────────────────
const SAMPLE = {
  'image/png': [PNG, 'a.png'],
  'application/pdf': [pdf('/Type/Catalog'), 'a.pdf'],
  'text/csv': [Buffer.from('a,b\n1,2\n'), 'a.csv'],
};

for (const [name, mod] of Object.entries(MODULES).filter(([, m]) => !m.internalOnly)) {
  test(`${name}: accepts an allowed type, refuses others and anything over ${mod.maxSizeMb}MB`, async () => {
    const { app } = makeApp();
    const okType = mod.allowedTypes.find((t) => SAMPLE[t]);
    const badType = Object.keys(SAMPLE).find((t) => !mod.allowedTypes.includes(t));
    const category = mod.categories?.[0];

    const ok = await upload(app, { module: name, files: [SAMPLE[okType]], category });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.data.length, 1);
    assert.deepEqual(Object.keys(ok.body.data[0]).sort(), ['file_id', 'mime_type', 'original_name', 'size_kb', 'url']);

    if (badType) {
      const bad = await upload(app, { module: name, files: [SAMPLE[badType]], category });
      assert.equal(bad.status, 415, `${badType} should be refused`);
    }

    const big = Buffer.concat([PNG, Buffer.alloc(mod.maxSizeMb * 1024 * 1024)]);
    const tooBig = await upload(app, { module: name, files: [[big, 'big.png']], category });
    assert.equal(tooBig.status, 413);
  });
}

test('unknown module and invalid category are 400', async () => {
  const { app } = makeApp();
  assert.equal((await upload(app, { module: 'salary', files: [[PNG, 'a.png']] })).status, 400);
  assert.equal((await upload(app, { module: 'employee', category: 'secret', files: [[PNG, 'a.png']] })).status, 400);
  assert.equal((await upload(app, { module: 'expense', entity: 'a.b', files: [[PNG, 'a.png']] })).status, 400);
});

test('branch module without X-Branch-Id is 400; tenant module goes to _shared', async () => {
  const { app, repo } = makeApp();
  assert.equal((await upload(app, { module: 'expense', headers: asAdmin(null), files: [[PNG, 'a.png']] })).status, 400);
  const res = await upload(app, { module: 'branding', category: 'logo', headers: asAdmin(null), files: [[PNG, 'logo.png']] });
  assert.equal(res.status, 201);
  const row = repo.rows.get(res.body.data[0].file_id);
  assert.equal(row.branch_id, null);
  assert.match(row.object_key, /^Z001\/_shared\/branding\/E1\/logo\/[0-9a-f-]{36}\.webp$/);
});

test('key layout, date folders, UUID names; original name only as metadata', async () => {
  const { app, repo, storage } = makeApp();
  const res = await upload(app, { module: 'expense', entity: 'EXP1001', files: [[PNG, '../../bill "march".png']] });
  assert.equal(res.status, 201);
  const row = repo.rows.get(res.body.data[0].file_id);
  const now = new Date();
  const ym = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  assert.match(row.object_key, new RegExp(`^Z001/B1/expense/EXP1001/${ym}/[0-9a-f-]{36}\\.png$`));
  assert.equal(row.original_name, 'bill march.png');
  assert.equal(row.uploaded_by, USERS.admin);
  assert.match(storage.objects.get(row.object_key).meta['Content-Disposition'], /^inline; filename="bill march.png"/);
});

// ── upload: all-or-nothing ─────────────────────────────────────────────────
test('one bad file in a batch: nothing stored, every rejection listed', async () => {
  const { app, repo, storage } = makeApp();
  const res = await upload(app, {
    module: 'expense',
    files: [[PNG, 'ok.png'], [pdf('/JS(app.alert(1))'), 'evil.pdf'], [PNG, 'fake.pdf']],
  });
  assert.equal(res.status, 422);
  assert.equal(res.body.details.length, 2);
  assert.deepEqual(res.body.details.map((d) => d.file), ['evil.pdf', 'fake.pdf']);
  assert.equal(storage.objects.size, 0);
  assert.equal(repo.rows.size, 0);
});

test('storage failure half way removes what was already stored', async () => {
  const { app, repo, storage } = makeApp();
  storage.failPutAfter = 1;
  const res = await upload(app, { module: 'expense', files: [[PNG, 'a.png'], [PNG, 'b.png']] });
  assert.equal(res.status, 500);
  assert.equal(res.body.error, 'Internal error');
  assert.equal(storage.objects.size, 0);
  assert.equal(repo.rows.size, 0);
});

test('DB failure after storing removes the objects again', async () => {
  const { app, storage, repo } = makeApp();
  repo.failInsert = true;
  const res = await upload(app, { module: 'expense', files: [[PNG, 'a.png'], [PNG, 'b.png']] });
  assert.equal(res.status, 500);
  assert.doesNotMatch(JSON.stringify(res.body), /db down|zodu-files|Z001\//);
  assert.equal(storage.objects.size, 0);
});

test('more than 10 files is refused', async () => {
  const { app } = makeApp();
  const res = await upload(app, { module: 'expense', files: Array.from({ length: 11 }, (_, i) => [PNG, `${i}.png`]) });
  assert.equal(res.status, 400);
});

// ── upload: spoofing and dangerous content ─────────────────────────────────
test('spoofed types are refused', async () => {
  const { app } = makeApp();
  const cases = [
    [PNG, 'invoice.pdf'],
    [Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]), 'photo.jpg'],
    [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), 'logo.svg'],
    [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'logo.png'],
    [Buffer.from('<html><script>alert(1)</script></html>'), 'page.html'],
    [Buffer.from('<html><script>alert(1)</script></html>'), 'page.jpg'],
  ];
  for (const file of cases) {
    const res = await upload(app, { module: 'expense', files: [file] });
    assert.equal(res.status, 415, file[1]);
  }
});

test('PDF JavaScript, macro .docx and CSV formulas are refused', async () => {
  const { app } = makeApp();
  const cases = [
    [pdf('/OpenAction<</S/JavaScript/JS(app.alert(1))>>'), 'a.pdf', 'expense'],
    [docx({ 'word/vbaProject.bin': 'x' }), 'a.docx', 'employee'],
    [Buffer.from('name,total\nx,=HYPERLINK("http://evil")\n'), 'a.csv', 'expense'],
  ];
  for (const [buf, name, module] of cases) {
    const res = await upload(app, { module, files: [[buf, name]], category: module === 'employee' ? 'documents' : undefined });
    assert.equal(res.status, 422, name);
  }
});

// ── transform ──────────────────────────────────────────────────────────────
test('menu images are resized to 1800px webp and EXIF is gone', async () => {
  const { app, storage, repo } = makeApp();
  const res = await upload(app, { module: 'menu-items', files: [[await jpegWithExif(), 'dosa.jpg']] });
  assert.equal(res.status, 201);
  assert.equal(res.body.data[0].mime_type, 'image/webp');
  const row = repo.rows.get(res.body.data[0].file_id);
  assert.match(row.object_key, /\.webp$/);
  const meta = await sharp(storage.objects.get(row.object_key).buffer).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.width, 1800);
  assert.equal(meta.exif, undefined);
});

test('images keep their type in modules without a transform, but EXIF is still stripped', async () => {
  const { app, storage, repo } = makeApp();
  const res = await upload(app, { module: 'expense', files: [[await jpegWithExif(), 'bill.jpg']] });
  assert.equal(res.status, 201);
  const row = repo.rows.get(res.body.data[0].file_id);
  const out = storage.objects.get(row.object_key).buffer;
  const meta = await sharp(out).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.equal(meta.width, 2400);
  assert.equal(meta.exif, undefined);
  assert.equal(out.includes(Buffer.from('SecretCam')), false);
});

// ── access ─────────────────────────────────────────────────────────────────
async function seed(app, { module = 'expense', headers = asAdmin(), category } = {}) {
  const res = await upload(app, { module, headers, category, files: [[PNG, 'a.png']] });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data[0].file_id;
}

test('no token or invalid token is 401', async () => {
  const { app } = makeApp();
  const id = await seed(app);
  assert.equal((await request(app).get(`/${id}/url`)).status, 401);
  assert.equal((await request(app).get(`/${id}/url`).set(auth('garbage'))).status, 401);
  assert.equal((await request(app).get(`/${id}/url`).set(auth(token(USERS.admin, 'Z001', 'wrong-secret')))).status, 401);
  // alg "none" must not pass
  const unsigned = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ user_id: USERS.admin, zodu_id: 'Z001' })).toString('base64url')}.`;
  assert.equal((await request(app).get(`/${id}/url`).set(auth(unsigned))).status, 401);
  assert.equal((await upload(app, { module: 'expense', headers: { 'X-Branch-Id': 'B1' }, files: [[PNG, 'a.png']] })).status, 401);
});

test('another zodu_id gets 404 on every file route', async () => {
  const { app } = makeApp();
  const id = await seed(app);
  for (const [method, path] of [['get', `/${id}/url`], ['get', `/${id}/content`], ['delete', `/${id}`]]) {
    const res = await request(app)[method](path).set(asOtherTenant());
    assert.equal(res.status, 404, `${method} ${path}`);
  }
  const batch = await request(app).post('/urls').set(asOtherTenant()).send({ file_ids: [id] });
  assert.deepEqual(batch.body.data, []);
});

test('another branch gets 404', async () => {
  const { app } = makeApp();
  const id = await seed(app);
  assert.equal((await request(app).get(`/${id}/url`).set(asAdmin('B2'))).status, 404);
  assert.equal((await request(app).get(`/${id}/url`).set(asAdmin(null))).status, 404);
});

test('X-Branch-Id the user is not assigned to (or that does not exist) is 404', async () => {
  const { app } = makeApp();
  const id = await seed(app, { headers: asAdmin('B1') });
  assert.equal((await request(app).get(`/${id}/url`).set(asCashier('B2'))).status, 404);
  assert.equal((await request(app).get(`/${id}/url`).set(asAdmin('B9'))).status, 404);
  assert.equal((await request(app).get(`/${id}/url`).set({ ...auth(), 'X-Branch-Id': '_shared' })).status, 400);
});

test('missing module permission is 403; ownership is checked first', async () => {
  const { app } = makeApp();
  const expense = await seed(app);
  const employee = await seed(app, { module: 'employee', category: 'documents' });
  assert.equal((await request(app).get(`/${expense}/url`).set(asCashier())).status, 200);
  assert.equal((await request(app).get(`/${employee}/url`).set(asCashier())).status, 403);
  assert.equal((await request(app).delete(`/${expense}`).set(asCashier())).status, 403);
  assert.equal((await upload(app, { module: 'menu-items', headers: asCashier(), files: [[PNG, 'a.png']] })).status, 403);
  // a foreign file stays 404 even for a route the user lacks permission on
  const foreign = await seed(app, { headers: asOtherTenant() });
  assert.equal((await request(app).get(`/${foreign}/url`).set(asCashier())).status, 404);
});

test('_shared files are readable from any of the tenant branches', async () => {
  const { app } = makeApp();
  const id = await seed(app, { module: 'documents', headers: asAdmin('B1') });
  assert.equal((await request(app).get(`/${id}/url`).set(asAdmin('B2'))).status, 200);
  assert.equal((await request(app).get(`/${id}/url`).set(asAdmin(null))).status, 200);
  assert.equal((await request(app).get(`/${id}/url`).set(asOtherTenant())).status, 404);
});

test('a user removed from the company is refused even with a valid token', async () => {
  const { app } = makeApp();
  const res = await request(app).get('/expense/E1').set({ ...auth(token(USERS.other, 'Z001')), 'X-Branch-Id': 'B1' });
  assert.equal(res.status, 403);
});

test('zodu_id / branch_id in body or query are ignored', async () => {
  const { app, repo } = makeApp();
  const res = await request(app).post('/expense/E1?zodu_id=Z002&branch_id=B2').set(asAdmin())
    .field('zodu_id', 'Z002').field('branch_id', 'B2').attach('files', PNG, 'a.png');
  assert.equal(res.status, 201);
  const row = repo.rows.get(res.body.data[0].file_id);
  assert.equal(row.zodu_id, 'Z001');
  assert.equal(row.branch_id, 'B1');
});

// ── downloads ──────────────────────────────────────────────────────────────
test('presigned URL: 900s expiry, forced type and disposition, no-store, logged', async () => {
  const { app, repo } = makeApp();
  const id = await seed(app);
  const res = await request(app).get(`/${id}/url`).set(asAdmin());
  assert.equal(res.status, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.body.data.expires_in_seconds, 900);
  const url = new URL(res.body.data.url);
  assert.equal(url.searchParams.get('X-Amz-Expires'), '900');
  assert.equal(url.searchParams.get('response-content-type'), 'image/png');
  assert.match(url.searchParams.get('response-content-disposition'), /^inline; filename="a.png"; filename\*=UTF-8''a.png$/);
  assert.deepEqual(repo.log.map((l) => l.action), ['url']);
  assert.equal(repo.log[0].user_id, USERS.admin);

  const dl = await request(app).get(`/${id}/url?download=1`).set(asAdmin());
  assert.match(new URL(dl.body.data.url).searchParams.get('response-content-disposition'), /^attachment;/);
  // the response never carries the key or bucket outside the signed URL itself
  assert.equal(JSON.stringify({ ...dl.body.data, url: undefined }).includes('Z001/'), false);
});

test('employee files never get a presigned URL, only the authorised stream', async () => {
  const { app, repo } = makeApp();
  const id = await seed(app, { module: 'employee', category: 'documents' });
  const res = await request(app).get(`/${id}/url?download=1`).set(asAdmin());
  assert.equal(res.body.data.url, `https://api.test/files/${id}/content?download=1`);
  assert.equal(res.body.data.expires_in_seconds, null);
  const list = await request(app).get('/employee/E1').set(asAdmin());
  assert.equal(list.body.data[0].url, `https://api.test/files/${id}/content`);
  assert.equal(repo.log.length, 0, 'logged when the stream is used, not when the URL is handed out');
  const dl = await request(app).get(`/${id}/content?download=1`).set(asAdmin());
  assert.match(dl.headers['content-disposition'], /^attachment;/);
  assert.deepEqual(repo.log.map((l) => l.action), ['content']);
});

test('batch URLs: max 100, foreign / missing / malformed ids left out', async () => {
  const { app } = makeApp();
  const mine = await seed(app);
  const menu = await seed(app, { module: 'menu-items' });
  const foreign = await seed(app, { headers: asOtherTenant() });
  const res = await request(app).post('/urls').set(asAdmin())
    .send({ file_ids: [mine, foreign, menu, '00000000-0000-4000-8000-000000000000', 'nope'] });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.map((d) => d.file_id), [mine, menu]);
  assert.equal(res.body.data[1].url, `https://api.test/files/v/${menu}`);
  assert.equal(res.body.data[1].expires_in_seconds, null);
  const tooMany = await request(app).post('/urls').set(asAdmin()).send({ file_ids: Array(101).fill(mine) });
  assert.equal(tooMany.status, 400);
});

test('content stream: headers per type, sandboxed except PDF, logged', async () => {
  const { app, repo, storage } = makeApp();
  const img = await seed(app, { module: 'employee', category: 'profile' });
  const res = await request(app).get(`/${img}/content`).set(asAdmin());
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'image/png');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['content-security-policy'], "default-src 'none'; sandbox");
  assert.deepEqual(res.body, storage.objects.get(repo.rows.get(img).object_key).buffer);

  const csv = await upload(app, { module: 'expense', files: [[Buffer.from('a,b\n1,2\n'), 'data.csv']] });
  const c = await request(app).get(`/${csv.body.data[0].file_id}/content`).set(asAdmin());
  assert.match(c.headers['content-disposition'], /^attachment;/);

  const p = await upload(app, { module: 'expense', files: [[pdf(), 'bill.pdf']] });
  const r = await request(app).get(`/${p.body.data[0].file_id}/content`).set(asAdmin());
  assert.equal(r.headers['content-security-policy'], undefined);
  assert.match(r.headers['content-disposition'], /^inline;/);
  assert.deepEqual(repo.log.map((l) => l.action), ['content', 'content', 'content']);
});

test('/v/:id serves link modules with a long cache and 404s private ones', async () => {
  const { app } = makeApp();
  const menu = await seed(app, { module: 'menu-items' });
  const expense = await seed(app);
  const ok = await request(app).get(`/v/${menu}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['cache-control'], 'public, max-age=31536000, immutable');
  assert.equal(ok.headers['cross-origin-resource-policy'], 'cross-origin');
  assert.equal(ok.headers['content-type'], 'image/webp');
  assert.equal((await request(app).get(`/v/${expense}`)).status, 404);
  assert.equal((await request(app).get('/v/not-a-uuid')).status, 404);
  assert.equal((await request(app).get('/v/00000000-0000-4000-8000-000000000000')).status, 404);
});

// ── list / delete ──────────────────────────────────────────────────────────
test('list a record, then delete one file and the whole record', async () => {
  const { app, repo } = makeApp();
  const a = await seed(app);
  const b = await seed(app);
  const list = await request(app).get('/expense/E1').set(asAdmin());
  assert.deepEqual(list.body.data.map((f) => f.file_id).sort(), [a, b].sort());
  assert.equal(list.body.data[0].entity_id, 'E1');

  assert.equal((await request(app).delete(`/${a}`).set(asAdmin())).status, 200);
  assert.equal((await request(app).get(`/${a}/url`).set(asAdmin())).status, 404);
  assert.equal((await request(app).delete(`/${a}`).set(asAdmin())).status, 404);

  const all = await request(app).delete('/expense/E1').set(asAdmin());
  assert.equal(all.body.data.deleted_count, 1);
  assert.equal((await request(app).get('/expense/E1').set(asAdmin())).body.data.length, 0);
  assert.equal(repo.log.filter((l) => l.action === 'delete').length, 2);
});

test('soft delete keeps the object (the purge job removes it later)', async () => {
  const { app, storage } = makeApp();
  const id = await seed(app, { module: 'menu-items' });
  await request(app).delete(`/${id}`).set(asAdmin());
  assert.equal(storage.objects.size, 1);
  assert.equal((await request(app).get(`/v/${id}`)).status, 404);
});

// ── internal ───────────────────────────────────────────────────────────────
const internal = (extra = {}) => ({
  'X-Internal-Token': INTERNAL_TOKEN, 'X-Zodu-Id': 'Z001', 'X-Branch-Id': 'B1', 'X-User-Id': USERS.cashier, ...extra,
});

test('/internal/* without a valid token is 401', async () => {
  const { app } = makeApp();
  for (const headers of [{}, { 'X-Internal-Token': 'x'.repeat(40) }, { 'X-Internal-Token': `${INTERNAL_TOKEN}x` }]) {
    const res = await request(app).post('/internal/resolve').set(headers).send({ file_ids: ['x'] });
    assert.equal(res.status, 401);
  }
  // a user's JWT is not an internal token
  assert.equal((await request(app).post('/internal/resolve').set(asAdmin()).send({ file_ids: ['x'] })).status, 401);
});

test('/internal/upload, /resolve, /store and /delete use the passed context', async () => {
  const { app, repo } = makeApp();
  const up = await request(app).post('/internal/upload?module=menu-items&entity_id=M1').set(internal())
    .attach('menu_image', PNG, 'tea.png');
  assert.equal(up.status, 400, 'only the "files" / "file" fields are accepted');

  const ok = await request(app).post('/internal/upload?module=employee&entity_id=EMP7&category=documents')
    .set(internal()).attach('file', pdf(), 'aadhaar.pdf');
  assert.equal(ok.status, 201);
  const row = repo.rows.get(ok.body.data[0].file_id);
  assert.equal(row.uploaded_by, USERS.cashier);
  assert.equal(row.branch_id, 'B1');

  const store = await request(app).post('/internal/store?module=invoice&entity_id=INV9&file_name=INV9.pdf')
    .set(internal()).set('Content-Type', 'application/pdf').send(pdf());
  assert.equal(store.status, 201);
  assert.equal(store.body.data.mime_type, 'application/pdf');

  const resolved = await request(app).post('/internal/resolve').set(internal())
    .send({ file_ids: [ok.body.data[0].file_id, store.body.data.file_id] });
  assert.equal(resolved.body.data.length, 2);
  // resolve fills the old URL fields of clients that can't send a token with a link: presigned, even for employee
  assert.match(resolved.body.data[0].url, /X-Amz-Expires=900/);
  assert.match(resolved.body.data[1].url, /X-Amz-Expires=900/);

  const otherBranch = await request(app).post('/internal/resolve').set(internal({ 'X-Branch-Id': 'B2' }))
    .send({ file_ids: [ok.body.data[0].file_id] });
  assert.deepEqual(otherBranch.body.data, []);

  const del = await request(app).post('/internal/delete').set(internal()).send({ module: 'invoice', entity_id: 'INV9' });
  assert.equal(del.body.data.deleted_count, 1);
});

test('/internal requires a zodu id', async () => {
  const { app } = makeApp();
  const res = await request(app).post('/internal/resolve').set({ 'X-Internal-Token': INTERNAL_TOKEN }).send({ file_ids: ['x'] });
  assert.equal(res.status, 400);
});

// ── rate limits and errors ─────────────────────────────────────────────────
test('uploads are limited to 30 requests a minute per user', async () => {
  const { app } = makeApp();
  let last;
  for (let i = 0; i < 31; i++) last = await upload(app, { module: 'expense', files: [[PNG, 'a.png']] });
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers['retry-after']) > 0);
  // another user still has budget
  assert.equal((await upload(app, { module: 'expense', headers: asCashier(), files: [[PNG, 'a.png']] })).status, 201);
});

test('a failing rate-limit store lets requests through', async () => {
  const { app } = makeApp({ store: { hit: async () => { throw new Error('redis down'); } } });
  assert.equal((await upload(app, { module: 'expense', files: [[PNG, 'a.png']] })).status, 201);
});

test('unknown routes are 404 and errors are JSON without internals', async () => {
  const { app } = makeApp();
  const res = await request(app).get('/a/b/c/d').set(asAdmin());
  assert.equal(res.status, 404);
  assert.equal(res.body.success, false);
  assert.equal(res.headers['x-powered-by'], undefined);
});
