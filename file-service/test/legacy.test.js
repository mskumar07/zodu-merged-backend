// Old /{service}/file/<key> URLs: signed into expiring links, refused unsigned.
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { makeApp, INTERNAL_TOKEN, PNG } = require('./helpers');
const { createSignedLinks } = require('../src/storage/signed-links');

const OLD = 'https://api.myzodu.com/restaurant/file/1776136462225-petrol.webp';

function setup(config) {
  const fs = makeApp({ config });
  fs.storage.internal.legacy.set('1776136462225-petrol.webp', { buffer: PNG });
  fs.storage.internal.legacy.set('checklist-attachments/abc/17-a b.pdf', { buffer: Buffer.from('%PDF-1.4') });
  return fs;
}

const signVia = async (app, urls) => (await request(app).post('/internal/sign-links')
  .set('X-Internal-Token', INTERNAL_TOKEN).send({ urls })).body;

const pathOf = (url) => `/legacy${new URL(url).pathname.replace(/^\/[a-z]+\/file/, '')}${new URL(url).search}`;

test('an old URL without a signature is a 404', async () => {
  const { app } = setup();
  assert.equal((await request(app).get('/legacy/1776136462225-petrol.webp')).status, 404);
  assert.equal((await request(app).get('/legacy/1776136462225-petrol.webp?exp=9999999999&sig=x')).status, 404);
});

test('a signed URL serves the file, cached only until it expires', async () => {
  const { app } = setup();
  const body = await signVia(app, [OLD, 'https://elsewhere.test/photo.png', 'not a url']);
  assert.equal(body.data.length, 1);
  const { url, signed } = body.data[0];
  assert.equal(url, OLD);
  assert.match(signed, /^https:\/\/api\.myzodu\.com\/restaurant\/file\/1776136462225-petrol\.webp\?exp=\d+&sig=[\w-]{43}$/);

  const res = await request(app).get(pathOf(signed));
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'image/webp');
  const maxAge = Number(/^private, max-age=(\d+)$/.exec(res.headers['cache-control'])[1]);
  assert.ok(maxAge > 900 && maxAge <= 1800, `max-age ${maxAge}`);
});

test('a signature is only good for its own key and expiry', async () => {
  const { app } = setup();
  const signed = (await signVia(app, [OLD])).data[0].signed;
  const q = new URL(signed).searchParams;
  const other = `/legacy/checklist-attachments/abc/17-a%20b.pdf?${q}`;
  assert.equal((await request(app).get(other)).status, 404);
  const later = `/legacy/1776136462225-petrol.webp?exp=${Number(q.get('exp')) + 900}&sig=${q.get('sig')}`;
  assert.equal((await request(app).get(later)).status, 404);
});

test('re-signing a signed URL replaces its old query; encoded keys work', async () => {
  const { app } = setup();
  const old = 'http://localhost:5001/checklist/file/checklist-attachments/abc/17-a%20b.pdf?exp=1&sig=stale';
  const signed = (await signVia(app, [old])).data[0].signed;
  assert.equal(signed.split('?')[0], old.split('?')[0]);
  assert.doesNotMatch(signed, /stale/);
  assert.equal((await request(app).get(pathOf(signed))).status, 200);
});

test('FILE_LINKS_UNSIGNED=true reopens unsigned access (rollout only)', async () => {
  const { app } = setup({ FILE_LINKS_UNSIGNED: true });
  const res = await request(app).get('/legacy/1776136462225-petrol.webp');
  assert.equal(res.status, 200);
  assert.match(res.headers['cache-control'], /public/);
});

test('sign-links needs the internal token', async () => {
  const { app } = setup();
  assert.equal((await request(app).post('/internal/sign-links').send({ urls: [OLD] })).status, 401);
});

test('links expire, and an expiry too far ahead is refused', () => {
  let now = Date.UTC(2026, 10, 2, 12, 0, 0);
  const links = createSignedLinks({ secret: 's'.repeat(40), ttlSeconds: 900, now: () => now });
  const q = new URL(links.sign(OLD)).searchParams;
  const query = { exp: q.get('exp'), sig: q.get('sig') };
  assert.ok(links.checkLegacy('1776136462225-petrol.webp', query).validFor > 900);
  now += 1800 * 1000;
  assert.equal(links.checkLegacy('1776136462225-petrol.webp', query), null);

  const far = String(Math.floor(now / 1000) + 10 * 900);
  const forged = createSignedLinks({ secret: 's'.repeat(40), ttlSeconds: 9000, now: () => now }).sign(OLD);
  assert.equal(links.checkLegacy('1776136462225-petrol.webp', { exp: far, sig: new URL(forged).searchParams.get('sig') }), null);
  assert.equal(links.sign('https://api.myzodu.com/restaurant/file/../secret'), null);
  assert.equal(links.sign('https://api.myzodu.com/payroll/file/x.png'), null);
});
