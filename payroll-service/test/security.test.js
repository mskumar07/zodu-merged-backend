// payroll-service has no customer routes; /internal takes per-service tokens.
process.env.NODE_ENV = 'test';
process.env.INTERNAL_TOKEN_EMPLOYEE = 'e'.repeat(40);
process.env.INTERNAL_TOKEN_AUTH = 'a'.repeat(40);

jest.mock('../src/services/salary-service', () => new Proxy({}, {
  get: () => jest.fn(async () => ({ success: true, data: {} })),
}));

const request = require('supertest');
const app = require('../src/express-app');

test('the old /api/salary routes are gone', async () => {
  for (const [m, p] of [['get', '/api/salary?zodu_id=Z001'], ['get', '/api/salary/E1'], ['get', '/api/salary/E1/history'], ['put', '/api/salary/E1']]) {
    expect((await request(app)[m](p)).status).toBe(404);
  }
});

test('/internal: no token → 401, another service\'s token → 403, the right one passes', async () => {
  expect((await request(app).get('/internal/salary/E1')).status).toBe(401);
  expect((await request(app).get('/internal/salary/E1').set('X-Internal-Token', 'a'.repeat(40))).status).toBe(403);
  expect((await request(app).get('/internal/salary/E1').set('X-Internal-Token', 'e'.repeat(40))).status).toBe(200);
});

test('security headers', async () => {
  const res = await request(app).get('/health');
  expect(res.headers['x-content-type-options']).toBe('nosniff');
  expect(res.headers['x-powered-by']).toBeUndefined();
});
