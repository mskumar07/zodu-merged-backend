// FILE_LINKS_REQUIRE_AUTH: a signed image link opens only with the Bearer
// token of the user it was issued to; a copied link opens for nobody else.
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { makeApp, INTERNAL_TOKEN, USERS, token, PNG } = require('./helpers');

const OLD = 'https://api.myzodu.com/restaurant/file/1776136462225-petrol.webp';
const bearer = (userId, zoduId = 'Z001') => ({ Authorization: `Bearer ${token(userId, zoduId, 'B1')}` });

function setup(config = {}) {
  const fs = makeApp({ config: { FILE_LINKS_REQUIRE_AUTH: true, ...config } });
  fs.storage.internal.legacy.set('1776136462225-petrol.webp', { buffer: PNG });
  return fs;
}

// Signs a URL the way a service does for its end user (X-User-Id).
const signFor = async (app, url, userId) => (await request(app).post('/internal/sign-links')
  .set('X-Internal-Token', INTERNAL_TOKEN).set(userId ? { 'X-User-Id': userId } : {})
  .send({ urls: [url] })).body.data[0].signed;

const legacyPath = (url) => `/legacy/1776136462225-petrol.webp${new URL(url).search}`;

// A menu photo ('link' module) uploaded by the admin; its /files/v link from the upload response.
async function menuPhoto(app) {
  const res = await request(app).post('/menu-items/M1').set(bearer(USERS.admin)).attach('files', PNG, 'dish.png');
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const { url } = res.body.data[0];
  return { url, path: `/v/${new URL(url).pathname.split('/').pop()}${new URL(url).search}` };
}

test('links are signed for the requesting user (&u=)', async () => {
  const { app } = setup();
  const signed = await signFor(app, OLD, USERS.admin);
  assert.match(signed, new RegExp(`\\?exp=\\d+&u=${USERS.admin}&sig=[\\w-]{43}$`));
  const { url } = await menuPhoto(app);
  assert.match(url, new RegExp(`&u=${USERS.admin}&sig=`));
});

test('old file link: needs the token of the user it was signed for', async () => {
  const { app } = setup();
  const path = legacyPath(await signFor(app, OLD, USERS.admin));

  assert.equal((await request(app).get(path)).status, 401);                               // no token
  assert.equal((await request(app).get(path).set(bearer(USERS.cashier))).status, 404);    // same company, other user
  assert.equal((await request(app).get(path).set(bearer(USERS.other, 'Z002'))).status, 404); // other company
  const ok = await request(app).get(path).set(bearer(USERS.admin));
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.vary, 'Authorization');
  assert.match(ok.headers['cache-control'], /^private, max-age=\d+$/);
});

test('/files/v link: needs the token of the user it was signed for', async () => {
  const { app } = setup();
  const { path } = await menuPhoto(app);
  assert.equal((await request(app).get(path)).status, 401);
  assert.equal((await request(app).get(path).set(bearer(USERS.cashier))).status, 404);
  assert.equal((await request(app).get(path).set(bearer(USERS.other, 'Z002'))).status, 404);
  assert.equal((await request(app).get(path).set(bearer(USERS.admin))).status, 200);
});

test('a link signed without a user, or with its user changed, opens for nobody', async () => {
  const { app } = setup();
  const anon = legacyPath(await signFor(app, OLD, null));
  assert.equal((await request(app).get(anon).set(bearer(USERS.admin))).status, 404);

  const swapped = legacyPath(await signFor(app, OLD, USERS.admin)).replace(USERS.admin, USERS.cashier);
  assert.equal((await request(app).get(swapped).set(bearer(USERS.cashier))).status, 404);
});

test('FILE_LINKS_UNSIGNED does not reopen access while auth is required', async () => {
  const { app } = setup({ FILE_LINKS_UNSIGNED: true });
  assert.equal((await request(app).get('/legacy/1776136462225-petrol.webp').set(bearer(USERS.admin))).status, 404);
});

test('switch off (default): a user-signed link still opens without a token', async () => {
  const { app } = setup({ FILE_LINKS_REQUIRE_AUTH: false });
  const path = legacyPath(await signFor(app, OLD, USERS.admin));
  const res = await request(app).get(path);
  assert.equal(res.status, 200);
  assert.equal(res.headers.vary, undefined);
  const { path: v } = await menuPhoto(app);
  assert.equal((await request(app).get(v)).status, 200);
});
