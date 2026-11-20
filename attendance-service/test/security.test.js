// Customer-route security: token, company/branch from the token, permissions.
// The service layer is replaced by mocks, so each test sees exactly which
// company / branch would reach the database.
const request = require('supertest');
const { bearer, USERS } = require('@zodu/security/testing');

jest.mock('../src/services/attendance-service', () => ({
  markAttendance: jest.fn(async () => ({ success: true })),
  getEmployeesForMarking: jest.fn(async () => ({ success: true })),
  getTeamAttendance: jest.fn(async () => ({ success: true })),
  getTeamDay: jest.fn(async () => ({ success: true })),
  getMyAttendance: jest.fn(async () => ({ success: true })),
  checkIn: jest.fn(async () => ({ success: true, data: {} })),
  checkOut: jest.fn(async () => ({ success: true, data: {} })),
  PunchError: class PunchError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  },
}));
jest.mock('../src/repository/employee-repo', () => ({
  ...jest.requireActual('../src/repository/employee-repo'),
  findByUser: jest.fn(async () => ({ employee_id: 'E-own', name: 'Own Name', status: 'active' })),
}));

const attendance = require('../src/services/attendance-service');
const app = require('../src/express-app');

beforeEach(() => jest.clearAllMocks());

test('no token → 401 with WWW-Authenticate', async () => {
  const res = await request(app).get('/api/attendance/team');
  expect(res.status).toBe(401);
  expect(res.headers['www-authenticate']).toMatch(/Bearer/);
});

test('an unknown route under the API is closed', async () => {
  expect((await request(app).get('/api/payslips').set(bearer(USERS.owner))).status).toBe(403);
});

test('employee routes are not served here any more (employee-service has them): closed even for the owner', async () => {
  const h = bearer(USERS.owner);
  expect((await request(app).get('/api/employees').set(h)).status).toBe(403);
  expect((await request(app).post('/api/employees').set(h).send({})).status).toBe(403);
  expect((await request(app).put('/api/employees/E1').set(h).send({})).status).toBe(403);
  expect((await request(app).post('/api/employees/E1/documents').set(h)).status).toBe(403);
});

describe('another company', () => {
  test('zodu_id of another company in query → 404, nothing reaches the database', async () => {
    const h = bearer(USERS.manager);
    expect((await request(app).get('/api/attendance/team?zodu_id=Z002&branch_id=B1').set(h)).status).toBe(404);
    expect((await request(app).get('/api/attendance/team/daily?zodu_id=Z002&branch_id=B1').set(h)).status).toBe(404);
    expect(attendance.getTeamAttendance).not.toHaveBeenCalled();
    expect(attendance.getTeamDay).not.toHaveBeenCalled();
  });

  test('the owner of another company gets 404 too (no bypass outside its own company)', async () => {
    expect((await request(app).get('/api/attendance/team?zodu_id=Z001&branch_id=B1').set(bearer(USERS.other))).status).toBe(404);
  });

  test('without zodu_id the token company is used', async () => {
    await request(app).get('/api/attendance/team').set(bearer(USERS.manager));
    expect(attendance.getTeamAttendance).toHaveBeenCalledWith(expect.objectContaining({ zodu_id: 'Z001', branch_id: 'B1' }));
  });
});

describe('branch', () => {
  test('another branch the user may use is allowed', async () => {
    await request(app).get('/api/attendance/team?zodu_id=Z001&branch_id=B2').set(bearer(USERS.manager));
    expect(attendance.getTeamAttendance).toHaveBeenCalledWith(expect.objectContaining({ zodu_id: 'Z001', branch_id: 'B2' }));
  });

  test('a branch that does not exist, or one the user is not assigned to → 404', async () => {
    expect((await request(app).get('/api/attendance/team?branch_id=B9').set(bearer(USERS.manager))).status).toBe(404);
    expect((await request(app).get('/api/attendance/my?branch_id=B2&employee_id=E-own').set(bearer(USERS.cashier))).status).toBe(404);
  });
});

describe('permissions', () => {
  test('without attendance permissions → 403 on the team lists', async () => {
    const h = bearer(USERS.cashier);
    expect((await request(app).get('/api/attendance/team').set(h)).status).toBe(403);
    expect((await request(app).get('/api/attendance/team/daily').set(h)).status).toBe(403);
  });

  test('own attendance: allowed for anyone; another employee\'s needs attendance:read', async () => {
    const h = bearer(USERS.cashier);
    expect((await request(app).get('/api/attendance/my?employee_id=E-own').set(h)).status).toBe(200);
    expect((await request(app).get('/api/attendance/my?employee_id=E-someone-else').set(h)).status).toBe(403);
    expect((await request(app).get('/api/attendance/my?employee_id=E-someone-else').set(bearer(USERS.manager))).status).toBe(200);
    expect(attendance.getMyAttendance).toHaveBeenCalledTimes(2);
  });

  test('own attendance without employee_id resolves the signed-in employee', async () => {
    const res = await request(app).get('/api/attendance/my').set(bearer(USERS.cashier));
    expect(res.status).toBe(200);
    expect(attendance.getMyAttendance).toHaveBeenCalledWith(expect.objectContaining({ employee_id: 'E-own' }));
  });

  test('check-in / check-out: any signed-in employee, always for themselves', async () => {
    const h = bearer(USERS.cashier);
    // An employee_id in the body is ignored: the employee comes from the token.
    expect((await request(app).post('/api/attendance/check-in').set(h).send({ employee_id: 'E-someone-else' })).status).toBe(200);
    expect(attendance.checkIn).toHaveBeenCalledWith(expect.objectContaining({ employee: expect.objectContaining({ employee_id: 'E-own' }) }));
    expect((await request(app).post('/api/attendance/check-out').set(h).send({})).status).toBe(200);
    expect(attendance.checkOut).toHaveBeenCalledTimes(1);
    expect((await request(app).post('/api/attendance/check-in')).status).toBe(401);
  });

  test('check-in: a refused punch keeps its status, and an inactive employee is refused', async () => {
    attendance.checkIn.mockRejectedValueOnce(new attendance.PunchError(409, 'You have already checked in today'));
    const dup = await request(app).post('/api/attendance/check-in').set(bearer(USERS.cashier)).send({});
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatch(/already checked in/);

    require('../src/repository/employee-repo').findByUser.mockResolvedValueOnce({ employee_id: 'E-own', name: 'x', status: 'inactive' });
    expect((await request(app).post('/api/attendance/check-in').set(bearer(USERS.cashier)).send({})).status).toBe(403);
  });

  test('marking attendance needs attendance:create', async () => {
    expect((await request(app).post('/api/attendance').set(bearer(USERS.cashier)).send({})).status).toBe(403);
  });
});

describe('list queries', () => {
  test('limit is capped at 200', async () => {
    expect((await request(app).get('/api/attendance/team?limit=100000').set(bearer(USERS.manager))).status).toBe(400);
  });

  test('SQL in order is refused', async () => {
    expect((await request(app).get('/api/attendance/team?order=DESC;DROP%20TABLE%20tbl_attendance').set(bearer(USERS.manager))).status).toBe(400);
  });
});

test('security headers, no x-powered-by', async () => {
  const res = await request(app).get('/api/attendance/team').set(bearer(USERS.manager));
  expect(res.headers['x-content-type-options']).toBe('nosniff');
  expect(res.headers['x-powered-by']).toBeUndefined();
});
