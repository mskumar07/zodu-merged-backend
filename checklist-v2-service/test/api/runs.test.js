// /api/runs, /api/notifications, /api/dashboard and the SSE stream.
const request = require('supertest');
const { bearer, USERS } = require('@zodu/security/testing');
const { pool, q1, reset, seedDirectory, createChecklist, localToday, EMP } = require('../helpers/db');
const { createApiApp } = require('../../src/api-app');
const listener = require('../../src/database/listener');

const app = createApiApp();
afterAll(async () => {
  await listener.stop();
  await pool.end();
});
beforeEach(async () => {
  await reset();
  await seedDirectory();
});

const owner = bearer(USERS.owner);
const manager = bearer(USERS.manager);
const cashier = bearer(USERS.cashier);

const generate = (id) => q1("SELECT ckl.fn_generate_for_schedule($1, now() + interval '36 hours') AS n", [id]);

// One checklist for the cashier, reviewed by the manager, with today's run.
async function setup({ reviewer = EMP.manager.employee_id, rules = [{ rule_type: 'NOTIFY_REVIEWER_ON_SUBMIT', target: 'REVIEWER' }], ...opts } = {}) {
  const id = await createChecklist({ reviewer, rules, schedule: { trigger_time: '23:59' }, ...opts });
  await generate(id);
  const today = await localToday();
  const run = await q1('SELECT * FROM ckl.runs WHERE checklist_id = $1 AND run_date = $2 ORDER BY assignee_name LIMIT 1', [id, today]);
  return { id, run, today };
}

const detail = (runId, h = cashier) => request(app).get(`/api/runs/${runId}`).set(h);

describe('board', () => {
  test('my board shows only my runs; team view needs checklist:read', async () => {
    const { today } = await setup({ assignees: [EMP.cashier.employee_id, EMP.nologin.employee_id] });
    const mine = await request(app).get(`/api/runs?date=${today}`).set(cashier);
    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0]).toMatchObject({
      code: 'CL-0001', name: 'Opening checks', status: 'TODO', board_status: 'TODO', due_time: '23:59',
      assignee: { employee_id: EMP.cashier.employee_id, name: EMP.cashier.name },
      reviewer: { employee_id: EMP.manager.employee_id, name: EMP.manager.name },
      progress: { done: 0, total: 3 }, requires_review: true,
    });
    // the cashier asking for the team view still gets only their own
    expect((await request(app).get(`/api/runs?date=${today}&view=team`).set(cashier)).body.data).toHaveLength(1);
    expect((await request(app).get(`/api/runs?date=${today}&view=team`).set(manager)).body.data).toHaveLength(2);
    const summary = await request(app).get(`/api/runs/summary?date=${today}&view=team`).set(manager);
    expect(summary.body.data).toMatchObject({ total: 2, todo: 2, overdue: 0, completed: 0, completion_rate: 0 });
  });

  test('filters: board status OVERDUE is derived, never stored', async () => {
    const { run, today } = await setup();
    await pool.query("UPDATE ckl.runs SET due_at = now() - interval '42 minutes' WHERE id = $1", [run.id]);
    const res = await request(app).get(`/api/runs?date=${today}&status=OVERDUE`).set(cashier);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ status: 'TODO', board_status: 'OVERDUE' });
    expect(res.body.data[0].overdue_minutes).toBeGreaterThanOrEqual(41);
    expect((await request(app).get(`/api/runs?date=${today}&status=TODO`).set(cashier)).body.data).toHaveLength(0);
  });

  test('400 without a date; 400 for a range over 31 days', async () => {
    expect((await request(app).get('/api/runs').set(cashier)).status).toBe(400);
    expect((await request(app).get('/api/runs?from=2026-01-01&to=2026-03-01').set(cashier)).status).toBe(400);
  });
});

