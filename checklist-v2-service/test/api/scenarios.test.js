// End-to-end scenarios (QA): the checklist life cycle the way people use it, across
// roles. Owner = Admin (everything), Manager = read/create/edit (no delete),
// Cashier = no checklist permission (works on what is assigned), Other = another company.
// Supertest + real tokens from the fake auth-service + real Postgres.
const request = require('supertest');
const { bearer, USERS } = require('@zodu/security/testing');
const { pool, q1, reset, seedDirectory, localToday, T2, EMP, OTHER } = require('../helpers/db');
const { createApiApp } = require('../../src/api-app');

const app = createApiApp();
afterAll(() => pool.end());
beforeEach(async () => {
  await reset();
  await seedDirectory();
  await seedDirectory(T2, [OTHER]);
});

const owner = bearer(USERS.owner);
const manager = bearer(USERS.manager);
const cashier = bearer(USERS.cashier);
const other = bearer(USERS.other);

const api = {
  create: (who, body) => request(app).post('/api/checklists').set(who).send(body),
  get: (who, id) => request(app).get(`/api/checklists/${id}`).set(who),
  edit: (who, id, body) => request(app).put(`/api/checklists/${id}`).set(who).send(body),
  status: (who, id, status) => request(app).patch(`/api/checklists/${id}/status`).set(who).send({ status }),
  remove: (who, id) => request(app).delete(`/api/checklists/${id}`).set(who),
  board: (who, date, view = 'my') => request(app).get('/api/runs').query({ date, view }).set(who),
  summary: (who, date, view = 'my') => request(app).get('/api/runs/summary').query({ date, view }).set(who),
  run: (who, id) => request(app).get(`/api/runs/${id}`).set(who),
  item: (who, runId, itemId, body) => request(app).put(`/api/runs/${runId}/items/${itemId}`).set(who).send(body),
  completeAll: (who, runId, v) => request(app).post(`/api/runs/${runId}/complete-all`).set(who).send({ row_version: v }),
  review: (who, runId, v, decision, comment) => request(app).post(`/api/runs/${runId}/review`).set(who).send({ row_version: v, decision, comment }),
  preview: (who, schedule, from, count = 5) => request(app).post('/api/checklists/schedule-preview').set(who).send({ schedule, from, count }),
};

async function checklist(patch = {}) {
  return {
    name: 'Store Opening',
    description: null,
    priority: 'HIGH',
    schedule: { task_type: 'RECURRING', frequency: 'DAILY', every_n: 1, trigger_time: '23:59', start_date: await localToday(), ends: 'NEVER' },
    assign_mode: 'SPECIFIC',
    assignee_employee_ids: [EMP.cashier.employee_id],
    reviewer_employee_id: null,
    tasks: [{ title: 'Unlock doors' }, { title: 'Count the cash float', instructions: 'Rs 2000 in the drawer' }, { title: 'Switch on the billing PC' }],
    ...patch,
  };
}

// Runs of a checklist, one line each: "date HH:MM STATUS assignee".
async function runsOf(id) {
  const { rows } = await pool.query(
    `SELECT run_date::text d, to_char(slot_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') t, status,
            coalesce(assignee_name, 'ALL') a
       FROM ckl.runs WHERE checklist_id = $1 ORDER BY 1, 2, 4`, [id]);
  return rows.map((r) => `${r.d} ${r.t} ${r.status} ${r.a}`);
}
const mine = async (who, date, checklistId) => (await api.board(who, date)).body.data.filter((r) => r.checklist_id === checklistId);

