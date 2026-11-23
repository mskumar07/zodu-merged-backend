// /api/checklists, /api/categories, security basics and /internal purge (supertest,
// real tokens from the fake auth-service, real Postgres).
const request = require('supertest');
const { bearer, USERS } = require('@zodu/security/testing');
const { pool, q1, reset, seedDirectory, createChecklist, localToday, T2, EMP, OTHER } = require('../helpers/db');
const { createApiApp } = require('../../src/api-app');

const app = createApiApp();
afterAll(() => pool.end());
beforeEach(async () => {
  await reset();
  await seedDirectory();
  await seedDirectory(T2, [OTHER]);
});

const owner = bearer(USERS.owner);
const cashier = bearer(USERS.cashier);

async function body(patch = {}) {
  return {
    name: 'Daily Store Opening',
    description: 'Pre-opening checks',
    priority: 'MEDIUM',
    schedule: { task_type: 'RECURRING', frequency: 'DAILY', every_n: 1, trigger_time: '23:59', start_date: await localToday(), ends: 'NEVER' },
    assign_mode: 'SPECIFIC',
    assignee_employee_ids: [EMP.cashier.employee_id],
    reviewer_employee_id: EMP.manager.employee_id,
    settings: { require_photo: true, allow_partial: true, allow_notes: true, enable_reminders: true },
    tasks: [{ title: 'Unlock and disarm alarm' }, { title: 'Billing counter ready', instructions: 'Printer, POS, cash float' }],
    ...patch,
  };
}

const create = async (patch, headers = owner) => request(app).post('/api/checklists').set(headers).send(await body(patch));

describe('security', () => {
  test('no token → 401', async () => {
    const res = await request(app).get('/api/checklists');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, code: 'UNAUTHENTICATED' });
  });

  test('no checklist permission → 403 on create', async () => {
    expect((await create({}, cashier)).status).toBe(403);
  });

  test('another company\'s checklist → 404, never 403', async () => {
    const { body: { data } } = await create();
    const other = bearer(USERS.other);
    expect((await request(app).get(`/api/checklists/${data.id}`).set(other)).status).toBe(404);
    expect((await request(app).patch(`/api/checklists/${data.id}/status`).set(other).send({ status: 'PAUSED' })).status).toBe(404);
    expect((await request(app).get(`/api/checklists/${data.id}?zodu_id=Z002`).set(owner)).status).toBe(404);
  });

  test('a path id that is not a UUID → 404', async () => {
    expect((await request(app).get('/api/checklists/123').set(owner)).status).toBe(404);
  });

  test('/internal purge needs auth-service\'s token', async () => {
    expect((await request(app).post('/internal/branches/Z001/B1/purge')).status).toBe(401);
    await create();
    const res = await request(app).post('/internal/branches/Z001/B1/purge').set('X-Internal-Token', 'a'.repeat(40));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ checklists: 1 });
    expect((await q1("SELECT count(*) AS n FROM ckl.checklists WHERE zodu_id = 'Z001'")).n).toBe(0);
  });
});

