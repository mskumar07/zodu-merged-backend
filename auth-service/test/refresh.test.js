const jwt = require('jsonwebtoken');
const {
  setup, teardown, owner, api, login, refresh, bearer, decode, sha, events, settle, conn,
} = require('./helpers');
const { getRedis } = require('../src/auth');

beforeAll(setup);
afterAll(teardown);

const FAILED = 'Invalid or expired refresh token';

// Moves a rotated token's "used at" back, as if the grace window had passed.
async function pastGrace(token) {
  const key = `rtused:${sha(token)}`;
  const used = JSON.parse(await getRedis().get(key));
  await getRedis().set(key, JSON.stringify({ ...used, at: used.at - 3600 }), 'KEEPTTL');
}

test('rotation: each refresh returns a new token; the session stays the same', async () => {
  const o = await owner();
  const first = (await login(o)).body.data;
  const res = await refresh(first.refresh_token);
  expect(res.status).toBe(200);
  const second = res.body.data;
  expect(second.refresh_token).not.toBe(first.refresh_token);
  expect(decode(second.access_token).sid).toBe(decode(first.access_token).sid);
  // same shape as login
  expect(second).toEqual(expect.objectContaining({
    access_token: expect.any(String), expires_in: 900, user: expect.any(Object), companies: expect.any(Array),
  }));
  expect((await refresh(second.refresh_token)).status).toBe(200);
});

test('parallel refreshes with one token (grace window) all get the same successor', async () => {
  const o = await owner();
  const { refresh_token } = (await login(o)).body.data;
  const results = await Promise.all([refresh(refresh_token), refresh(refresh_token), refresh(refresh_token)]);
  expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
  expect(new Set(results.map((r) => r.body.data.refresh_token)).size).toBe(1);
});

test('reuse after the grace window revokes the whole family', async () => {
  const o = await owner();
  const first = (await login(o)).body.data;
  const second = (await refresh(first.refresh_token)).body.data;
  await pastGrace(first.refresh_token);

  const reuse = await refresh(first.refresh_token);
  expect(reuse.status).toBe(401);
  expect(reuse.body.data.error).toBe(FAILED);
  // the legitimate successor is dead too
  expect((await refresh(second.refresh_token)).status).toBe(401);
  // and access tokens of the family are on the deny-list
  expect(await getRedis().exists(`revoked:sid:${decode(first.access_token).sid}`)).toBe(1);
  await settle();
  expect((await events(o.user_id, 'refresh_reuse_detected')).length).toBe(1);
  const { rows: [row] } = await conn.query('SELECT is_revoked, revoke_reason FROM tbl_user_sessions WHERE session_id = $1',
    [decode(first.access_token).sid]);
  expect(row).toEqual({ is_revoked: true, revoke_reason: 'refresh_reuse' });
});

test('a session is bound to its platform', async () => {
  const o = await owner();
  const { refresh_token } = (await login(o, { platform: 'desktop' })).body.data;
  expect((await refresh(refresh_token, { platform: 'mobile' })).status).toBe(401);
  // refused without burning the token for its owner
  expect((await refresh(refresh_token, { platform: 'desktop' })).status).toBe(200);
});

test('a legacy client (no platform header) adopts the platform it starts sending', async () => {
  const o = await owner();
  const { refresh_token } = (await login(o)).body.data;
  const res = await refresh(refresh_token, { platform: 'mobile' });
  expect(res.status).toBe(200);
  expect(decode(res.body.data.access_token).plt).toBe('mobile');
  expect((await refresh(res.body.data.refresh_token, { platform: 'desktop' })).status).toBe(401);
});

test('web: refresh with the cookie; the new token comes back as a cookie', async () => {
  const o = await owner();
  const loginRes = await login(o, { platform: 'web' });
  const cookie = loginRes.headers['set-cookie'].find((c) => c.startsWith('rt=')).split(';')[0];
  const res = await refresh(null, { platform: 'web', cookie });
  expect(res.status).toBe(200);
  expect(res.body.data.refresh_token).toBeUndefined();
  const next = res.headers['set-cookie'].find((c) => c.startsWith('rt=')).split(';')[0];
  expect(next).not.toBe(cookie);
});

