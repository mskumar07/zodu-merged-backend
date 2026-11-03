// Customer-route security on auth-service's own routes: roles, company,
// branches, settings. Company and branch from the token; company and role
// changes need the Admin role; staff read settings but don't change them.
const {
  setup, teardown, owner, role, user, api, login, bearer,
} = require('./helpers');

beforeAll(setup);
afterAll(teardown);

const tokenOf = async (creds) => bearer((await login(creds)).body.data.access_token);

// A company with its Admin, a Billing Team cashier in B1, and a stranger's company.
async function shop() {
  const o = await owner();
  const billing = await role(o.zodu_id, { name: 'Billing Team', branch_id: 'B1', grants: { Billing: 'rc' } });
  const cashier = await user({ user_type: 'employee', memberships: [{ zodu_id: o.zodu_id, primary: true, roles: [{ role_id: billing, branch_id: 'B1' }] }] });
  const stranger = await owner();
  return {
    zodu_id: o.zodu_id, admin_role: o.role_id, billing,
    owner: await tokenOf(o), cashier: await tokenOf(cashier), stranger: await tokenOf(stranger),
  };
}

test('the role routes want a token', async () => {
  const s = await shop();
  expect((await api().get(`/api/roles?zodu_id=${s.zodu_id}&branch_id=B1`)).status).toBe(401);
  expect((await api().put(`/api/roles/${s.billing}`).send({ zodu_id: s.zodu_id, branch_id: 'B1', role_name: 'x' })).status).toBe(401);
  expect((await api().delete(`/api/roles/${s.billing}`).send({ zodu_id: s.zodu_id, branch_id: 'B1' })).status).toBe(401);
  expect((await api().post('/api/roles').send({ zodu_id: s.zodu_id, branch_id: 'B1', role_name: 'Boss', permissions: [] })).status).toBe(401);
});

test("another company's roles, company, branches and settings → 404", async () => {
  const s = await shop();
  const h = s.stranger;
  expect((await api().get(`/api/roles?zodu_id=${s.zodu_id}&branch_id=B1`).set(h)).status).toBe(404);
  expect((await api().put(`/api/roles/${s.billing}`).set(h).send({ zodu_id: s.zodu_id, branch_id: 'B1', role_name: 'x' })).status).toBe(404);
  expect((await api().put(`/api/company/edit/${s.zodu_id}`).set(h).send({ business_name: 'x' })).status).toBe(404);
  expect((await api().delete(`/api/branch/${s.zodu_id}/B1`).set(h)).status).toBe(404);
  expect((await api().get(`/api/invoice-settings/${s.zodu_id}/B1`).set(h)).status).toBe(404);
  expect((await api().put(`/api/pos-settings/${s.zodu_id}/B1`).set(h).send({})).status).toBe(404);
});

test('staff read settings but cannot change them, the company, branches or roles', async () => {
  const s = await shop();
  const h = s.cashier;
  // past the checks (the test company has no POS settings row: 400 from the service)
  expect([401, 403, 404]).not.toContain((await api().get(`/api/pos-settings/${s.zodu_id}/B1`).set(h)).status);
  expect((await api().get(`/api/roles?zodu_id=${s.zodu_id}&branch_id=B1`).set(h)).status).toBe(403);
  expect((await api().put(`/api/roles/${s.billing}`).set(h).send({ zodu_id: s.zodu_id, branch_id: 'B1', role_name: 'Billing Team', permissions: [] })).status).toBe(403);
  expect((await api().put(`/api/invoice-settings/${s.zodu_id}/B1`).set(h).send({})).status).toBe(403);
  expect((await api().put(`/api/company/edit/${s.zodu_id}`).set(h).send({ business_name: 'x' })).status).toBe(403);
  expect((await api().delete(`/api/company/${s.zodu_id}`).set(h)).status).toBe(403);
  expect((await api().delete(`/api/branch/${s.zodu_id}/B2`).set(h)).status).toBe(403);
  expect((await api().post('/api/branch/add').set(h).send({ zodu_id: s.zodu_id, branch_name: 'x' })).status).toBe(403);
  // a branch they are not assigned to
  expect((await api().get(`/api/pos-settings/${s.zodu_id}/B2`).set(h)).status).toBe(404);
});

test('the Admin manages roles; the Admin role itself cannot be renamed, deleted or created again', async () => {
  const s = await shop();
  const h = s.owner;
  const list = await api().get(`/api/roles?zodu_id=${s.zodu_id}&branch_id=B1`).set(h);
  expect(list.status).toBe(200);
  expect((await api().put(`/api/roles/${s.billing}`).set(h).send({ zodu_id: s.zodu_id, branch_id: 'B1', role_name: 'Counter' })).status).toBe(200);
  expect((await api().put(`/api/roles/${s.billing}`).set(h).send({ zodu_id: s.zodu_id, branch_id: 'B1', role_name: 'admin' })).status).toBe(400);
  expect((await api().put(`/api/roles/${s.admin_role}`).set(h).send({ zodu_id: s.zodu_id, branch_id: 'B1', role_name: 'Staff' })).status).toBe(400);
  expect((await api().delete(`/api/roles/${s.admin_role}`).set(h).send({ zodu_id: s.zodu_id, branch_id: 'B1' })).status).toBe(400);
  expect((await api().post('/api/roles').set(h).send({ zodu_id: s.zodu_id, branch_id: 'B1', role_name: 'Admin', permissions: [] })).status).toBe(400);
});

test('own role access and the company list need only the token', async () => {
  const s = await shop();
  expect((await api().get('/api/my-companies').set(s.cashier)).status).toBe(200);
  expect((await api().get(`/api/role-access?zodu_id=${s.zodu_id}&branch_id=B1`).set(s.cashier)).status).toBe(200);
  expect((await api().get('/api/my-companies')).status).toBe(401);
});

test('unknown routes are closed', async () => {
  const s = await shop();
  expect((await api().get('/api/debug').set(s.owner)).status).toBe(403);
});