describe('create', () => {
  test('201: code, schedule, tasks, rules from the toggles, runs generated, assignee notified', async () => {
    const res = await create();
    expect(res.status).toBe(201);
    const c = res.body.data;
    expect(c).toMatchObject({
      code: 'CL-0001', status: 'ACTIVE', timezone: 'Asia/Kolkata', assign_mode: 'SPECIFIC',
      assignees: [{ employee_id: EMP.cashier.employee_id, name: EMP.cashier.name, is_active: true }],
      reviewer: { employee_id: EMP.manager.employee_id, name: EMP.manager.name },
      created_by: { user_id: USERS.owner.userId, name: EMP.owner.name },
      row_version: 1,
    });
    expect(c.schedule).toMatchObject({ task_type: 'RECURRING', frequency: 'DAILY', trigger_time: '23:59', weekdays: [] });
    expect(c.tasks.map((t) => t.title)).toEqual(['Unlock and disarm alarm', 'Billing counter ready']);
    expect(c.rules.map((r) => `${r.rule_type}:${r.offset_min}:${r.target}`).sort()).toEqual([
      'ESCALATE_AFTER_OVERDUE:60:REVIEWER', 'NOTIFY_ON_OVERDUE:0:ASSIGNEE', 'NOTIFY_REVIEWER_ON_SUBMIT:0:REVIEWER', 'REMIND_BEFORE_DUE:15:ASSIGNEE',
    ]);
    expect(c.next_occurrences).toHaveLength(5);
    expect(c.next_occurrences[0]).toEqual({ date: await localToday(), times: ['23:59'] });
    expect((await q1('SELECT count(*) AS n FROM ckl.runs WHERE checklist_id = $1', [c.id])).n).toBeGreaterThanOrEqual(1);
    const n = await q1('SELECT * FROM ckl.notifications WHERE recipient_user_id = $1', [USERS.cashier.userId]);
    expect(n).toMatchObject({ type: 'CHECKLIST_ASSIGNED', title: 'New checklist: Daily Store Opening' });
    expect((await create()).body.data.code).toBe('CL-0002');
  });

  test.each([
    ['bad schedule', { schedule: { task_type: 'RECURRING', frequency: 'WEEKLY', weekdays: [], trigger_time: '10:00', start_date: '2026-11-16' } }],
    ['no tasks', { tasks: [] }],
    ['specific without assignees', { assignee_employee_ids: [] }],
    ['51 tasks', { tasks: Array.from({ length: 51 }, (_, i) => ({ title: `t${i}` })) }],
    ['unknown time zone', { timezone: 'Mars/Olympus' }],
    ['start date far in the past', { schedule: { task_type: 'ONCE', trigger_time: '10:00', start_date: '2020-01-01' } }],
  ])('400: %s', async (_n, patch) => {
    const res = await create(patch);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test.each([
    ['inactive assignee', { assignee_employee_ids: [EMP.gone.employee_id] }, 'EMPLOYEE_NOT_FOUND'],
  ])('422: %s', async (_n, patch, code) => {
    const res = await create(patch);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(code);
  });

  test('Idempotency-Key: same body replays, another body → 422', async () => {
    const b = await body();
    const h = { ...owner, 'Idempotency-Key': 'drawer-open-0001' };
    const a = await request(app).post('/api/checklists').set(h).send(b);
    const again = await request(app).post('/api/checklists').set(h).send(b);
    expect(again.status).toBe(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body.data.id).toBe(a.body.data.id);
    expect((await q1('SELECT count(*) AS n FROM ckl.checklists')).n).toBe(1);
    const changed = await request(app).post('/api/checklists').set(h).send({ ...b, name: 'Other' });
    expect(changed.status).toBe(422);
    expect(changed.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  test('schedule preview uses the same SQL as generation', async () => {
    const res = await request(app).post('/api/checklists/schedule-preview').set(owner).send({
      schedule: { task_type: 'RECURRING', frequency: 'MONTHLY', monthly_by: 'WEEKDAY', nth: -1, nth_weekday: 5, trigger_time: '17:00', start_date: '2026-11-01' },
      from: '2026-11-01', count: 2,
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ date: '2026-11-27', times: ['17:00'] }, { date: '2026-12-25', times: ['17:00'] }]);
  });
});

describe('company settings', () => {
  const RULES = [
    { rule_type: 'REMIND_BEFORE_DUE', offset_min: 60, target: 'ASSIGNEE' },
    { rule_type: 'NOTIFY_ON_OVERDUE', target: 'ASSIGNEE' },
    { rule_type: 'ESCALATE_AFTER_OVERDUE', offset_min: 90, target: 'REVIEWER' },
    { rule_type: 'NOTIFY_REVIEWER_ON_SUBMIT', target: 'REVIEWER' },
    { rule_type: 'AUTO_CLOSE', offset_min: 180 },
  ];
  const put = (patch = {}, headers = owner) => request(app).put('/api/settings').set(headers)
    .send({ require_photo: false, allow_partial: false, allow_notes: true, rules: RULES, row_version: 0, ...patch });
  const keys = (rules) => rules.map((r) => `${r.rule_type}:${r.offset_min}:${r.target}`).sort();

  test('GET: the defaults until saved (row_version 0); anyone signed in may read', async () => {
    const res = await request(app).get('/api/settings').set(cashier);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ require_photo: true, allow_partial: true, allow_notes: true, row_version: 0 });
    expect(keys(res.body.data.rules)).toEqual([
      'ESCALATE_AFTER_OVERDUE:60:REVIEWER', 'NOTIFY_ON_OVERDUE:0:ASSIGNEE', 'NOTIFY_REVIEWER_ON_SUBMIT:0:REVIEWER', 'REMIND_BEFORE_DUE:15:ASSIGNEE',
    ]);
  });

  test('PUT needs checklist:edit; 409 on a stale row_version', async () => {
    expect((await put({}, cashier)).status).toBe(403);
    expect((await put()).status).toBe(200);
    const stale = await put({ row_version: 0 });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: 'SETTINGS_VERSION_CONFLICT', details: { row_version: 1 } });
  });

  test.each([
    ['auto close before escalation', [{ rule_type: 'ESCALATE_AFTER_OVERDUE', offset_min: 60 }, { rule_type: 'AUTO_CLOSE', offset_min: 30 }], 422, 'AUTO_CLOSE_BEFORE_ESCALATION'],
    ['streak without auto close', [{ rule_type: 'MISSED_STREAK', threshold: 3 }], 422, 'STREAK_NEEDS_AUTO_CLOSE'],
    ['reminder lead time too short', [{ rule_type: 'REMIND_BEFORE_DUE', offset_min: 2 }], 422, 'INVALID_REMINDER_OFFSET'],
    ['named employees (one branch only)', [{ rule_type: 'NOTIFY_ON_COMPLETE', target: 'CUSTOM', target_employee_ids: [EMP.cashier.employee_id] }], 400, undefined],
  ])('PUT %s → %i', async (_n, rules, status, code) => {
    const res = await put({ rules });
    expect(res.status).toBe(status);
    if (code) expect(res.body.code).toBe(code);
  });

  test('PUT applies to every checklist: approver-less escalates to the creator, hourly reminders fit the hour, open runs follow', async () => {
    const daily = (await create()).body.data;
    const hourly = (await create({
      reviewer_employee_id: null,
      schedule: { task_type: 'RECURRING', frequency: 'HOURLY', every_n: 1, all_day: true, start_date: await localToday() },
    })).body.data;
    const res = await put();
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ require_photo: false, allow_partial: false, row_version: 1, applied_to: 2 });

    const d = (await request(app).get(`/api/checklists/${daily.id}`).set(owner)).body.data;
    expect(keys(d.rules)).toEqual(['AUTO_CLOSE:180:ASSIGNEE', 'ESCALATE_AFTER_OVERDUE:90:REVIEWER', 'NOTIFY_ON_OVERDUE:0:ASSIGNEE', 'NOTIFY_REVIEWER_ON_SUBMIT:0:REVIEWER', 'REMIND_BEFORE_DUE:60:ASSIGNEE']);
    expect(d.settings).toEqual({ require_photo: false, allow_partial: false, allow_notes: true });
    expect(d.row_version).toBe(2);
    const h = (await request(app).get(`/api/checklists/${hourly.id}`).set(owner)).body.data;
    expect(keys(h.rules)).toEqual(['AUTO_CLOSE:180:ASSIGNEE', 'ESCALATE_AFTER_OVERDUE:90:CREATOR', 'NOTIFY_ON_OVERDUE:0:ASSIGNEE', 'REMIND_BEFORE_DUE:55:ASSIGNEE']);
    expect((await q1("SELECT count(*)::int AS n FROM ckl.runs WHERE checklist_id = $1 AND status IN ('TODO','IN_PROGRESS') AND allow_partial", [daily.id])).n).toBe(0);
  });

  test('create takes the company settings, whatever the request sends', async () => {
    await put({ rules: [{ rule_type: 'NOTIFY_ON_OVERDUE', target: 'ASSIGNEE' }] });
    const c = (await create({ settings: { require_photo: true, allow_partial: true, allow_notes: true, enable_reminders: true },
      rules: [{ rule_type: 'REMIND_BEFORE_DUE', offset_min: 30 }] })).body.data;
    expect(keys(c.rules)).toEqual(['NOTIFY_ON_OVERDUE:0:ASSIGNEE']);
    expect(c.settings).toEqual({ require_photo: false, allow_partial: false, allow_notes: true });
  });
});

