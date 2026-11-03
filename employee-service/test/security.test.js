// Customer-route security: token, company/branch from the token, permissions.
// The service layer is replaced by mocks, so each test sees exactly which
// company / branch would reach the database.
const request = require('supertest');
const { bearer, USERS } = require('@zodu/security/testing');

jest.mock('../src/services/employee-service', () => ({
  createEmployee: jest.fn(async () => ({ success: true })),
  getEmployees: jest.fn(async () => ({ success: true, data: [] })),
  getEmployeeById: jest.fn(async () => ({ success: true, data: {} })),
  updateEmployee: jest.fn(async () => ({ success: true })),
  setLoginDetails: jest.fn(async () => ({ success: true })),
  deleteEmployee: jest.fn(async () => ({ success: true })),
  uploadDocument: jest.fn(async () => ({ success: true })),
  deleteDocument: jest.fn(async () => ({ success: true })),
}));
jest.mock('../src/services/attendance-service', () => ({
  markAttendance: jest.fn(async () => ({ success: true })),
  getEmployeesForMarking: jest.fn(async () => ({ success: true })),
  getTeamAttendance: jest.fn(async () => ({ success: true })),
  getMyAttendance: jest.fn(async () => ({ success: true })),
}));
// Only E1 in Z001 / B1 exists.
jest.mock('../src/repository/face-repo', () => ({
  findEmployee: jest.fn(async ({ employee_id, zodu_id, branch_id }) =>
    (employee_id === 'E1' && zodu_id === 'Z001' && branch_id === 'B1' ? { employee_id } : null)),
  findFaceStatus: jest.fn(async () => null),
  deleteFace: jest.fn(async () => true),
}));
jest.mock('../src/repository/employee-repo', () => ({
  ...jest.requireActual('../src/repository/employee-repo'),
  findByUser: jest.fn(async () => ({ employee_id: 'E-own' })),
}));

const service = require('../src/services/employee-service');
const attendance = require('../src/services/attendance-service');
const app = require('../src/express-app');

beforeEach(() => jest.clearAllMocks());

test('no token → 401 with WWW-Authenticate', async () => {
  const res = await request(app).get('/api/employees');
  expect(res.status).toBe(401);
  expect(res.headers['www-authenticate']).toMatch(/Bearer/);
});

test('an unknown route under the API is closed', async () => {
  expect((await request(app).get('/api/payslips').set(bearer(USERS.owner))).status).toBe(403);
});

test('/internal is unchanged: service token, not a user token', async () => {
  expect((await request(app).get('/internal/employee/by-user').set(bearer(USERS.owner))).status).toBe(401);
});

describe('another company', () => {
  test('zodu_id of another company in query / body → 404, nothing reaches the database', async () => {
    const h = bearer(USERS.manager);
    expect((await request(app).get('/api/employees?zodu_id=Z002&branch_id=B1').set(h)).status).toBe(404);
    expect((await request(app).get('/api/employees/E1?zodu_id=Z002&branch_id=B1').set(h)).status).toBe(404);
    expect((await request(app).put('/api/employees/E1').set(h).send({ zodu_id: 'Z002', branch_id: 'B1', name: 'x' })).status).toBe(404);
    expect((await request(app).put('/api/employees/active-inactive/E1').set(h).send({ zodu_id: 'Z002', branch_id: 'B1', status: 'Inactive' })).status).toBe(404);
    expect((await request(app).delete('/api/employees/E1/documents/D1').set(h).send({ zodu_id: 'Z002', branch_id: 'B1' })).status).toBe(404);
    expect(service.getEmployees).not.toHaveBeenCalled();
    expect(service.updateEmployee).not.toHaveBeenCalled();
    expect(service.deleteEmployee).not.toHaveBeenCalled();
    expect(service.deleteDocument).not.toHaveBeenCalled();
  });

  test('the owner of another company gets 404 too (no bypass outside its own company)', async () => {
    expect((await request(app).get('/api/employees?zodu_id=Z001&branch_id=B1').set(bearer(USERS.other))).status).toBe(404);
  });

  test('without zodu_id the token\'s company is used', async () => {
    await request(app).get('/api/employees').set(bearer(USERS.manager));
    expect(service.getEmployees).toHaveBeenCalledWith(expect.objectContaining({ zodu_id: 'Z001', branch_id: 'B1' }));
  });

  test('multipart upload with another company → 404', async () => {
    const res = await request(app).post('/api/employees/E1/documents').set(bearer(USERS.manager))
      .field('zodu_id', 'Z002').field('branch_id', 'B1').field('document_type', 'PAN')
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'a.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(404);
    expect(service.uploadDocument).not.toHaveBeenCalled();
  });
});