// ── S1 · Create ──────────────────────────────────────────────────────────────
describe('S1 · a manager creates a daily checklist', () => {
  test('happy path: 201, optional description, runs for today, cashier sees it on My board and is told', async () => {
    const res = await api.create(manager, await checklist());
    expect(res.status).toBe(201);
    const c = res.body.data;
    expect(c).toMatchObject({ code: 'CL-0001', name: 'Store Opening', description: null, status: 'ACTIVE', assign_mode: 'SPECIFIC', row_version: 1 });
    expect(c.tasks.map((t) => t.title)).toEqual(['Unlock doors', 'Count the cash float', 'Switch on the billing PC']);

    const today = await localToday();
    const board = await mine(cashier, today, c.id);
    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({ status: 'TODO', board_status: 'TODO', assignee: { name: EMP.cashier.name }, progress: { done: 0, total: 3 } });
    const told = await q1(`SELECT count(*) n FROM ckl.notifications WHERE recipient_user_id = $1 AND type = 'CHECKLIST_ASSIGNED'`, [USERS.cashier.userId]);
    expect(told.n).toBe(1);
  });

  test.each([
    ['no name', { name: '' }],
    ['name over 150 characters', { name: 'x'.repeat(151) }],
    ['one-time without a time', { schedule: { task_type: 'ONCE', start_date: '2026-12-01' } }],
    ['hourly window ends before it starts', { schedule: { task_type: 'RECURRING', frequency: 'HOURLY', window_start: '12:00', window_end: '09:00', start_date: '2026-12-01' } }],
    ['monthly without a pattern', { schedule: { task_type: 'RECURRING', frequency: 'MONTHLY', trigger_time: '10:00', start_date: '2026-12-01' } }],
    ['"ends after" without a count', { schedule: { task_type: 'RECURRING', frequency: 'DAILY', trigger_time: '10:00', start_date: '2026-12-01', ends: 'AFTER' } }],
    ['end date before the start date', { schedule: { task_type: 'RECURRING', frequency: 'DAILY', trigger_time: '10:00', start_date: '2026-12-10', ends: 'ON_DATE', end_date: '2026-12-01' } }],
    ['an impossible date', { schedule: { task_type: 'ONCE', trigger_time: '10:00', start_date: '2026-02-30' } }],
    ['a task without a title', { tasks: [{ title: '' }] }],
    ['6 files on one task', { tasks: [{ title: 'X', attachments: Array.from({ length: 6 }, () => ({ id: '00000000-0000-4000-8000-000000000000' })) }] }],
  ])('400: %s', async (_n, patch) => {
    const res = await api.create(manager, await checklist(patch));
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('422: unknown category, inactive or another company\'s employee as assignee or reviewer', async () => {
    expect((await api.create(manager, await checklist({ category_id: '00000000-0000-4000-8000-000000000000' }))).body.code).toBe('CATEGORY_NOT_FOUND');
    expect((await api.create(manager, await checklist({ assignee_employee_ids: [EMP.gone.employee_id] }))).body.code).toBe('EMPLOYEE_NOT_FOUND');
    expect((await api.create(manager, await checklist({ assignee_employee_ids: [OTHER.employee_id] }))).body.code).toBe('EMPLOYEE_NOT_FOUND');
    expect((await api.create(manager, await checklist({ reviewer_employee_id: EMP.gone.employee_id }))).body.code).toBe('EMPLOYEE_NOT_FOUND');
  });

  test('403 for the cashier; nothing is created', async () => {
    expect((await api.create(cashier, await checklist())).status).toBe(403);
    expect((await q1('SELECT count(*) n FROM ckl.checklists')).n).toBe(0);
  });
});

// ── S2 · Complete ────────────────────────────────────────────────────────────
describe('S2 · the cashier completes it; the reviewer approves', () => {
  test('tick, note, untick, stale version, complete-all → review → approve; then it is closed', async () => {
    const c = (await api.create(manager, await checklist({ reviewer_employee_id: EMP.owner.employee_id }))).body.data;
    const today = await localToday();
    const [row] = await mine(cashier, today, c.id);
    let run = (await api.run(cashier, row.id)).body.data;
    const [i1, i2] = run.items;

    // tick → In progress; a note; untick → back to To do
    let r = await api.item(cashier, run.id, i1.id, { is_done: true });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ status: 'IN_PROGRESS', progress: { done: 1, total: 3 } });
    expect(r.body.data.items[0]).toMatchObject({ is_done: true, done_by: { employee_id: EMP.cashier.employee_id, name: EMP.cashier.name } });
    expect(r.body.data.items[0].done_at).toBeTruthy();
    r = await api.item(cashier, run.id, i2.id, { note: 'Float short by Rs 50' });
    expect(r.body.data.items[1].note).toBe('Float short by Rs 50');
    r = await api.item(cashier, run.id, i1.id, { is_done: false });
    expect(r.body.data.progress.done).toBe(0);

    // the cashier asking for the team board only ever gets their own runs
    const teamAsCashier = (await api.board(cashier, today, 'team')).body.data;
    expect(teamAsCashier.every((x) => x.assignee && x.assignee.name === EMP.cashier.name)).toBe(true);

    // complete-all with an old version → 409; with the current one → waiting for review
    run = (await api.run(cashier, run.id)).body.data;
    expect((await api.completeAll(cashier, run.id, run.row_version - 1)).status).toBe(409);
    r = await api.completeAll(cashier, run.id, run.row_version);
    expect(r.body.data).toMatchObject({ status: 'PENDING_REVIEW', progress: { done: 3, total: 3 } });
    expect((await api.item(cashier, run.id, i1.id, { is_done: false })).body.code).toBe('RUN_CLOSED');
    expect((await api.review(cashier, run.id, r.body.data.row_version, 'APPROVE')).status).toBe(403);

    // the reviewer (owner) approves → Completed; summary counts it
    r = await api.review(owner, run.id, r.body.data.row_version, 'APPROVE', 'Good');
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ status: 'COMPLETED', review_comment: 'Good' });
    const sum = (await api.summary(cashier, today)).body.data;
    expect(sum).toMatchObject({ completed: 1 });

    // approved → nothing can change any more
    expect((await api.item(cashier, run.id, i1.id, { is_done: false })).body.code).toBe('RUN_CLOSED');
  });

  test('without a reviewer the last tick completes it; the board shows Completed', async () => {
    const c = (await api.create(manager, await checklist())).body.data;
    const today = await localToday();
    const [row] = await mine(cashier, today, c.id);
    const run = (await api.run(cashier, row.id)).body.data;
    for (const it of run.items) await api.item(cashier, run.id, it.id, { is_done: true });
    const [after] = await mine(cashier, today, c.id);
    expect(after).toMatchObject({ status: 'COMPLETED', board_status: 'COMPLETED', progress: { done: 3, total: 3 } });
  });

  test('a colleague who is neither assignee nor creator cannot tick (403); another company gets 404', async () => {
    const c = (await api.create(owner, await checklist())).body.data;
    const [row] = await mine(cashier, await localToday(), c.id);
    const run = (await api.run(cashier, row.id)).body.data;
    expect((await api.item(manager, run.id, run.items[0].id, { is_done: true })).status).toBe(403);
    expect((await api.run(other, run.id)).status).toBe(404);
  });
});