describe('edit, status, duplicate, delete', () => {
  test('PUT: 409 on a stale row_version; NOW regenerates today\'s untouched runs with the new tasks', async () => {
    const c = (await create()).body.data;
    const put = async (patch) => request(app).put(`/api/checklists/${c.id}`).set(owner).send({ ...(await body()), ...patch });
    const stale = await put({ row_version: 7 });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: 'CHECKLIST_VERSION_CONFLICT', details: { row_version: 1 } });

    const ok = await put({ row_version: 1, apply_from: 'NOW', tasks: [{ title: 'Only task' }] });
    expect(ok.status).toBe(200);
    expect(ok.body.data.row_version).toBe(2);
    const items = await pool.query(
      'SELECT i.title FROM ckl.run_items i JOIN ckl.runs r ON r.id = i.run_id WHERE r.checklist_id = $1 AND r.run_date = $2',
      [c.id, await localToday()],
    );
    expect(items.rows.map((r) => r.title)).toEqual(['Only task']);
    // rules kept their ids (no re-sent reminders)
    expect(ok.body.data.rules.map((r) => r.id).sort()).toEqual(c.rules.map((r) => r.id).sort());
  });

  test('pause cancels/drops future runs; resume generates again', async () => {
    const c = (await create()).body.data;
    const pause = await request(app).patch(`/api/checklists/${c.id}/status`).set(owner).send({ status: 'PAUSED' });
    expect(pause.status).toBe(200);
    expect(pause.body.data.status).toBe('PAUSED');
    expect(pause.body.data.next_occurrences).toEqual([]);
    expect((await q1("SELECT count(*) AS n FROM ckl.runs WHERE checklist_id = $1 AND status IN ('TODO','IN_PROGRESS') AND slot_at > now()", [c.id])).n).toBe(0);
    await request(app).patch(`/api/checklists/${c.id}/status`).set(owner).send({ status: 'ACTIVE' });
    expect((await q1("SELECT count(*) AS n FROM ckl.runs WHERE checklist_id = $1 AND status = 'TODO'", [c.id])).n).toBeGreaterThanOrEqual(1);
  });

  test('duplicate → new code, PAUSED; delete → 204 then 404', async () => {
    const c = (await create()).body.data;
    const dup = await request(app).post(`/api/checklists/${c.id}/duplicate`).set(owner);
    expect(dup.status).toBe(201);
    expect(dup.body.data).toMatchObject({ code: 'CL-0002', status: 'PAUSED', name: 'Daily Store Opening (copy)' });
    expect(dup.body.data.tasks).toHaveLength(2);
    expect((await request(app).delete(`/api/checklists/${c.id}`).set(owner)).status).toBe(204);
    expect((await request(app).get(`/api/checklists/${c.id}`).set(owner)).status).toBe(404);
  });

  test('delete cancels every unfinished run (overdue, missed, in review), keeps completed ones, and they leave the boards', async () => {
    const c = (await create({ schedule: { task_type: 'RECURRING', frequency: 'DAILY', every_n: 1, trigger_time: '23:59', start_date: await localToday(), ends: 'NEVER' } })).body.data;
    const today = await localToday();
    // Yesterday's runs, as if generated then: one overdue, one missed, one in review, one done.
    const base = await q1('SELECT * FROM ckl.runs WHERE checklist_id = $1 ORDER BY slot_at LIMIT 1', [c.id]);
    const past = async (n, status) => q1(
      `INSERT INTO ckl.runs (zodu_id, branch_id, checklist_id, slot_at, run_date, sequence_no, assignee_employee_id, assignee_name,
                             title, priority, frequency, available_at, due_at, status, total_items, done_items, completed_at)
       SELECT zodu_id, branch_id, checklist_id, slot_at - make_interval(days => $2::int), run_date - $2::int, sequence_no + 100 + $2::int, assignee_employee_id, assignee_name,
              title, priority, frequency, available_at - make_interval(days => $2::int), due_at - make_interval(days => $2::int), $3::text, 2,
              CASE WHEN $3::text = 'COMPLETED' THEN 2 ELSE 0 END, CASE WHEN $3::text = 'COMPLETED' THEN now() - make_interval(days => $2::int) END
         FROM ckl.runs WHERE id = $1 RETURNING id`, [base.id, n, status]);
    const overdue = await past(1, 'TODO');
    const missed = await past(2, 'MISSED');
    const review = await past(3, 'PENDING_REVIEW');
    const done = await past(4, 'COMPLETED');
    const monthAgo = (await q1("SELECT to_char($1::date - 30, 'YYYY-MM-DD') AS d", [today])).d;
    const before = await request(app).get('/api/runs').query({ view: 'team', status: 'OVERDUE', from: monthAgo, to: today }).set(owner);
    expect(before.body.data.map((r) => r.id)).toEqual(expect.arrayContaining([overdue.id, missed.id]));

    expect((await request(app).delete(`/api/checklists/${c.id}`).set(owner)).status).toBe(204);
    const status = async (id) => (await q1('SELECT status FROM ckl.runs WHERE id = $1', [id])).status;
    expect([await status(overdue.id), await status(missed.id), await status(review.id)]).toEqual(['CANCELLED', 'CANCELLED', 'CANCELLED']);
    expect(await status(done.id)).toBe('COMPLETED');
    const after = await request(app).get('/api/runs').query({ view: 'team', status: 'OVERDUE', from: monthAgo, to: today }).set(owner);
    expect(after.body.data.filter((r) => r.checklist_id === c.id)).toEqual([]);
  });

  test('list: filters and keyset pagination', async () => {
    for (let i = 0; i < 3; i++) await create({ name: `List ${i}` });
    await create({ name: 'Weekly one', schedule: { task_type: 'RECURRING', frequency: 'WEEKLY', weekdays: [1], trigger_time: '10:00', start_date: await localToday() } });
    const p1 = await request(app).get('/api/checklists?limit=2').set(owner);
    expect(p1.body.data).toHaveLength(2);
    const p2 = await request(app).get(`/api/checklists?limit=2&cursor=${p1.body.pagination.next_cursor}`).set(owner);
    const ids = [...p1.body.data, ...p2.body.data].map((c) => c.id);
    expect(new Set(ids).size).toBe(4);
    expect(p2.body.pagination.next_cursor).toBeNull();
    const weekly = await request(app).get('/api/checklists?frequency=WEEKLY').set(owner);
    expect(weekly.body.data.map((c) => c.name)).toEqual(['Weekly one']);
    const search = await request(app).get('/api/checklists?search=list%201').set(owner);
    expect(search.body.data.map((c) => c.name)).toEqual(['List 1']);
  });
});