describe('branch', () => {
  test('another branch the user may use is allowed', async () => {
    await request(app).get('/api/employees?zodu_id=Z001&branch_id=B2').set(bearer(USERS.manager));
    expect(service.getEmployees).toHaveBeenCalledWith(expect.objectContaining({ zodu_id: 'Z001', branch_id: 'B2' }));
  });

  test('a branch that does not exist, or one the user is not assigned to → 404', async () => {
    expect((await request(app).get('/api/employees?branch_id=B9').set(bearer(USERS.manager))).status).toBe(404);
    expect((await request(app).get('/api/attendance/my?branch_id=B2&employee_id=E-own').set(bearer(USERS.cashier))).status).toBe(404);
  });

  test('a record of another branch: the face routes look it up in the request\'s branch → 404', async () => {
    expect((await request(app).get('/api/employees/E1/face?branch_id=B1').set(bearer(USERS.owner))).status).toBe(200);
    expect((await request(app).get('/api/employees/E1/face?branch_id=B2').set(bearer(USERS.owner))).status).toBe(404);
    expect((await request(app).delete('/api/employees/E1/face').set(bearer(USERS.other))).status).toBe(404);
  });
});

describe('permissions', () => {
  test('without employee permissions → 403 on every employee route', async () => {
    const h = bearer(USERS.cashier);
    expect((await request(app).get('/api/employees').set(h)).status).toBe(403);
    expect((await request(app).post('/api/employees').set(h).send({})).status).toBe(403);
    expect((await request(app).put('/api/employees/E1').set(h).send({})).status).toBe(403);
    expect((await request(app).put('/api/employees/E1/login-details').set(h).send({})).status).toBe(403);
  });

  test('assigning a role needs role:edit (the owner); a manager may only set the password', async () => {
    const body = { zodu_id: 'Z001', branch_id: 'B1', role_id: '9f0a1c2e-0000-4000-8000-000000000000' };
    expect((await request(app).put('/api/employees/E1/login-details').set(bearer(USERS.manager)).send(body)).status).toBe(403);
    expect(service.setLoginDetails).not.toHaveBeenCalled();
    const ok = await request(app).put('/api/employees/E1/login-details').set(bearer(USERS.owner)).send(body);
    expect(ok.status).toBe(200);
  });

  test('own attendance: allowed for anyone; another employee\'s needs attendance:read', async () => {
    const h = bearer(USERS.cashier);
    expect((await request(app).get('/api/attendance/my?employee_id=E-own').set(h)).status).toBe(200);
    expect((await request(app).get('/api/attendance/my?employee_id=E-someone-else').set(h)).status).toBe(403);
    expect((await request(app).get('/api/attendance/my?employee_id=E-someone-else').set(bearer(USERS.manager))).status).toBe(200);
    expect(attendance.getMyAttendance).toHaveBeenCalledTimes(2);
  });

  test('marking attendance needs attendance:create', async () => {
    expect((await request(app).post('/api/attendance').set(bearer(USERS.cashier)).send({})).status).toBe(403);
  });
});

test('mass assignment: the created employee gets the token\'s company, and the caller as creator', async () => {
  const forged = await request(app).post('/api/employees').set(bearer(USERS.owner))
    .send({ branch_id: 'B1', name: 'Asha', phone: '9876543210', created_by: 'someone-else' });
  expect(forged.status).toBe(400);   // unknown fields are refused by the schema
  const res = await request(app).post('/api/employees').set(bearer(USERS.owner))
    .send({ name: 'Asha', phone: '9876543210' });
  expect(res.status).toBe(201);
  const [input, createdBy] = service.createEmployee.mock.calls[0];
  expect(input.zodu_id).toBe('Z001');
  expect(createdBy).toBe(USERS.owner.userId);
});

describe('list queries', () => {
  test('limit is capped at 500', async () => {
    await request(app).get('/api/employees?limit=100000').set(bearer(USERS.manager));
    expect(service.getEmployees).toHaveBeenCalledWith(expect.objectContaining({ limit: '500' }));
  });

  test('SQL in order is refused', async () => {
    expect((await request(app).get('/api/employees?order=DESC;DROP%20TABLE%20tbl_employees').set(bearer(USERS.manager))).status).toBe(400);
  });
});

test('security headers, no x-powered-by', async () => {
  const res = await request(app).get('/api/employees').set(bearer(USERS.manager));
  expect(res.headers['x-content-type-options']).toBe('nosniff');
  expect(res.headers['x-powered-by']).toBeUndefined();
});
