// Customer-route security of /api/checklists. The service layer is mocked,
// except the functions that scope by tenant themselves (attachments, progress),
// which run against a mocked repository: checklist C1 and instance I1 exist in Z001 / B1 only.
const request = require('supertest');
const { bearer, USERS } = require('@zodu/security/testing');

jest.mock('../src/database/connection', () => ({
  query: jest.fn(async () => ({ rows: [] })),
  connect: jest.fn(),
}));
jest.mock('../src/repository/checklist-repo', () => {
  const inTenant = (wanted) => async (id, { zodu_id, branch_id }) =>
    (id === wanted && zodu_id === 'Z001' && branch_id === 'B1' ? { id } : null);
  return {
    findById: jest.fn(inTenant('C1')),
    findInstance: jest.fn(inTenant('I1')),
    findAttachments: jest.fn(async () => []),
    deleteAttachment: jest.fn(async () => ({ file_url: [] })),
    upsertItemProgress: jest.fn(async () => ({})),
    getInstanceProgress: jest.fn(async () => []),
  };
});
jest.mock('../src/services/checklist-service', () => {
  const actual = jest.requireActual('../src/services/checklist-service');
  const ok = () => jest.fn(async () => ({ success: true, data: [] }));
  return {
    createChecklist: ok(), getAssignedEmployeesSummary: ok(), getMyTaskSummary: ok(), getMyAssignedTasks: ok(),
    getMyTaskDetail: ok(), getAssignedEmployees: ok(), getChecklists: ok(), getChecklistById: ok(),
    updateChecklist: ok(), updateTaskStatus: ok(), deleteChecklist: ok(), uploadAttachments: ok(), getInstances: ok(),
    deleteAttachment: jest.fn(actual.deleteAttachment),
    markItemProgress: jest.fn(actual.markItemProgress),
    getItemProgress: jest.fn(actual.getItemProgress),
  };
});

const service = require('../src/services/checklist-service');
const app = require('../src/express-app');

beforeEach(() => jest.clearAllMocks());

const B = '/api/checklists';

test('no token → 401', async () => {
  expect((await request(app).get(`${B}?zodu_id=Z001&branch_id=B1`)).status).toBe(401);
});

describe('another company / branch', () => {
  test('another zodu_id → 404 on read, update and delete; nothing reaches the database', async () => {
    const h = bearer(USERS.owner);
    expect((await request(app).get(`${B}/C1?zodu_id=Z002&branch_id=B1`).set(h)).status).toBe(404);
    expect((await request(app).put(`${B}/C1`).set(h).send({ zodu_id: 'Z002', branch_id: 'B1', title: 'x' })).status).toBe(404);
    expect((await request(app).delete(`${B}/C1`).set(h).send({ zodu_id: 'Z002', branch_id: 'B1' })).status).toBe(404);
    expect(service.getChecklistById).not.toHaveBeenCalled();
    expect(service.updateChecklist).not.toHaveBeenCalled();
    expect(service.deleteChecklist).not.toHaveBeenCalled();
  });

  test('list without zodu_id uses the token\'s company', async () => {
    await request(app).get(`${B}?branch_id=B2`).set(bearer(USERS.owner));
    expect(service.getChecklists).toHaveBeenCalledWith(expect.objectContaining({ zodu_id: 'Z001', branch_id: 'B2' }));
  });

  test('attachment delete and progress of another branch → 404', async () => {
    const h = bearer(USERS.owner);
    expect((await request(app).delete(`${B}/C1/attachments/F1?branch_id=B2`).set(h)).status).toBe(404);
    expect((await request(app).delete(`${B}/C1/attachments/F1?branch_id=B1`).set(h)).status).toBe(200);
    expect((await request(app).get(`${B}/progress/I1?branch_id=B2&employee_id=E-owner`).set(h)).status).toBe(404);
    expect((await request(app).get(`${B}/progress/I1?branch_id=B1&employee_id=E-owner`).set(h)).status).toBe(200);
  });

  test('another company\'s owner gets 404 on our progress', async () => {
    const res = await request(app).post(`${B}/progress`).set(bearer(USERS.other)).send({
      instance_id: '0b6a3f1e-0000-4000-8000-000000000001', item_id: '0b6a3f1e-0000-4000-8000-000000000002',
      employee_id: '0b6a3f1e-0000-4000-8000-000000000003', is_completed: true,
    });
    expect(res.status).toBe(404);
  });
});

describe('own tasks', () => {
  test('a cashier (no checklist permission) sees their own tasks only', async () => {
    const h = bearer(USERS.cashier);
    expect((await request(app).get(`${B}/my-tasks?employee_id=E-cashier`).set(h)).status).toBe(200);
    expect((await request(app).get(`${B}/my-tasks?employee_id=E-manager`).set(h)).status).toBe(403);
    expect((await request(app).get(`${B}/my-summary?employee_id=E-manager`).set(h)).status).toBe(403);
    expect((await request(app).get(`${B}/my-tasks/C1?employee_id=E-manager`).set(h)).status).toBe(403);
  });

  test('a manager (checklist:read) may look at anyone\'s', async () => {
    expect((await request(app).get(`${B}/my-tasks?employee_id=E-cashier`).set(bearer(USERS.manager))).status).toBe(200);
  });

  test('the cashier cannot list or manage checklists', async () => {
    const h = bearer(USERS.cashier);
    expect((await request(app).get(B).set(h)).status).toBe(403);
    expect((await request(app).post(B).set(h).send({})).status).toBe(403);
    expect((await request(app).delete(`${B}/C1`).set(h)).status).toBe(403);
    expect((await request(app).get(`${B}/assigned-employees?created_by=x`).set(h)).status).toBe(403);
  });
});

test('is_admin=true (every task in the branch) only for checklist managers', async () => {
  // manager has checklist:edit in the fake world, owner bypasses; a role with read only would not
  await request(app).get(`${B}/assigned-employees?created_by=E-manager&is_admin=true`).set(bearer(USERS.manager));
  expect(service.getAssignedEmployees).toHaveBeenLastCalledWith(expect.objectContaining({ is_admin: true }));
  const readOnly = bearer(USERS.manager, { role: 'Viewer', perms: ['checklist:read'] });
  await request(app).get(`${B}/assigned-employees?created_by=E-manager&is_admin=true`).set(readOnly);
  expect(service.getAssignedEmployees).toHaveBeenLastCalledWith(expect.objectContaining({ is_admin: false }));
});

test('deleting needs checklist:delete (the manager has none)', async () => {
  expect((await request(app).delete(`${B}/C1`).set(bearer(USERS.manager))).status).toBe(403);
  expect((await request(app).delete(`${B}/C1`).set(bearer(USERS.owner))).status).toBe(200);
});

test('multipart attachments with another company → 404', async () => {
  const res = await request(app).post(`${B}/C1/attachments`).set(bearer(USERS.owner))
    .field('zodu_id', 'Z002').field('branch_id', 'B1')
    .attach('files', Buffer.from('%PDF-1.4'), { filename: 'a.pdf', contentType: 'application/pdf' });
  expect(res.status).toBe(404);
  expect(service.uploadAttachments).not.toHaveBeenCalled();
});

test('limit capped, order injection refused', async () => {
  const h = bearer(USERS.owner);
  await request(app).get(`${B}?limit=999999`).set(h);
  expect(service.getChecklists).toHaveBeenCalledWith(expect.objectContaining({ limit: '500' }));
  expect((await request(app).get(`${B}?order=1;DROP%20TABLE%20x`).set(h)).status).toBe(400);
});