describe('task files', () => {
  // An upload as POST /task-files leaves it (file-service is not part of these tests).
  const upload = async (zodu = 'Z001', branch = 'B1', name = 'how-to.pdf') => (await pool.query(
    `INSERT INTO ckl.task_files (zodu_id, branch_id, file_id, file_name, content_type, uploaded_by_user_id)
     VALUES ($1, $2, gen_random_uuid()::text, $3, 'application/pdf', gen_random_uuid()) RETURNING id`,
    [zodu, branch, name],
  )).rows[0].id;

  test('saved on the task, kept through an edit, copied onto runs; a foreign or unknown file is refused', async () => {
    const pdf = await upload();
    const res = await create({ tasks: [{ title: 'Unlock', attachments: [{ id: pdf }] }, { title: 'Counter' }] });
    expect(res.status).toBe(201);
    expect(res.body.data.tasks[0].attachments).toEqual([expect.objectContaining({ id: pdf, file_name: 'how-to.pdf', content_type: 'application/pdf' })]);
    expect(res.body.data.tasks[1].attachments).toEqual([]);

    const items = (await pool.query(
      `SELECT i.position, i.attachments FROM ckl.run_items i JOIN ckl.runs r ON r.id = i.run_id
        WHERE i.run_id = (SELECT id FROM ckl.runs WHERE checklist_id = $1 ORDER BY slot_at LIMIT 1)
        ORDER BY i.position`, [res.body.data.id])).rows;
    expect(items[0].attachments).toEqual([expect.objectContaining({ id: pdf, file_name: 'how-to.pdf' })]);
    expect(items[1].attachments).toEqual([]);

    const def = res.body.data;
    const edit = await request(app).put(`/api/checklists/${def.id}`).set(owner).send(await body({
      row_version: def.row_version, tasks: [{ title: 'Counter' }, { title: 'Unlock', attachments: def.tasks[0].attachments }],
    }));
    expect(edit.status).toBe(200);
    expect(edit.body.data.tasks[1].attachments.map((a) => a.id)).toEqual([pdf]);

    const foreign = await upload('Z002', 'B9');
    expect((await create({ tasks: [{ title: 'X', attachments: [{ id: foreign }] }] })).body.code).toBe('TASK_FILE_NOT_FOUND');
    expect((await create({ tasks: [{ title: 'X', attachments: [{ id: '00000000-0000-4000-8000-000000000000' }] }] })).status).toBe(422);
  });

  test('upload needs checklist create or edit', async () => {
    expect((await request(app).post('/api/checklists/task-files').set(cashier)).status).toBe(403);
  });
});