// ── S3 · Edit ────────────────────────────────────────────────────────────────
describe('S3 · the manager edits the checklist', () => {
  test('rename + add a task + add an assignee, applied now: no duplicate runs, started work kept', async () => {
    const c = (await api.create(manager, await checklist())).body.data;
    const today = await localToday();
    const [row] = await mine(cashier, today, c.id);
    await api.item(cashier, row.id, (await api.run(cashier, row.id)).body.data.items[0].id, { is_done: true }); // started

    const body = await checklist({
      name: 'Store Opening v2',
      tasks: [...(await checklist()).tasks, { title: 'Check CCTV' }],
      assignee_employee_ids: [EMP.cashier.employee_id, EMP.manager.employee_id],
    });
    expect((await api.edit(manager, c.id, { ...body, row_version: 1 + 5 })).status).toBe(409);       // stale
    expect((await api.edit(cashier, c.id, { ...body, row_version: 1 })).status).toBe(403);            // no permission
    const r = await api.edit(manager, c.id, { ...body, row_version: 1, apply_from: 'NOW' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ name: 'Store Opening v2', row_version: 2 });
    expect(r.body.data.tasks).toHaveLength(4);

    const tomorrow = (await q1(`SELECT ($1::date + 1)::text d`, [today])).d;
    // today: the cashier's started run is kept as it was (old tasks), and no second copy is made;
    // from tomorrow: ONE run shared by both, with the new tasks
    expect((await runsOf(c.id)).filter((l) => l.startsWith(today))).toEqual([`${today} 23:59 IN_PROGRESS ${EMP.cashier.name}`]);
    expect((await mine(cashier, today, c.id))[0].progress.total).toBe(3);
    expect((await runsOf(c.id)).filter((l) => l.startsWith(tomorrow))).toEqual([`${tomorrow} 23:59 TODO 2 people`]);
    const [shared] = await mine(manager, tomorrow, c.id);
    expect(shared).toMatchObject({ name: 'Store Opening v2', progress: { total: 4 }, assign_all: false });
    expect(shared.pool.map((x) => x.name)).toEqual([EMP.cashier.name, EMP.manager.name].sort());
  });

  test('adding a second person before anyone started: today becomes ONE shared run, not two copies', async () => {
    const c = (await api.create(manager, await checklist())).body.data;
    const today = await localToday();
    const r = await api.edit(manager, c.id, {
      ...(await checklist({ assignee_employee_ids: [EMP.cashier.employee_id, EMP.manager.employee_id] })), row_version: 1, apply_from: 'NOW',
    });
    expect(r.status).toBe(200);
    expect((await runsOf(c.id)).filter((l) => l.startsWith(today))).toEqual([`${today} 23:59 TODO 2 people`]);
    const [a] = await mine(cashier, today, c.id);
    const [b] = await mine(manager, today, c.id);
    expect(a.id).toBe(b.id);

    // back to one person: their own run again
    await api.edit(manager, c.id, { ...(await checklist()), row_version: 2, apply_from: 'NOW' });
    expect((await runsOf(c.id)).filter((l) => l.startsWith(today))).toEqual([`${today} 23:59 TODO ${EMP.cashier.name}`]);
  });

  test('switching All employees ↔ specific people, applied now, never leaves two runs for one slot', async () => {
    const today = await localToday();
    const c = (await api.create(manager, await checklist({ assign_mode: 'ALL', assignee_employee_ids: [] }))).body.data;
    expect((await runsOf(c.id)).filter((l) => l.startsWith(today))).toEqual([`${today} 23:59 TODO All employees`]);

    let r = await api.edit(manager, c.id, { ...(await checklist()), row_version: 1, apply_from: 'NOW' });
    expect(r.status).toBe(200);
    expect((await runsOf(c.id)).filter((l) => l.startsWith(today))).toEqual([`${today} 23:59 TODO ${EMP.cashier.name}`]);

    r = await api.edit(manager, c.id, { ...(await checklist({ assign_mode: 'ALL', assignee_employee_ids: [] })), row_version: 2, apply_from: 'NOW' });
    expect((await runsOf(c.id)).filter((l) => l.startsWith(today))).toEqual([`${today} 23:59 TODO All employees`]);
  });

  test('changing the schedule daily → one-time next week drops today\'s untouched runs', async () => {
    const today = await localToday();
    const c = (await api.create(manager, await checklist())).body.data;
    const next = (await q1(`SELECT ($1::date + 7)::text d`, [today])).d;
    const r = await api.edit(manager, c.id, {
      ...(await checklist({ schedule: { task_type: 'ONCE', trigger_time: '10:00', start_date: next } })), row_version: 1, apply_from: 'NOW',
    });
    expect(r.status).toBe(200);
    expect((await runsOf(c.id)).filter((l) => !l.includes('CANCELLED'))).toEqual([]);  // next week is outside the generation horizon
    expect(r.body.data.next_occurrences[0]).toEqual({ date: next, times: ['10:00'] });
  });

  test('recurring → one-time today, applied now, replaces today\'s untouched run even when its time has passed', async () => {
    const today = await localToday();
    // 00:01 is already past (unless the suite runs in the first minute of the day).
    const c = (await api.create(manager, await checklist({ schedule: { task_type: 'RECURRING', frequency: 'DAILY', every_n: 1, trigger_time: '00:01', start_date: today, ends: 'NEVER' } }))).body.data;
    expect((await runsOf(c.id)).filter((l) => l.startsWith(today))).toEqual([`${today} 00:01 TODO ${EMP.cashier.name}`]);

    const r = await api.edit(manager, c.id, {
      ...(await checklist({ schedule: { task_type: 'ONCE', trigger_time: '23:59', start_date: today } })), row_version: 1, apply_from: 'NOW',
    });
    expect(r.status).toBe(200);
    expect(await runsOf(c.id)).toEqual([`${today} 23:59 TODO ${EMP.cashier.name}`]);  // one checklist, not two
  });
});

