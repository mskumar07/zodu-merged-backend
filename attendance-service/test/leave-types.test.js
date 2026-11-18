// Leave Settings → Leave Types: who may call each route, what is refused before the service sees it, and the
// rules between fields (the service, with the repository replaced).
const request = require('supertest');
const { bearer, USERS } = require('@zodu/security/testing');

jest.mock('../src/services/leave-type-service', () => ({
  list: jest.fn(async () => ({ success: true, data: [] })),
  get: jest.fn(async () => ({ success: true, data: {} })),
  create: jest.fn(async () => ({ success: true, data: {} })),
  update: jest.fn(async () => ({ success: true, data: {} })),
  remove: jest.fn(async () => ({ success: true, data: {} })),
}));

const service = require('../src/services/leave-type-service');
const app = require('../src/express-app');

const ID = '9f0a1c2e-0000-4000-8000-000000000000';
const NEW = { name: 'Study Leave', code: 'stl', annual_days: 5 };

beforeEach(() => jest.clearAllMocks());

describe('permissions', () => {
  test('no token → 401', async () => {
    expect((await request(app).get('/api/leave-types')).status).toBe(401);
  });

  test('any signed-in user may read the list and one type', async () => {
    const h = bearer(USERS.cashier);   // has no Settings permission at all
    expect((await request(app).get('/api/leave-types').set(h)).status).toBe(200);
    expect((await request(app).get(`/api/leave-types/${ID}`).set(h)).status).toBe(200);
  });

  test('adding, editing and deleting need the Settings module', async () => {
    const h = bearer(USERS.cashier);
    expect((await request(app).post('/api/leave-types').set(h).send(NEW)).status).toBe(403);
    expect((await request(app).put(`/api/leave-types/${ID}`).set(h).send({ name: 'x1' })).status).toBe(403);
    expect((await request(app).delete(`/api/leave-types/${ID}`).set(h)).status).toBe(403);
    expect(service.create).not.toHaveBeenCalled();
    expect(service.update).not.toHaveBeenCalled();
    expect(service.remove).not.toHaveBeenCalled();
  });

  test('a manager (settings read / create / edit, no delete) may add and edit but not delete', async () => {
    const h = bearer(USERS.manager);
    expect((await request(app).post('/api/leave-types').set(h).send(NEW)).status).toBe(201);
    expect((await request(app).put(`/api/leave-types/${ID}`).set(h).send({ name: 'Renamed' })).status).toBe(200);
    expect((await request(app).delete(`/api/leave-types/${ID}`).set(h)).status).toBe(403);
    expect(service.remove).not.toHaveBeenCalled();
  });

  test('the company Admin may do everything', async () => {
    const h = bearer(USERS.owner);
    expect((await request(app).delete(`/api/leave-types/${ID}`).set(h)).status).toBe(200);
    expect(service.remove).toHaveBeenCalledWith(expect.objectContaining({ zodu_id: 'Z001', branch_id: 'B1', leave_type_id: ID }));
  });
});

describe('company and branch come from the token', () => {
  test('another company in the query or body → 404, nothing reaches the service', async () => {
    const h = bearer(USERS.manager);
    expect((await request(app).get('/api/leave-types?zodu_id=Z002&branch_id=B1').set(h)).status).toBe(404);
    expect((await request(app).post('/api/leave-types').set(h).send({ ...NEW, zodu_id: 'Z002', branch_id: 'B1' })).status).toBe(404);
    expect(service.list).not.toHaveBeenCalled();
    expect(service.create).not.toHaveBeenCalled();
  });

  test('without zodu_id the token\'s company and branch are used', async () => {
    await request(app).get('/api/leave-types').set(bearer(USERS.manager));
    expect(service.list).toHaveBeenCalledWith(expect.objectContaining({ zodu_id: 'Z001', branch_id: 'B1', status: 'all' }));
  });
});

describe('validation', () => {
  const post = (body) => request(app).post('/api/leave-types').set(bearer(USERS.owner)).send(body);

  test('name, code and annual days are required', async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    expect(res.body.errors).toMatch(/name.*required/);
    expect(res.body.errors).toMatch(/code.*required/);
    expect(res.body.errors).toMatch(/annual_days.*required/);
    expect(service.create).not.toHaveBeenCalled();
  });

  test('the code is trimmed and stored upper-case; letters and digits only, up to 10', async () => {
    await post({ ...NEW, code: ' stl2 ' });
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({ code: 'STL2' }));
    expect((await post({ ...NEW, code: 'A B' })).status).toBe(400);
    expect((await post({ ...NEW, code: 'ABCDEFGHIJK' })).status).toBe(400);
  });

  test('defaults: paid, no carry forward, no encashment, all employees, active', async () => {
    await post(NEW);
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({
      is_paid: true, carry_forward: false, carry_forward_max_days: 0, encashment: false,
      applicable_to: 'ALL', department_ids: [], is_active: true,
    }));
  });

  test('annual days must be between 0 and 366; the date must be a real day', async () => {
    expect((await post({ ...NEW, annual_days: -1 })).status).toBe(400);
    expect((await post({ ...NEW, annual_days: 367 })).status).toBe(400);
    expect((await post({ ...NEW, effective_from: '2026-02-30' })).status).toBe(400);
    expect((await post({ ...NEW, annual_days: 180, effective_from: '2026-01-01' })).status).toBe(201);
  });

  test('unknown fields are refused', async () => {
    expect((await post({ ...NEW, salary: 1 })).status).toBe(400);
  });

  test('update: the id must be a GUID, and something must change', async () => {
    const h = bearer(USERS.owner);
    expect((await request(app).put('/api/leave-types/not-a-guid').set(h).send({ name: 'Renamed' })).status).toBe(400);
    expect((await request(app).put(`/api/leave-types/${ID}`).set(h).send({})).status).toBe(400);
    expect((await request(app).get('/api/leave-types/not-a-guid').set(h)).status).toBe(400);
    expect(service.update).not.toHaveBeenCalled();
  });

  test('list: status must be active, inactive or all', async () => {
    const h = bearer(USERS.owner);
    expect((await request(app).get('/api/leave-types?status=active').set(h)).status).toBe(200);
    expect((await request(app).get('/api/leave-types?status=deleted').set(h)).status).toBe(400);
  });
});

describe('answers', () => {
  test('a service refusal keeps its status and message', async () => {
    const { httpError } = require('../src/utils/http-error');
    service.get.mockRejectedValueOnce(httpError(404, 'Leave type not found'));
    const res = await request(app).get(`/api/leave-types/${ID}`).set(bearer(USERS.owner));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Leave type not found' });
  });

  test('anything unexpected is a plain 500 that does not leak the error', async () => {
    service.list.mockRejectedValueOnce(new Error('connection refused to 10.0.0.5'));
    const res = await request(app).get('/api/leave-types').set(bearer(USERS.owner));
    expect(res.status).toBe(500);
    expect(res.body.error).not.toMatch(/10\.0\.0\.5/);
  });
});