describe('categories', () => {
  test('no defaults: each company creates its own; duplicates refused (any case)', async () => {
    expect((await request(app).get('/api/categories').set(cashier)).body.data).toEqual([]);
    const add = await request(app).post('/api/categories').set(owner).send({ name: 'Kitchen', color: '#123456' });
    expect(add.status).toBe(201);
    expect(add.body.data).toMatchObject({ name: 'Kitchen', color: '#123456' });
    expect((await request(app).post('/api/categories').set(owner).send({ name: 'kitchen' })).body.code).toBe('CATEGORY_EXISTS');
    expect((await request(app).post('/api/categories').set(cashier).send({ name: 'Bar' })).status).toBe(403);
    expect((await request(app).get('/api/categories').set(cashier)).body.data.map((c) => c.name)).toEqual(['Kitchen']);
    expect((await request(app).get('/api/categories').set(bearer(USERS.other))).body.data).toEqual([]);
  });

  test('rename / recolour shows on existing runs; delete leaves checklists uncategorised', async () => {
    const cat = (await request(app).post('/api/categories').set(owner).send({ name: 'Kitchen' })).body.data;
    await request(app).post('/api/categories').set(owner).send({ name: 'Bar' });
    const id = await createChecklist({ categoryId: cat.id, schedule: { trigger_time: '23:59' } });
    await q1("SELECT ckl.fn_generate_for_schedule($1, now() + interval '36 hours')", [id]);

    expect((await request(app).put(`/api/categories/${cat.id}`).set(owner).send({ name: 'bar' })).body.code).toBe('CATEGORY_EXISTS');
    expect((await request(app).put(`/api/categories/${cat.id}`).set(cashier).send({ name: 'Galley' })).status).toBe(403);
    const ren = await request(app).put(`/api/categories/${cat.id}`).set(owner).send({ name: 'Galley', color: '#0F766E' });
    expect(ren.body.data).toMatchObject({ id: cat.id, name: 'Galley', color: '#0F766E' });
    expect(await q1('SELECT DISTINCT category_name FROM ckl.runs WHERE checklist_id = $1', [id])).toEqual({ category_name: 'Galley' });
    expect((await request(app).put(`/api/categories/${cat.id}`).set(bearer(USERS.other)).send({ name: 'X' })).status).toBe(404);

    expect((await request(app).delete(`/api/categories/${cat.id}`).set(owner)).status).toBe(204);
    expect(await q1('SELECT category_id FROM ckl.checklists WHERE id = $1', [id])).toEqual({ category_id: null });
    expect((await request(app).get('/api/categories').set(owner)).body.data.map((c) => c.name)).toEqual(['Bar']);
    expect((await request(app).delete(`/api/categories/${cat.id}`).set(owner)).status).toBe(404);
  });
});