// ── S4 · Delete ──────────────────────────────────────────────────────────────
describe('S4 · deleting a checklist', () => {
  test('manager 403; owner 204; open runs leave the boards, completed history stays; then 404 everywhere', async () => {
    const c = (await api.create(owner, await checklist({ assignee_employee_ids: [EMP.cashier.employee_id, EMP.manager.employee_id] }))).body.data;
    const today = await localToday();
    const tomorrow = (await q1(`SELECT ($1::date + 1)::text d`, [today])).d;
    const [cashierRow] = await mine(cashier, today, c.id);
    const done = (await api.run(cashier, cashierRow.id)).body.data;
    await api.completeAll(cashier, done.id, done.row_version);                     // today's shared run finished
    expect(await mine(manager, tomorrow, c.id)).toHaveLength(1);                    // tomorrow's still open

    expect((await api.remove(manager, c.id)).status).toBe(403);
    expect((await api.remove(owner, c.id)).status).toBe(204);
    expect((await api.get(owner, c.id)).status).toBe(404);
    expect((await api.edit(owner, c.id, { ...(await checklist()), row_version: 1 })).status).toBe(404);
    expect((await api.remove(owner, c.id)).status).toBe(404);

    expect(await mine(manager, tomorrow, c.id)).toEqual([]);                        // open one gone
    for (const who of [cashier, manager]) {                                         // completed one kept, for both
      expect((await mine(who, today, c.id)).map((r) => r.status)).toEqual(['COMPLETED']);
    }
    const list = (await request(app).get('/api/checklists').set(owner)).body.data;
    expect(list.find((x) => x.id === c.id)).toBeUndefined();
  });
});

