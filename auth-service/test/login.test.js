const argon2 = require('argon2');
const bcrypt = require('bcrypt');
const {
  setup, teardown, owner, user, company, role, api, login, decode, events, settle, conn,
} = require('./helpers');

beforeAll(setup);
afterAll(teardown);

const GENERIC = 'Invalid email/phone or password';

test('login with email: tokens, the same user/companies data as before, context', async () => {
  const o = await owner();
  const res = await login(o);
  expect(res.status).toBe(200);
  const d = res.body.data;
  expect(d.access_token).toBeTruthy();
  expect(d.refresh_token).toMatch(/^[A-Za-z0-9_-]{64}$/);
  expect(d.expires_in).toBe(900);
  expect(d.user).toMatchObject({ user_id: o.user_id, zodu_id: o.zodu_id, email: o.email });
  expect(d.companies).toEqual([expect.objectContaining({ zodu_id: o.zodu_id, is_primary: true })]);
  expect(d.context).toEqual({ zodu_id: o.zodu_id, branch_id: 'B1', role: 'Admin' });
  expect(res.headers['cache-control']).toBe('no-store');
});

test('login with phone', async () => {
  const o = await owner();
  const res = await api().post('/api/login').send({ phone_number: o.phone, password: o.password });
  expect(res.status).toBe(200);
});

test('the access token: ES256 at+jwt with the RFC 9068 claims and no PII', async () => {
  const o = await owner();
  const { access_token } = (await login(o)).body.data;
  const header = JSON.parse(Buffer.from(access_token.split('.')[0], 'base64url').toString());
  expect(header).toEqual({ alg: 'ES256', typ: 'at+jwt', kid: 'test-key-1' });
  const c = decode(access_token);
  expect(c).toMatchObject({
    sub: o.user_id, zid: o.zodu_id, bid: 'B1', role: 'Admin', utype: 'super_admin', plt: 'unknown',
    iss: 'zodu-auth', aud: 'zodu-api',
  });
  expect(c.perms).toEqual(expect.arrayContaining(['expense:read', 'expense:delete', 'employee:edit', 'settings:edit']));
  expect(c.exp - c.iat).toBe(900);
  for (const k of ['sid', 'jti', 'nbf']) expect(c[k]).toBeTruthy();
  const text = JSON.stringify(c);
  expect(text).not.toContain(o.email);
  expect(text).not.toContain(o.phone);
});

test('JWKS publishes the public key only', async () => {
  const res = await api().get('/.well-known/jwks.json');
  expect(res.status).toBe(200);
  expect(res.body.keys).toEqual([expect.objectContaining({ kid: 'test-key-1', alg: 'ES256', kty: 'EC', crv: 'P-256' })]);
  expect(res.body.keys[0].d).toBeUndefined();
});

describe('failures look the same', () => {
  test('wrong password and unknown account: same status and message, both run a hash', async () => {
    const o = await owner();
    const spy = jest.spyOn(argon2, 'verify');
    const wrong = await login(o, { password: 'not the password at all' });
    const unknown = await api().post('/api/login').send({ email: `nobody${Date.now()}@example.com`, password: 'whatever it is' });
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual({ data: { error: GENERIC } });
    expect(unknown.body).toEqual(wrong.body);
  });

  test.each([
    ['inactive', { is_active: false }, 'inactive'],
    ['deleted', { is_deleted: true }, 'deleted'],
    ['login_user=false', { login_user: false }, 'login_disabled'],
  ])('%s: generic error, real reason in the security log', async (_label, state, reason) => {
    const zodu_id = await company();
    const role_id = await role(zodu_id, { name: 'Admin' });
    const u = await user({ ...state, memberships: [{ zodu_id, primary: true, roles: [{ role_id }] }] });
    const res = await login(u);
    expect(res.status).toBe(401);
    expect(res.body.data.error).toBe(GENERIC);
    await settle();
    expect(await events(u.user_id, 'login_failed')).toEqual([expect.objectContaining({ details: { reason } })]);
  });

  test('validation: password longer than 128 characters is refused', async () => {
    const res = await api().post('/api/login').send({ email: 'a@b.co', password: 'x'.repeat(129) });
    expect(res.status).toBe(400);
  });
});

