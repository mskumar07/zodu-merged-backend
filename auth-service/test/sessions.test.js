const {
  setup, teardown, owner, company, role, user, api, login, refresh, bearer, decode, events, settle, conn,
} = require('./helpers');
const repo = require('../src/repository/auth-repo');
const { getRedis } = require('../src/auth');

beforeAll(setup);
afterAll(teardown);

const fromEmployee = { 'X-Internal-Token': process.env.INTERNAL_TOKEN_EMPLOYEE };

describe('switch-context', () => {
  test('to another company the user belongs to: new token, same session, kept on refresh', async () => {
    const o = await owner();
    const second = await company({ branches: ['B1', 'B3'] });
    const r2 = await role(second, { name: 'Manager', grants: { Expense: 'r' } });
    await conn.query('INSERT INTO tbl_user_companies (user_id, zodu_id, is_primary) VALUES ($1, $2, false)', [o.user_id, second]);
    await conn.query('INSERT INTO tbl_user_roles (user_id, role_id, zodu_id) VALUES ($1, $2, $3)', [o.user_id, r2, second]);

    const first = (await login(o)).body.data;
    const res = await api().post('/api/switch-context').set(bearer(first.access_token)).send({ zodu_id: second, branch_id: 'B3' });
    expect(res.status).toBe(200);
    expect(res.body.data.context).toEqual({ zodu_id: second, branch_id: 'B3', role: 'Manager' });
    const c = decode(res.body.data.access_token);
    expect(c).toMatchObject({ zid: second, bid: 'B3', role: 'Manager', perms: ['expense:read'] });
    expect(c.sid).toBe(decode(first.access_token).sid);

    const after = decode((await refresh(first.refresh_token)).body.data.access_token);
    expect(after).toMatchObject({ zid: second, bid: 'B3' });
  });

  test('refused for a company the user does not belong to (404, logged)', async () => {
    const o = await owner();
    const other = await owner();
    const { access_token } = (await login(o)).body.data;
    const res = await api().post('/api/switch-context').set(bearer(access_token)).send({ zodu_id: other.zodu_id });
    expect(res.status).toBe(404);
    await settle();
    expect(await events(o.user_id, 'cross_tenant_attempt')).toEqual([
      expect.objectContaining({ details: expect.objectContaining({ requested_zodu_id: other.zodu_id }) }),
    ]);
  });

  test('refused for a branch outside the user\'s roles, and for a branch that does not exist', async () => {
    const zodu_id = await company({ branches: ['B1', 'B2'] });
    const role_id = await role(zodu_id, { name: 'Billing Team', branch_id: 'B1', grants: { Billing: 'r' } });
    const u = await user({ user_type: 'employee', memberships: [{ zodu_id, primary: true, roles: [{ role_id, branch_id: 'B1' }] }] });
    const { access_token } = (await login(u)).body.data;
    for (const branch_id of ['B2', 'B9']) {
      const res = await api().post('/api/switch-context').set(bearer(access_token)).send({ zodu_id, branch_id });
      expect(res.status).toBe(404);
    }
  });

  test('needs a valid access token', async () => {
    expect((await api().post('/api/switch-context').send({ zodu_id: 'Z001' })).status).toBe(401);
  });
});