// ── S5 · Recurrence ──────────────────────────────────────────────────────────
describe('S5 · recurring schedules land on the right dates', () => {
  const dates = (res) => res.body.data.map((o) => o.date);
  const s = (patch) => ({ task_type: 'RECURRING', trigger_time: '10:00', start_date: '2026-12-01', ends: 'NEVER', ...patch });

  test.each([
    ['daily', { frequency: 'DAILY' }, '2026-12-01', ['2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05']],
    ['every 2 days', { frequency: 'DAILY', every_n: 2 }, '2026-12-01', ['2026-12-01', '2026-12-03', '2026-12-05', '2026-12-07', '2026-12-09']],
    ['weekdays only (Fri → Mon)', { frequency: 'DAILY', weekdays_only: true, start_date: '2026-12-04' }, '2026-12-04', ['2026-12-04', '2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10']],
    ['weekly Mon + Wed', { frequency: 'WEEKLY', weekdays: [1, 3] }, '2026-12-01', ['2026-12-02', '2026-12-07', '2026-12-09', '2026-12-14', '2026-12-16']],
    ['every 2 weeks on Monday', { frequency: 'WEEKLY', every_n: 2, weekdays: [1], start_date: '2026-12-07' }, '2026-12-07', ['2026-12-07', '2026-12-21', '2027-01-04', '2027-01-18', '2027-02-01']],
    ['monthly on the 15th', { frequency: 'MONTHLY', monthly_by: 'DAY', month_day: 15 }, '2026-12-01', ['2026-12-15', '2027-01-15', '2027-02-15', '2027-03-15', '2027-04-15']],
    ['monthly on the last Friday', { frequency: 'MONTHLY', monthly_by: 'WEEKDAY', nth: -1, nth_weekday: 5 }, '2026-12-01', ['2026-12-25', '2027-01-29', '2027-02-26', '2027-03-26', '2027-04-30']],
    ['monthly on the 2nd Tuesday', { frequency: 'MONTHLY', monthly_by: 'WEEKDAY', nth: 2, nth_weekday: 2 }, '2026-12-01', ['2026-12-08', '2027-01-12', '2027-02-09', '2027-03-09', '2027-04-13']],
    ['ends after 3', { frequency: 'DAILY', ends: 'AFTER', max_occurrences: 3 }, '2026-12-01', ['2026-12-01', '2026-12-02', '2026-12-03']],
    ['ends on a date', { frequency: 'DAILY', ends: 'ON_DATE', end_date: '2026-12-02' }, '2026-12-01', ['2026-12-01', '2026-12-02']],
  ])('%s', async (_n, patch, from, expected) => {
    const res = await api.preview(manager, s(patch), from);
    expect(res.status).toBe(200);
    expect(dates(res)).toEqual(expected);
  });

  test('monthly on the 31st: what happens in 30-day months and February', async () => {
    const res = await api.preview(manager, s({ frequency: 'MONTHLY', monthly_by: 'DAY', month_day: 31 }), '2026-12-01', 4);
    // Either rule is defensible; this records which one the app uses.
    expect([
      ['2026-12-31', '2027-01-31', '2027-03-31', '2027-05-31'],          // skip short months
      ['2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31'],          // last day of short months
    ]).toContainEqual(dates(res));
  });

  test('hourly 09:00–12:00 every hour → slot times', async () => {
    const res = await api.preview(manager, { task_type: 'RECURRING', frequency: 'HOURLY', every_n: 1, window_start: '09:00', window_end: '12:00', start_date: '2026-12-01' }, '2026-12-01', 1);
    expect(res.body.data[0].times).toEqual(['09:00', '10:00', '11:00', '12:00']);
  });

  test('generation: a daily checklist has runs for today and tomorrow only; one-time has exactly one; pause / resume', async () => {
    const today = await localToday();
    const tomorrow = (await q1(`SELECT ($1::date + 1)::text d`, [today])).d;
    const daily = (await api.create(manager, await checklist())).body.data;
    expect((await runsOf(daily.id)).map((l) => l.slice(0, 10))).toEqual([today, tomorrow]);

    const once = (await api.create(manager, await checklist({ schedule: { task_type: 'ONCE', trigger_time: '23:59', start_date: today } }))).body.data;
    await pool.query("SELECT ckl.fn_generate_for_schedule($1, now() + interval '30 days')", [once.id]);
    expect(await runsOf(once.id)).toHaveLength(1);

    expect((await api.status(manager, daily.id, 'PAUSED')).status).toBe(200);
    expect((await runsOf(daily.id)).filter((l) => /TODO/.test(l))).toEqual([]);
    expect((await mine(cashier, today, daily.id))).toEqual([]);
    expect((await api.status(manager, daily.id, 'ACTIVE')).status).toBe(200);
    expect((await mine(cashier, today, daily.id))).toHaveLength(1);
  });

  test('ends after 2 occurrences: generation stops at 2 even over a month', async () => {
    const c = (await api.create(manager, await checklist({ schedule: {
      task_type: 'RECURRING', frequency: 'DAILY', trigger_time: '23:59', start_date: await localToday(), ends: 'AFTER', max_occurrences: 2,
    } }))).body.data;
    await pool.query("SELECT ckl.fn_generate_for_schedule($1, now() + interval '30 days')", [c.id]);
    expect(await runsOf(c.id)).toHaveLength(2);
  });
});

