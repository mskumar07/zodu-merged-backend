// /internal/employees/directory (checklist-v2 only) and who may call by-user.
const request = require('supertest');

const T = (c) => c.repeat(40);
process.env.INTERNAL_TOKEN_AUTH = T('a');
process.env.INTERNAL_TOKEN_CHECKLIST = T('c');
process.env.INTERNAL_TOKEN_CHECKLIST_V2 = T('v');

jest.mock('../src/database/connection', () => ({ query: jest.fn(), connect: jest.fn() }));
const db = require('../src/database/connection');
const app = require('../src/express-app');

const as = (c) => ({ 'X-Internal-Token': T(c) });
const row = (n) => ({
  employee_id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  user_id: `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  employee_name: `E${n}`, is_active: true, updated_at: '2026-11-01T10:00:00.000Z',
});

beforeEach(() => jest.clearAllMocks());

describe('callers', () => {
  test('directory: checklist_v2 only', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const url = '/internal/employees/directory?zodu_id=Z001&branch_id=B1';
    expect((await request(app).get(url).set(as('a'))).status).toBe(403);
    expect((await request(app).get(url).set(as('c'))).status).toBe(403);
    expect((await request(app).get(url)).status).toBe(401);
    expect((await request(app).get(url).set(as('v'))).status).toBe(200);
  });

  test('by-user: auth, checklist and checklist_v2; other routes stay auth-only', async () => {
    db.query.mockResolvedValue({ rows: [{ employee_id: 'E1' }] });
    const url = '/internal/employee/by-user?user_id=u&zodu_id=Z001&branch_id=B1';
    for (const c of ['a', 'c', 'v']) expect((await request(app).get(url).set(as(c))).status).toBe(200);
    expect((await request(app).post('/internal/branches/Z001/B1/purge').set(as('v'))).status).toBe(403);
  });
});

describe('directory', () => {
  test('pages by employee_id; next_cursor only when more rows exist', async () => {
    db.query.mockResolvedValueOnce({ rows: [row(1), row(2), row(3)] });
    const res = await request(app).get('/internal/employees/directory?zodu_id=Z001&branch_id=B1&limit=2').set(as('v'));
    expect(res.body.data.map((r) => r.employee_name)).toEqual(['E1', 'E2']);
    expect(res.body.next_cursor).toBe(row(2).employee_id);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/ORDER BY employee_id/);
    expect(params).toEqual(['Z001', 'B1', null, null, 3]);

    db.query.mockResolvedValueOnce({ rows: [row(3)] });
    const p2 = await request(app)
      .get(`/internal/employees/directory?zodu_id=Z001&branch_id=B1&limit=2&cursor=${res.body.next_cursor}&updated_since=2026-11-01T00:00:00Z`)
      .set(as('v'));
    expect(p2.body).toMatchObject({ data: [row(3)], next_cursor: null });
    expect(db.query.mock.calls[1][1]).toEqual(['Z001', 'B1', '2026-11-01T00:00:00Z', row(2).employee_id, 3]);
  });

  test('limit capped at 500; bad input → 400 before the database', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await request(app).get('/internal/employees/directory?zodu_id=Z001&branch_id=B1&limit=9999').set(as('v'));
    expect(db.query.mock.calls[0][1][4]).toBe(501);
    db.query.mockClear();
    for (const q of ['branch_id=B1', 'zodu_id=Z001', 'zodu_id=Z001&branch_id=B1&cursor=x', 'zodu_id=Z001&branch_id=B1&updated_since=nope']) {
      expect((await request(app).get(`/internal/employees/directory?${q}`).set(as('v'))).status).toBe(400);
    }
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('roster (attendance-service only)', () => {
  process.env.INTERNAL_TOKEN_ATTENDANCE = T('t');

  test('attendance only; scope required', async () => {
    db.query.mockResolvedValue({ rows: [{ employee_id: 'E1', name: 'A', status: 'active' }] });
    const url = '/internal/employees/roster?zodu_id=Z001&branch_id=B1';
    expect((await request(app).get(url)).status).toBe(401);
    for (const c of ['a', 'c', 'v']) expect((await request(app).get(url).set(as(c))).status).toBe(403);
    const ok = await request(app).get(url).set(as('t'));
    expect(ok.status).toBe(200);
    expect(ok.body.data).toHaveLength(1);
    expect(db.query.mock.calls[0][1]).toEqual(['Z001', 'B1']);
    expect((await request(app).get('/internal/employees/roster?zodu_id=Z001').set(as('t'))).status).toBe(400);
  });
});