test('5 failures lock the account for 15 minutes, even with the right password (429 Retry-After)', async () => {
  const o = await owner();
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await login(o, { password: `wrong-${i}-password` })).status);
  expect(codes).toEqual([401, 401, 401, 401, 429]);
  const locked = await login(o);
  expect(locked.status).toBe(429);
  expect(Number(locked.headers['retry-after'])).toBeGreaterThan(800);
  await settle();
  expect((await events(o.user_id, 'lockout')).length).toBe(1);
});

test('bcrypt hashes are rehashed to argon2id at login', async () => {
  const o = await owner({ hash: 'bcrypt' });
  const before = (await conn.query('SELECT password_hash FROM tbl_users WHERE user_id = $1', [o.user_id])).rows[0].password_hash;
  expect(before).toMatch(/^\$2b\$/);
  expect((await login(o)).status).toBe(200);
  const after = (await conn.query('SELECT password_hash FROM tbl_users WHERE user_id = $1', [o.user_id])).rows[0].password_hash;
  expect(after).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
  expect(await bcrypt.compare(o.password, before)).toBe(true);
  expect((await login(o)).status).toBe(200);   // and the new hash works
});

test('web: refresh token only in an HttpOnly cookie on the gateway path', async () => {
  const o = await owner();
  const res = await login(o, { platform: 'web' });
  expect(res.status).toBe(200);
  expect(res.body.data.refresh_token).toBeUndefined();
  const cookie = res.headers['set-cookie'].find((c) => c.startsWith('rt='));
  expect(cookie).toMatch(/HttpOnly/);
  expect(cookie).toMatch(/Secure/);
  expect(cookie).toMatch(/SameSite=Strict/);
  expect(cookie).toMatch(/Path=\/auth\/api/);
  expect(decode(res.body.data.access_token).plt).toBe('web');
});

test('an unknown X-Client-Platform value is refused', async () => {
  const o = await owner();
  expect((await login(o, { platform: 'toaster' })).status).toBe(400);
});

test('a branch-scoped employee gets their own branch and only their permissions', async () => {
  const zodu_id = await company({ branches: ['B1', 'B2'] });
  const role_id = await role(zodu_id, { name: 'Billing Team', branch_id: 'B2', grants: { Billing: 'rc', Expense: 'r' } });
  const u = await user({ user_type: 'employee', memberships: [{ zodu_id, primary: true, roles: [{ role_id, branch_id: 'B2' }] }] });
  const c = decode((await login(u)).body.data.access_token);
  expect(c).toMatchObject({ zid: zodu_id, bid: 'B2', role: 'Billing Team', utype: 'employee' });
  expect(c.perms.sort()).toEqual(['billing:create', 'billing:read', 'expense:read']);
});

test('sign-up: the owner password needs 8 characters and must not be a common one', async () => {
  const base = {
    restaurant_name: 'Policy Cafe', phone_number: `8${String(Date.now()).slice(-9)}`, email: `policy${Date.now()}@example.com`, business_type: 'Restaurant',
  };
  const short = await api().post('/api/create-account').send({ ...base, password: 'Short1p' });
  expect(short.body.data.error).toBe('Password must be at least 8 characters');
  const common = await api().post('/api/create-account').send({ ...base, password: 'password1234' });
  expect(common.body.data.error).toMatch(/too common/);
  const ok = await api().post('/api/create-account').send({ ...base, password: 'a long passphrase nobody uses' });
  expect(ok.body.data.insertData.user_id).toBeTruthy();
  const { rows: [u] } = await conn.query('SELECT password_hash FROM tbl_users WHERE email = $1', [base.email]);
  expect(u.password_hash).toMatch(/^\$argon2id\$/);
});