// ── S6 · Shared "All employees" run ──────────────────────────────────────────
describe('S6 · assigned to all employees', () => {
  test('one shared run on everyone\'s board; whoever finishes it is recorded; it disappears as done for all', async () => {
    const c = (await api.create(manager, await checklist({ assign_mode: 'ALL', assignee_employee_ids: [] }))).body.data;
    const today = await localToday();
    const [a] = await mine(cashier, today, c.id);
    const [b] = await mine(manager, today, c.id);
    expect(a.id).toBe(b.id);
    expect(a).toMatchObject({ assign_all: true, assignee: { name: 'All employees' } });
    const run = (await api.run(cashier, a.id)).body.data;
    const r = await api.completeAll(cashier, run.id, run.row_version);
    expect(r.body.data).toMatchObject({ status: 'COMPLETED', submitted_by: { name: EMP.cashier.name } });
    expect((await mine(manager, today, c.id))[0].status).toBe('COMPLETED');
  });
});

// ── S7 · Security ────────────────────────────────────────────────────────────
describe('S7 · tenant isolation', () => {
  test('another company sees nothing and changes nothing', async () => {
    const c = (await api.create(owner, await checklist())).body.data;
    const today = await localToday();
    expect((await api.get(other, c.id)).status).toBe(404);
    expect((await api.edit(other, c.id, { ...(await checklist()), row_version: 1 })).status).toBe(404);
    expect((await api.remove(other, c.id)).status).toBe(404);
    expect((await api.status(other, c.id, 'PAUSED')).status).toBe(404);
    expect((await api.board(other, today, 'team')).body.data.filter((r) => r.checklist_id === c.id)).toEqual([]);
    expect((await request(app).get('/api/checklists').set(other)).body.data).toEqual([]);
  });
});