describe('sessions', () => {
  test('list the user\'s devices and revoke one', async () => {
    const o = await owner();
    const desktop = (await login(o, { platform: 'desktop' })).body.data;
    const mobile = (await login(o, { platform: 'mobile' })).body.data;

    const list = await api().get('/api/sessions').set(bearer(desktop.access_token));
    expect(list.status).toBe(200);
    const sessions = list.body.data.sessions;
    expect(sessions.map((s) => s.platform).sort()).toEqual(['desktop', 'mobile']);
    expect(sessions.find((s) => s.current).session_id).toBe(decode(desktop.access_token).sid);
    expect(JSON.stringify(sessions)).not.toContain(desktop.refresh_token);

    const mobileSid = decode(mobile.access_token).sid;
    expect((await api().delete(`/api/sessions/${mobileSid}`).set(bearer(desktop.access_token))).status).toBe(200);
    expect((await refresh(mobile.refresh_token, { platform: 'mobile' })).status).toBe(401);
    expect((await refresh(desktop.refresh_token, { platform: 'desktop' })).status).toBe(200);
  });

  test('another user\'s session id → 404', async () => {
    const a = await owner();
    const b = await owner();
    const aTok = (await login(a)).body.data.access_token;
    const bSid = decode((await login(b)).body.data.access_token).sid;
    expect((await api().delete(`/api/sessions/${bSid}`).set(bearer(aTok))).status).toBe(404);
  });

  test('logout-all ends every session', async () => {
    const o = await owner();
    const one = (await login(o)).body.data;
    const two = (await login(o)).body.data;
    expect((await api().post('/api/logout-all').set(bearer(one.access_token))).status).toBe(200);
    expect((await refresh(one.refresh_token)).status).toBe(401);
    expect((await refresh(two.refresh_token)).status).toBe(401);
    expect(await getRedis().exists(`revoked:sid:${decode(two.access_token).sid}`)).toBe(1);
  });
});

describe('sessions are revoked when access changes', () => {
  async function employee() {
    const zodu_id = await company();
    const role_id = await role(zodu_id, { name: 'Billing Team', branch_id: 'B1', grants: { Billing: 'r' } });
    const u = await user({ user_type: 'employee', memberships: [{ zodu_id, primary: true, roles: [{ role_id, branch_id: 'B1' }] }] });
    return { ...u, zodu_id, role_id };
  }

  test('password change (employee login details)', async () => {
    const e = await employee();
    const { refresh_token } = (await login(e)).body.data;
    const res = await api().put('/internal/employee/login-details').set(fromEmployee)
      .send({ user_id: e.user_id, zodu_id: e.zodu_id, branch_id: 'B1', password: 'another fine passphrase' });
    expect(res.status).toBe(200);
    expect((await refresh(refresh_token)).status).toBe(401);
    expect((await login({ ...e, password: 'another fine passphrase' })).status).toBe(200);
  });

  test('login disabled', async () => {
    const e = await employee();
    const { refresh_token } = (await login(e)).body.data;
    await api().put('/internal/employee/login-details').set(fromEmployee)
      .send({ user_id: e.user_id, zodu_id: e.zodu_id, branch_id: 'B1', login_user: false });
    expect((await refresh(refresh_token)).status).toBe(401);
  });

  test('role permissions changed', async () => {
    const e = await employee();
    const { refresh_token } = (await login(e)).body.data;
    const { rows: [m] } = await conn.query("SELECT module_id FROM tbl_modules WHERE module_name = 'Billing'");
    const res = await api().put(`/api/roles/${e.role_id}`)
      .send({ zodu_id: e.zodu_id, branch_id: 'B1', role_name: 'Billing Team', permissions: [{ module_id: m.module_id, can_read: false }] });
    expect(res.status).toBe(200);
    expect((await refresh(refresh_token)).status).toBe(401);
  });

  test('employee passwords follow the policy: common ones are refused', async () => {
    const e = await employee();
    const res = await api().put('/internal/employee/login-details').set(fromEmployee)
      .send({ user_id: e.user_id, zodu_id: e.zodu_id, branch_id: 'B1', password: 'iloveyou123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too common/);
  });
});

describe('hardening', () => {
  test('security headers on auth-service responses', async () => {
    const res = await api().get('/.well-known/jwks.json');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-request-id']).toBeTruthy();
    expect(res.headers['access-control-allow-origin']).toBeUndefined();   // the gateway answers CORS
  });

  test('a 500 carries no stack trace, SQL or internals', async () => {
    const spy = jest.spyOn(repo, 'findUserForLogin')
      .mockRejectedValue(new Error('relation "tbl_users" does not exist at /app/src/repository/auth-repo.js:12'));
    const res = await api().post('/api/login').send({ email: 'x@example.com', password: 'whatever it is' });
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/tbl_users|auth-repo|at \//);
  });
});