describe('run actions', () => {
  test('tick → in progress; all done → pending review; manager approves; cashier gets the news', async () => {
    const { run } = await setup();
    const d0 = (await detail(run.id)).body.data;
    expect(d0.items).toHaveLength(3);
    const [i1, i2, i3] = d0.items;

    const t1 = await request(app).put(`/api/runs/${run.id}/items/${i1.id}`).set(cashier).send({ is_done: true, note: 'Alarm off at 9:02' });
    expect(t1.status).toBe(200);
    expect(t1.body.data).toMatchObject({ status: 'IN_PROGRESS', progress: { done: 1, total: 3 } });
    expect(t1.body.data.items[0]).toMatchObject({ is_done: true, note: 'Alarm off at 9:02', done_by_employee_id: EMP.cashier.employee_id });
    // idempotent desired state
    const again = await request(app).put(`/api/runs/${run.id}/items/${i1.id}`).set(cashier).send({ is_done: true });
    expect(again.body.data.row_version).toBe(t1.body.data.row_version);

    await request(app).put(`/api/runs/${run.id}/items/${i2.id}`).set(cashier).send({ is_done: true });
    const last = await request(app).put(`/api/runs/${run.id}/items/${i3.id}`).set(cashier).send({ is_done: true });
    expect(last.body.data.status).toBe('PENDING_REVIEW');
    expect(last.body.data.board_status).toBe('IN_PROGRESS');
    // waiting for review: items are frozen
    expect((await request(app).put(`/api/runs/${run.id}/items/${i3.id}`).set(cashier).send({ is_done: false })).body.code).toBe('RUN_CLOSED');

    const queue = await request(app).get('/api/runs/review-queue').set(manager);
    expect(queue.body.data.map((r) => r.id)).toEqual([run.id]);
    expect((await request(app).get('/api/notifications').set(manager)).body.data[0]).toMatchObject({ type: 'RUN_SUBMITTED' });

    // the cashier can neither review nor approve their own
    expect((await request(app).post(`/api/runs/${run.id}/review`).set(cashier).send({ decision: 'APPROVE', row_version: last.body.data.row_version })).status).toBe(403);
    const stale = await request(app).post(`/api/runs/${run.id}/review`).set(manager).send({ decision: 'APPROVE', row_version: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('RUN_VERSION_CONFLICT');
    const approved = await request(app).post(`/api/runs/${run.id}/review`).set(manager).send({ decision: 'APPROVE', row_version: last.body.data.row_version });
    expect(approved.status).toBe(200);
    expect(approved.body.data).toMatchObject({ status: 'COMPLETED', board_status: 'COMPLETED' });
    expect(approved.body.data.events.map((e) => e.event_type)).toEqual(expect.arrayContaining(['ITEM_DONE', 'NOTE', 'STATUS_CHANGED']));
    // approved runs are closed for good
    expect((await request(app).put(`/api/runs/${run.id}/items/${i1.id}`).set(cashier).send({ is_done: false })).status).toBe(409);

    const inbox = await request(app).get('/api/notifications').set(cashier);
    expect(inbox.body.data.map((n) => n.type)).toEqual(['RUN_APPROVED']);
    expect((await request(app).get('/api/notifications/unread-count').set(cashier)).body.data.count).toBe(1);
    expect((await request(app).post(`/api/notifications/${inbox.body.data[0].id}/read`).set(cashier)).status).toBe(204);
    expect((await request(app).get('/api/notifications/unread-count').set(cashier)).body.data.count).toBe(0);
  });

  test('reject needs a comment and sends the run back', async () => {
    const { run } = await setup();
    const all = await request(app).post(`/api/runs/${run.id}/complete-all`).set(cashier).send({ row_version: run.row_version });
    expect(all.body.data.status).toBe('PENDING_REVIEW');
    const v = all.body.data.row_version;
    expect((await request(app).post(`/api/runs/${run.id}/review`).set(manager).send({ decision: 'REJECT', row_version: v })).status).toBe(400);
    const back = await request(app).post(`/api/runs/${run.id}/review`).set(manager).send({ decision: 'REJECT', comment: 'Floor still wet', row_version: v });
    expect(back.body.data).toMatchObject({ status: 'IN_PROGRESS', review_comment: 'Floor still wet', rejected_count: 1 });
    const resubmit = await request(app).post(`/api/runs/${run.id}/submit`).set(cashier).send({ row_version: back.body.data.row_version });
    expect(resubmit.body.data.status).toBe('PENDING_REVIEW');
  });

  test('photo-required item: tick and complete-all → 422 PHOTO_REQUIRED', async () => {
    const { run } = await setup({ requirePhoto: true });
    const { items } = (await detail(run.id)).body.data;
    const res = await request(app).put(`/api/runs/${run.id}/items/${items[0].id}`).set(cashier).send({ is_done: true });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PHOTO_REQUIRED');
    const all = await request(app).post(`/api/runs/${run.id}/complete-all`).set(cashier).send({ row_version: run.row_version });
    expect(all.body).toMatchObject({ code: 'PHOTO_REQUIRED', details: { item_ids: [items[0].id] } });
  });

  // The company's task statuses: one closes a task, one is only a label.
  async function statuses() {
    const add = async (body) => (await request(app).post('/api/task-statuses').set(owner).send(body)).body.data;
    return { na: await add({ name: 'Not applicable', color: '#64748B', closes_task: true }), hold: await add({ name: 'On hold', color: '#D97706' }) };
  }

  test('only completes when every task is closed: done, or a status that closes it (no partial submit)', async () => {
    const { run } = await setup({ reviewer: null, rules: [] });
    const { na, hold } = await statuses();
    const { items } = (await detail(run.id)).body.data;
    expect((await request(app).post(`/api/runs/${run.id}/submit`).set(cashier).send({ row_version: run.row_version })).body.code).toBe('ITEMS_OPEN');
    const t = await request(app).put(`/api/runs/${run.id}/items/${items[1].id}`).set(cashier).send({ is_done: true });
    expect(t.body.data).toMatchObject({ status: 'IN_PROGRESS', progress: { done: 1, total: 3, skipped: 0 } });

    // a label-only status keeps the task open
    const h = await request(app).put(`/api/runs/${run.id}/items/${items[0].id}`).set(cashier).send({ sub_status_id: hold.id });
    expect(h.body.data).toMatchObject({ progress: { done: 1, total: 3, skipped: 0 } });
    expect(h.body.data.items[0]).toMatchObject({ is_done: false, is_skipped: false, sub_status: { id: hold.id, name: 'On hold', color: '#D97706', closes_task: false } });

    // a closing status closes it
    const c = await request(app).put(`/api/runs/${run.id}/items/${items[0].id}`).set(cashier).send({ sub_status_id: na.id });
    expect(c.body.data).toMatchObject({ status: 'IN_PROGRESS', progress: { done: 2, total: 3, skipped: 1 } });
    expect(c.body.data.items[0]).toMatchObject({ is_done: false, is_skipped: true, sub_status: { name: 'Not applicable', closes_task: true, set_by_employee_id: EMP.cashier.employee_id } });
    // same status again changes nothing
    const again = await request(app).put(`/api/runs/${run.id}/items/${items[0].id}`).set(cashier).send({ sub_status_id: na.id });
    expect(again.body.data.row_version).toBe(c.body.data.row_version);

    // the last task closed → completed (no reviewer)
    const last = await request(app).put(`/api/runs/${run.id}/items/${items[2].id}`).set(cashier).send({ is_done: true });
    expect(last.body.data).toMatchObject({ status: 'COMPLETED', progress: { done: 3, total: 3, skipped: 1 } });
    expect(last.body.data.events.map((e) => e.event_type)).toEqual(expect.arrayContaining(['ITEM_SUB_STATUS', 'ITEM_DONE']));
  });

  test('task status: clear with null, tick clears it, both at once refused, unknown 422, closing ones off when the checklist forbids it', async () => {
    const { run } = await setup({ reviewer: null, rules: [] });
    const { na, hold } = await statuses();
    const { items } = (await detail(run.id)).body.data;
    const url = `/api/runs/${run.id}/items/${items[0].id}`;
    expect((await request(app).put(url).set(cashier).send({ is_done: true, sub_status_id: na.id })).status).toBe(400);
    expect((await request(app).put(url).set(cashier).send({ sub_status_id: '00000000-0000-4000-8000-000000000000' })).body.code).toBe('SUB_STATUS_NOT_FOUND');

    await request(app).put(url).set(cashier).send({ sub_status_id: na.id });
    const cleared = await request(app).put(url).set(cashier).send({ sub_status_id: null });
    expect(cleared.body.data).toMatchObject({ status: 'TODO', progress: { done: 0, total: 3, skipped: 0 } });
    expect(cleared.body.data.items[0]).toMatchObject({ is_skipped: false, sub_status: null });

    await request(app).put(url).set(cashier).send({ sub_status_id: na.id });
    const ticked = await request(app).put(url).set(cashier).send({ is_done: true });
    expect(ticked.body.data.items[0]).toMatchObject({ is_done: true, is_skipped: false, sub_status: null });
    expect(ticked.body.data.progress).toMatchObject({ done: 1, skipped: 0 });

    // a renamed status shows its new name on tasks that have it
    await request(app).put(`/api/runs/${run.id}/items/${items[1].id}`).set(cashier).send({ sub_status_id: na.id });
    await request(app).put(`/api/task-statuses/${na.id}`).set(owner).send({ name: 'Not needed today' });
    expect((await detail(run.id)).body.data.items[1].sub_status.name).toBe('Not needed today');

    // complete-all ticks open tasks (a label-only status too) and leaves closed ones
    await request(app).put(`/api/runs/${run.id}/items/${items[2].id}`).set(cashier).send({ sub_status_id: hold.id });
    const v = (await detail(run.id)).body.data.row_version;
    const all = await request(app).post(`/api/runs/${run.id}/complete-all`).set(cashier).send({ row_version: v });
    expect(all.body.data).toMatchObject({ status: 'COMPLETED', progress: { done: 3, total: 3, skipped: 1 } });
    expect(all.body.data.items[1]).toMatchObject({ is_done: false, is_skipped: true });
    expect(all.body.data.items[2]).toMatchObject({ is_done: true, sub_status: null });

    // a checklist that doesn't allow closing tasks without doing them: label-only still works
    const { run: strict } = await setup({ reviewer: null, rules: [], name: 'Closing checks' });
    await pool.query('UPDATE ckl.runs SET allow_partial = false WHERE id = $1', [strict.id]);
    const strictItems = (await detail(strict.id)).body.data.items;
    const refused = await request(app).put(`/api/runs/${strict.id}/items/${strictItems[0].id}`).set(cashier).send({ sub_status_id: na.id });
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('CLOSING_STATUS_NOT_ALLOWED');
    expect((await request(app).put(`/api/runs/${strict.id}/items/${strictItems[0].id}`).set(cashier).send({ sub_status_id: hold.id })).status).toBe(200);
  });

  test('a run for a later day can be completed ahead of time', async () => {
    const { run } = await setup({ reviewer: null, rules: [] });
    await pool.query("UPDATE ckl.runs SET run_date = run_date + 2, available_at = available_at + interval '2 days', due_at = due_at + interval '2 days' WHERE id = $1", [run.id]);
    const { items, row_version } = (await detail(run.id)).body.data;
    expect((await request(app).put(`/api/runs/${run.id}/items/${items[0].id}`).set(cashier).send({ is_done: true })).status).toBe(200);
    const all = await request(app).post(`/api/runs/${run.id}/complete-all`).set(cashier).send({ row_version: row_version + 1 });
    expect(all.body.data).toMatchObject({ status: 'COMPLETED', progress: { done: 3, total: 3 } });
  });

  test('task statuses: anyone reads, managers manage, names unique per company', async () => {
    const { na } = await statuses();
    expect((await request(app).get('/api/task-statuses').set(cashier)).body.data.map((s) => s.name)).toEqual(['Not applicable', 'On hold']);
    expect((await request(app).post('/api/task-statuses').set(cashier).send({ name: 'Mine' })).status).toBe(403);
    expect((await request(app).post('/api/task-statuses').set(owner).send({ name: 'on HOLD' })).body.code).toBe('TASK_STATUS_EXISTS');
    expect((await request(app).get('/api/task-statuses').set(bearer(USERS.other))).body.data).toEqual([]);
    expect((await request(app).delete(`/api/task-statuses/${na.id}`).set(owner)).status).toBe(204);
    expect((await request(app).delete(`/api/task-statuses/${na.id}`).set(owner)).status).toBe(404);
  });

  test('someone else\'s run: 403 for colleagues, 404 for another company', async () => {
    const { run } = await setup({ assignees: [EMP.nologin.employee_id], reviewer: null });
    expect((await detail(run.id, cashier)).status).toBe(403);
    expect((await detail(run.id, manager)).status).toBe(200);
    expect((await detail(run.id, bearer(USERS.other))).status).toBe(404);
    const { items } = (await detail(run.id, manager)).body.data;
    expect((await request(app).put(`/api/runs/${run.id}/items/${items[0].id}`).set(cashier).send({ is_done: true })).status).toBe(403);
  });

  test('only the assignee or the creator completes a run: another manager (checklist:edit) gets 403 NOT_ASSIGNEE', async () => {
    const { run } = await setup({ reviewer: null, rules: [], createdBy: USERS.owner.userId });
    const { items } = (await detail(run.id)).body.data;
    expect((await detail(run.id, owner)).body.data.created_by_user_id).toBe(USERS.owner.userId);
    for (const who of [manager]) {
      const tick = await request(app).put(`/api/runs/${run.id}/items/${items[0].id}`).set(who).send({ is_done: true });
      expect(tick.status).toBe(403);
      expect(tick.body.code).toBe('NOT_ASSIGNEE');
      expect((await request(app).put(`/api/runs/${run.id}/items/${items[0].id}`).set(who).send({ note: 'x' })).status).toBe(403);
      expect((await request(app).post(`/api/runs/${run.id}/complete-all`).set(who).send({ row_version: run.row_version })).status).toBe(403);
      expect((await request(app).post(`/api/runs/${run.id}/submit`).set(who).send({ row_version: run.row_version })).status).toBe(403);
    }
    // the assignee still can, and the manager can still read it
    expect((await request(app).put(`/api/runs/${run.id}/items/${items[0].id}`).set(cashier).send({ is_done: true })).status).toBe(200);
    expect((await detail(run.id, manager)).status).toBe(200);
    // the creator (the owner here) can too
    expect((await request(app).put(`/api/runs/${run.id}/items/${items[1].id}`).set(owner).send({ is_done: true })).status).toBe(200);
  });

  test('reassign: 409 ALREADY_HAS_RUN; 422 for an inactive employee; ok otherwise', async () => {
    const { run } = await setup({ assignees: [EMP.cashier.employee_id, EMP.nologin.employee_id], reviewer: null });
    const other = run.assignee_employee_id === EMP.cashier.employee_id ? EMP.nologin : EMP.cashier;
    const res = await request(app).post(`/api/runs/${run.id}/reassign`).set(manager)
      .send({ employee_id: other.employee_id, row_version: run.row_version });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_HAS_RUN');
    expect((await request(app).post(`/api/runs/${run.id}/reassign`).set(manager).send({ employee_id: EMP.gone.employee_id, row_version: run.row_version })).body.code).toBe('EMPLOYEE_NOT_FOUND');
    expect((await request(app).post(`/api/runs/${run.id}/reassign`).set(cashier).send({ employee_id: EMP.gone.employee_id, row_version: run.row_version })).status).toBe(403);

    const solo = await createChecklist({ assignees: [EMP.nologin.employee_id], schedule: { trigger_time: '23:58' } });
    await generate(solo);
    const r2 = await q1('SELECT * FROM ckl.runs WHERE checklist_id = $1 ORDER BY slot_at LIMIT 1', [solo]);
    const moved = await request(app).post(`/api/runs/${r2.id}/reassign`).set(manager).send({ employee_id: EMP.cashier.employee_id, row_version: r2.row_version });
    expect(moved.body.data.assignee).toEqual({ employee_id: EMP.cashier.employee_id, name: EMP.cashier.name });
  });

  test('ALL mode: one shared run on every board; anyone ticks it; the submitter is recorded', async () => {
    const { run, today } = await setup({ assignMode: 'ALL', assignees: [], reviewer: null, rules: [] });
    expect(await q1('SELECT count(*)::int AS n FROM ckl.runs WHERE checklist_id = $1 AND run_date = $2', [run.checklist_id, today]))
      .toEqual({ n: 1 });
    for (const who of [cashier, manager]) {
      const board = await request(app).get(`/api/runs?date=${today}`).set(who);
      expect(board.body.data).toHaveLength(1);
      expect(board.body.data[0]).toMatchObject({ assign_all: true, assignee: { employee_id: null, name: 'All employees' }, submitted_by: null });
    }
    // the cashier has no checklist:edit, yet may work on the shared run
    const { items } = (await detail(run.id)).body.data;
    expect((await request(app).put(`/api/runs/${run.id}/items/${items[0].id}`).set(cashier).send({ is_done: true })).status).toBe(200);
    const done = await request(app).post(`/api/runs/${run.id}/complete-all`).set(cashier).send({ row_version: run.row_version + 1 });
    expect(done.body.data).toMatchObject({
      status: 'COMPLETED', progress: { done: 3, total: 3 },
      submitted_by: { employee_id: EMP.cashier.employee_id, name: EMP.cashier.name },
    });
    // the same run, completed, on the manager's board too
    expect((await request(app).get(`/api/runs?date=${today}`).set(manager)).body.data[0]).toMatchObject({ id: run.id, status: 'COMPLETED' });
  });
});

describe('notifications & dashboard', () => {
  test('inbox pages with a cursor; read-all; preferences with defaults', async () => {
    for (let i = 0; i < 5; i++) {
      await q1(`SELECT ckl.fn_notify('Z001','B1', ARRAY[$1]::uuid[], 'RUN_REMINDER','INFO','t${i}','b',NULL,NULL,NULL,'{}','k${i}')`, [USERS.cashier.userId]);
    }
    const p1 = await request(app).get('/api/notifications?limit=3').set(cashier);
    const p2 = await request(app).get(`/api/notifications?limit=3&cursor=${p1.body.pagination.next_cursor}`).set(cashier);
    expect([...p1.body.data, ...p2.body.data].map((n) => n.title)).toEqual(['t4', 't3', 't2', 't1', 't0']);
    expect(p2.body.pagination.next_cursor).toBeNull();
    expect((await request(app).post('/api/notifications/read-all').set(cashier).send({})).status).toBe(204);
    expect((await request(app).get('/api/notifications/unread-count').set(cashier)).body.data.count).toBe(0);
    // another user sees none of it
    expect((await request(app).get('/api/notifications').set(manager)).body.data).toHaveLength(0);

    const prefs = await request(app).get('/api/notification-preferences').set(cashier);
    expect(prefs.body.data.preferences).toContainEqual({ type: 'RUN_OVERDUE', channel: 'IN_APP', enabled: true });
    expect(prefs.body.data.preferences).toContainEqual({ type: 'RUN_OVERDUE', channel: 'WEB_PUSH', enabled: false });
    const put = await request(app).put('/api/notification-preferences').set(cashier).send({
      settings: { quiet_start: '22:00', quiet_end: '07:00' },
      preferences: [{ type: 'RUN_REMINDER', channel: 'IN_APP', enabled: false }],
    });
    expect(put.status).toBe(200);
    expect(put.body.data.settings).toMatchObject({ quiet_start: '22:00', quiet_end: '07:00' });
    expect(put.body.data.preferences).toContainEqual({ type: 'RUN_REMINDER', channel: 'IN_APP', enabled: false });
    const push = await request(app).put('/api/notification-preferences').set(cashier).send({
      preferences: [{ type: 'RUN_REMINDER', channel: 'WEB_PUSH', enabled: true }],
    });
    expect(push.body.code).toBe('CHANNEL_NOT_AVAILABLE');
  });

  test('dashboards', async () => {
    const { run } = await setup({ reviewer: null, rules: [] });
    await request(app).post(`/api/runs/${run.id}/complete-all`).set(cashier).send({ row_version: run.row_version });
    const my = await request(app).get('/api/dashboard/my').set(cashier);
    expect(my.status).toBe(200);
    expect(my.body.data).toMatchObject({ completed: 1, on_time: 1, completion_pct: 100, current_streak: 1 });
    const team = await request(app).get('/api/dashboard/team').set(manager);
    expect(team.body.data.employees).toEqual(expect.arrayContaining([expect.objectContaining({ employee_id: EMP.cashier.employee_id, completed: 1 })]));
    expect((await request(app).get('/api/dashboard/team').set(cashier)).status).toBe(403);
  });
});

describe('SSE stream', () => {
  // Reads `event:` blocks from a fetch() body until `want` of them arrived.
  async function readEvents(res, want, timeoutMs = 4000) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const events = [];
    const deadline = Date.now() + timeoutMs;
    while (events.length < want && Date.now() < deadline) {
      const chunk = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r({ timeout: true }), deadline - Date.now()))]);
      if (chunk.timeout || chunk.done) break;
      buf += dec.decode(chunk.value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = Object.fromEntries(block.split('\n').filter((l) => l && !l.startsWith(':')).map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));
        if (ev.event) events.push(ev);
      }
    }
    reader.cancel().catch(() => {});
    return events;
  }

  test('a token at or near exp gets 401, not a stream that ends at once (no reconnect loop)', async () => {
    const now = Math.floor(Date.now() / 1000);
    for (const exp of [now - 10, now + 5]) {   // inside the clock tolerance / about to expire
      const res = await request(app).get('/api/notifications/stream').set(bearer(USERS.cashier, { exp }));
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('TOKEN_EXPIRING');
    }
    expect(app.locals.hub.size).toBe(0);
  });

  test('live notification within 2 s, then Last-Event-ID replay on reconnect', async () => {
    const hub = app.locals.hub;
    listener.removeAllListeners('notification');
    listener.on('notification', (p) => hub.onNotify(p));
    await listener.start();
    const server = app.listen(0);
    const url = `http://127.0.0.1:${server.address().port}/api/notifications/stream`;
    try {
      const ctrl = new AbortController();
      const res = await fetch(url, { headers: cashier, signal: ctrl.signal });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
      const reading = readEvents(res, 2);
      await new Promise((r) => setTimeout(r, 200));
      const started = Date.now();
      await q1("SELECT ckl.fn_notify('Z001','B1', ARRAY[$1]::uuid[], 'RUN_OVERDUE','WARNING','Overdue: X','b',NULL,NULL,NULL,'{}','live1')", [USERS.cashier.userId]);
      const [unread, live] = await reading;
      ctrl.abort();
      expect(unread).toMatchObject({ event: 'unread', data: '{"count":0}' });
      expect(live.event).toBe('notification');
      expect(JSON.parse(live.data)).toMatchObject({ type: 'RUN_OVERDUE', severity: 'WARNING', title: 'Overdue: X', is_read: false });
      expect(Date.now() - started).toBeLessThan(2000);

      // missed while disconnected → replayed first, then the unread count
      await q1("SELECT ckl.fn_notify('Z001','B1', ARRAY[$1]::uuid[], 'RUN_REMINDER','INFO','Missed one','b',NULL,NULL,NULL,'{}','live2')", [USERS.cashier.userId]);
      const ctrl2 = new AbortController();
      const res2 = await fetch(url, { headers: { ...cashier, 'Last-Event-ID': live.id }, signal: ctrl2.signal });
      const [replayed, count] = await readEvents(res2, 2);
      ctrl2.abort();
      expect(JSON.parse(replayed.data).title).toBe('Missed one');
      expect(count).toMatchObject({ event: 'unread', data: '{"count":2}' });
    } finally {
      hub.closeAll();
      server.close();
    }
  });
});