test('a deactivated user cannot refresh, and the session is revoked', async () => {
  const o = await owner();
  const { refresh_token, access_token } = (await login(o)).body.data;
  await conn.query('UPDATE tbl_users SET is_active = false WHERE user_id = $1', [o.user_id]);
  expect((await refresh(refresh_token)).status).toBe(401);
  await conn.query('UPDATE tbl_users SET is_active = true WHERE user_id = $1', [o.user_id]);
  expect(await getRedis().exists(`revoked:sid:${decode(access_token).sid}`)).toBe(1);
});

test('role changes reach the token at the next refresh', async () => {
  const o = await owner();
  const { refresh_token } = (await login(o)).body.data;
  await conn.query(`UPDATE tbl_access_control SET can_delete = false
                     WHERE role_id = $1 AND module_id = (SELECT module_id FROM tbl_modules WHERE module_name = 'Expense')`, [o.role_id]);
  const perms = decode((await refresh(refresh_token)).body.data.access_token).perms;
  expect(perms).toContain('expense:read');
  expect(perms).not.toContain('expense:delete');
});

test('the absolute session lifetime is enforced', async () => {
  const o = await owner();
  const { refresh_token, access_token } = (await login(o)).body.data;
  await getRedis().hset(`fam:${decode(access_token).sid}`, 'abs', Math.floor(Date.now() / 1000) - 1);
  const res = await refresh(refresh_token);
  expect(res.status).toBe(401);
  expect(res.body.data.error).toMatch(/expired/i);
});

test('an unknown or malformed refresh token is refused', async () => {
  expect((await refresh('x'.repeat(64))).status).toBe(401);
  expect((await refresh('not-a-token')).status).toBe(401);
  expect((await refresh(null)).status).toBe(400);
});

describe('legacy HS256 refresh tokens (before the switch)', () => {
  async function legacySession(o) {
    const token = jwt.sign({ sub: o.user_id }, process.env.APP_SECRET, { expiresIn: '7d' });
    await conn.query(
      `INSERT INTO tbl_user_sessions (user_id, refresh_token, expires_at, is_revoked)
       VALUES ($1, $2, now() + interval '7 days', false)`,
      [o.user_id, token],
    );
    return token;
  }

  test('exchanged once for a new session; the old row is revoked; a later reuse fails', async () => {
    const o = await owner();
    const old = await legacySession(o);
    const res = await refresh(old);
    expect(res.status).toBe(200);
    expect(res.body.data.refresh_token).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(decode(res.body.data.access_token).sub).toBe(o.user_id);
    const { rows: [row] } = await conn.query('SELECT is_revoked, revoke_reason FROM tbl_user_sessions WHERE refresh_token = $1', [old]);
    expect(row).toEqual({ is_revoked: true, revoke_reason: 'migrated' });

    await getRedis().del(`legacyused:${sha(old)}`);   // grace window over
    expect((await refresh(old)).status).toBe(401);
    expect((await refresh(res.body.data.refresh_token)).status).toBe(200);
  });

  test('parallel exchanges of one old token share the new session', async () => {
    const o = await owner();
    const old = await legacySession(o);
    const results = await Promise.all([refresh(old), refresh(old), refresh(old)]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(new Set(results.map((r) => decode(r.body.data.access_token).sid)).size).toBe(1);
  });

  test('a forged old token (wrong secret) is refused', async () => {
    const o = await owner();
    const forged = jwt.sign({ sub: o.user_id }, 'guessed-secret', { expiresIn: '7d' });
    expect((await refresh(forged)).status).toBe(401);
  });

  test('old HS256 access tokens are refused on signed-in routes', async () => {
    const o = await owner();
    const old = jwt.sign({ user_id: o.user_id, zodu_id: o.zodu_id }, process.env.APP_SECRET, { expiresIn: '30d' });
    const res = await api().get('/api/my-companies').set(bearer(old));
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/Bearer/);
  });
});

test('logout revokes the session; the refresh token stops working', async () => {
  const o = await owner();
  const { refresh_token } = (await login(o)).body.data;
  const res = await api().post('/api/logout').send({ refresh_token });
  expect(res.status).toBe(200);
  expect(res.body.data.message).toBe('Logged out successfully');
  expect(res.headers['set-cookie'].some((c) => c.startsWith('rt=;') && /Max-Age=0/.test(c))).toBe(true);
  expect((await refresh(refresh_token)).status).toBe(401);
});