// ── S8 · One checklist, several people: ONE shared run ───────────────────────
describe('S8 · given to several people', () => {
  test('one shared run; any of them ticks or completes it, once; outsiders can\'t', async () => {
    // owner creates it for the cashier and the no-login employee; the manager is outside it
    const c = (await api.create(owner, await checklist({ assignee_employee_ids: [EMP.cashier.employee_id, EMP.nologin.employee_id] }))).body.data;
    const today = await localToday();

    const team = (await api.board(owner, today, 'team')).body.data.filter((r) => r.checklist_id === c.id);
    expect(team).toHaveLength(1);
    expect(team[0]).toMatchObject({ assign_all: false, assignee: { employee_id: null, name: '2 people' }, progress: { done: 0, total: 3 } });
    expect(team[0].pool.map((p) => p.name)).toEqual([EMP.cashier.name, EMP.nologin.name].sort());

    // in the pool: on my board; outside: not on my board, can't tick
    expect(await mine(cashier, today, c.id)).toHaveLength(1);
    expect(await mine(manager, today, c.id)).toEqual([]);
    const run = (await api.run(cashier, team[0].id)).body.data;
    expect((await api.item(manager, run.id, run.items[0].id, { is_done: true })).status).toBe(403);

    // ticks are shared: done once
    let r = await api.item(cashier, run.id, run.items[0].id, { is_done: true });
    expect(r.body.data.progress).toMatchObject({ done: 1, total: 3 });
    r = await api.completeAll(cashier, run.id, r.body.data.row_version);
    expect(r.body.data).toMatchObject({ status: 'COMPLETED', submitted_by: { name: EMP.cashier.name } });
    expect((await api.board(owner, today, 'team')).body.data.filter((x) => x.checklist_id === c.id).map((x) => x.status)).toEqual(['COMPLETED']);

    // dashboards count it for the people it's shared with
    const dash = (await request(app).get('/api/dashboard/my').set(cashier)).body.data;
    expect(dash.completed).toBeGreaterThanOrEqual(1);
  });
});
