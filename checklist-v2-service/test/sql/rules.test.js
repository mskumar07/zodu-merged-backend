// Time rules, the run trigger, notifications, the tick and purge (§5.4–§5.6, §13.1).
const { Client } = require('pg');
const { pool, q1, reset, seedDirectory, createChecklist, insertRun, notificationsFor, T1, T2, EMP, OTHER } = require('../helpers/db');
const { connection } = require('../../src/database/pool');

afterAll(() => pool.end());
beforeEach(async () => {
  await reset();
  await seedDirectory();
});

const evaluate = async () => (await q1('SELECT ckl.fn_evaluate_time_rules(2000) AS n')).n;
const run = (id) => q1('SELECT * FROM ckl.runs WHERE id = $1', [id]);
const typesFor = async (userId) => (await notificationsFor(userId)).map((n) => n.type);

// UPDATE as a given user (SET LOCAL ckl.actor_user_id), like the API does.
async function asUser(userId, sql, params) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    if (userId) await c.query("SELECT set_config('ckl.actor_user_id', $1, true)", [userId]);
    await c.query(sql, params);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

describe('time rules', () => {
  test('reminder fires once inside its window', async () => {
    const id = await createChecklist({ rules: [{ rule_type: 'REMIND_BEFORE_DUE', offset_min: 15 }] });
    await insertRun(id, { dueInMin: 10 });
    expect(await evaluate()).toBe(1);
    expect(await evaluate()).toBe(0);
    const [n] = await notificationsFor(EMP.cashier.user_id);
    expect(n).toMatchObject({ type: 'RUN_REMINDER', severity: 'INFO', entity_type: 'RUN', zodu_id: 'Z001', branch_id: 'B1' });
    expect(n.title).toBe('Reminder: Opening checks');
  });

  test('no reminder before the window or after due', async () => {
    const id = await createChecklist({ rules: [{ rule_type: 'REMIND_BEFORE_DUE', offset_min: 15 }] });
    await insertRun(id, { dueInMin: 30 });
    await insertRun(id, { dueInMin: -5, slotOffsetMin: -5, assignee: EMP.nologin });
    expect(await evaluate()).toBe(0);
  });

  test('overdue fires once at due; escalation at due + offset to the reviewer (else the creator)', async () => {
    const id = await createChecklist({
      rules: [{ rule_type: 'NOTIFY_ON_OVERDUE' }, { rule_type: 'ESCALATE_AFTER_OVERDUE', offset_min: 60, target: 'REVIEWER' }],
    });
    await insertRun(id, { dueInMin: -5 });
    expect(await evaluate()).toBe(1);
    expect(await typesFor(EMP.cashier.user_id)).toEqual(['RUN_OVERDUE']);
    expect(await typesFor(EMP.owner.user_id)).toEqual([]);

    await insertRun(id, { dueInMin: -61, createdAgoMin: 200, assignee: EMP.nologin });
    expect(await evaluate()).toBe(2);   // its overdue (nobody to tell: no login) + escalation
    const [esc] = await notificationsFor(EMP.owner.user_id);   // no reviewer → creator
    expect(esc).toMatchObject({ type: 'RUN_ESCALATED', severity: 'CRITICAL' });
    expect(esc.title).toBe('Ravi NoLogin hasn\'t completed Opening checks');
  });

  test('a run created inside its reminder window still gets the reminder, once, before due', async () => {
    const id = await createChecklist({ rules: [{ rule_type: 'REMIND_BEFORE_DUE', offset_min: 15 }] });
    await insertRun(id, { dueInMin: 7, createdAgoMin: 1 });
    expect(await evaluate()).toBe(1);
    expect(await evaluate()).toBe(0);
    expect(await typesFor(EMP.cashier.user_id)).toEqual(['RUN_REMINDER']);
  });

  test('"also remind me": the creator gets the reminder too, but only once when they are also the assignee', async () => {
    const id = await createChecklist({ rules: [
      { rule_type: 'REMIND_BEFORE_DUE', offset_min: 15, target: 'ASSIGNEE' },
      { rule_type: 'REMIND_BEFORE_DUE', offset_min: 15, target: 'CREATOR' },
    ] });
    await insertRun(id, { dueInMin: 10 });
    await insertRun(id, { dueInMin: 12, slotOffsetMin: 12, assignee: EMP.owner });
    await evaluate();
    expect(await typesFor(EMP.cashier.user_id)).toEqual(['RUN_REMINDER']);
    // the owner created the checklist: one reminder for the cashier's run, one (not two) for their own
    expect(await typesFor(EMP.owner.user_id)).toEqual(['RUN_REMINDER', 'RUN_REMINDER']);
  });

  test('a run created after it was due gets no reminder, overdue or escalation', async () => {
    const id = await createChecklist({
      rules: [{ rule_type: 'REMIND_BEFORE_DUE', offset_min: 15 }, { rule_type: 'NOTIFY_ON_OVERDUE' },
        { rule_type: 'ESCALATE_AFTER_OVERDUE', offset_min: 60, target: 'CREATOR' }],
    });
    await insertRun(id, { dueInMin: -90, createdAgoMin: 10 });
    expect(await evaluate()).toBe(0);
  });

  test('ten overdue runs of one checklist → ONE grouped escalation with count 10 and one delivery row', async () => {
    const id = await createChecklist({
      name: 'Washroom log',
      rules: [{ rule_type: 'ESCALATE_AFTER_OVERDUE', offset_min: 30, target: 'CUSTOM', target_employee_ids: [EMP.manager.employee_id], channels: ['IN_APP', 'WEB_PUSH'] }],
    });
    await pool.query(
      `INSERT INTO ckl.notification_preferences (zodu_id, user_id, type, channel, enabled)
       VALUES ('Z001', $1, 'RUN_ESCALATED', 'WEB_PUSH', true)`,
      [EMP.manager.user_id],
    );
    for (let i = 0; i < 10; i++) await insertRun(id, { dueInMin: -45 - i, slotOffsetMin: -45 - i });
    expect(await evaluate()).toBe(10);
    const rows = await notificationsFor(EMP.manager.user_id);
    expect(rows).toHaveLength(1);
    expect(rows[0].data.count).toBe(10);
    expect(rows[0].title).toBe('10 overdue runs on Washroom log');
    expect(rows[0].entity_type).toBe('CHECKLIST');
    const d = await q1('SELECT count(*) AS n FROM ckl.notification_deliveries WHERE notification_id = $1', [rows[0].id]);
    expect(d.n).toBe(1);
  });

  test('auto close → MISSED, then the missed-streak rule at its threshold', async () => {
    const id = await createChecklist({
      rules: [{ rule_type: 'AUTO_CLOSE', offset_min: 0 }, { rule_type: 'MISSED_STREAK', threshold: 2, target: 'CREATOR' }],
    });
    const first = await insertRun(id, { dueInMin: -120, slotOffsetMin: -120 });
    await evaluate();
    expect((await run(first)).status).toBe('MISSED');
    expect(await typesFor(EMP.owner.user_id)).toEqual([]);           // 1 miss < threshold 2
    const second = await insertRun(id, { dueInMin: -10, slotOffsetMin: -10 });
    await evaluate();
    expect((await run(second)).status).toBe('MISSED');
    const [streak] = await notificationsFor(EMP.owner.user_id);
    expect(streak).toMatchObject({ type: 'MISSED_STREAK', severity: 'CRITICAL' });
    const ev = await q1("SELECT * FROM ckl.run_events WHERE run_id = $1 AND event_type = 'STATUS_CHANGED'", [second]);
    expect(ev).toMatchObject({ from_status: 'TODO', to_status: 'MISSED', actor_user_id: null });
  });

  test('two concurrent evaluations fire each (rule, run) exactly once', async () => {
    const id = await createChecklist({ rules: [{ rule_type: 'NOTIFY_ON_OVERDUE' }] });
    for (let i = 0; i < 20; i++) {
      await insertRun(id, { dueInMin: -5 - i, slotOffsetMin: -5 - i, assignee: i % 2 ? EMP.cashier : EMP.manager });
    }
    const [a, b] = await Promise.all([evaluate(), evaluate()]);
    expect(a + b).toBe(20);
    expect((await q1('SELECT count(*) AS n FROM ckl.rule_firings')).n).toBe(20);
    expect((await q1("SELECT count(*) AS n FROM ckl.notifications WHERE type = 'RUN_OVERDUE'")).n).toBe(20);
  });
});

describe('run trigger', () => {
  test('submit → reviewer told; approve → assignee told; the actor is never notified', async () => {
    const id = await createChecklist({
      reviewer: EMP.manager.employee_id,
      rules: [{ rule_type: 'NOTIFY_REVIEWER_ON_SUBMIT', target: 'REVIEWER' }, { rule_type: 'NOTIFY_ON_COMPLETE', target: 'CREATOR' }],
    });
    const r = await insertRun(id, { reviewer: EMP.manager.employee_id });
    await asUser(EMP.cashier.user_id, "UPDATE ckl.runs SET status = 'PENDING_REVIEW', row_version = row_version + 1 WHERE id = $1", [r]);
    expect(await typesFor(EMP.manager.user_id)).toEqual(['RUN_SUBMITTED']);
    expect(await typesFor(EMP.cashier.user_id)).toEqual([]);

    await asUser(EMP.manager.user_id, "UPDATE ckl.runs SET status = 'COMPLETED', reviewed_at = now(), row_version = row_version + 1 WHERE id = $1", [r]);
    expect(await typesFor(EMP.cashier.user_id)).toEqual(['RUN_APPROVED']);
    expect(await typesFor(EMP.owner.user_id)).toEqual(['RUN_COMPLETED']);
    expect(await typesFor(EMP.manager.user_id)).toEqual(['RUN_SUBMITTED']);   // not told about own approval

    const events = (await pool.query('SELECT event_type, from_status, to_status, actor_user_id FROM ckl.run_events WHERE run_id = $1 ORDER BY id', [r])).rows;
    expect(events).toEqual([
      { event_type: 'STATUS_CHANGED', from_status: 'TODO', to_status: 'PENDING_REVIEW', actor_user_id: EMP.cashier.user_id },
      { event_type: 'STATUS_CHANGED', from_status: 'PENDING_REVIEW', to_status: 'COMPLETED', actor_user_id: EMP.manager.user_id },
    ]);
  });

  test('reject → assignee told with the comment; every resubmission notifies again', async () => {
    const id = await createChecklist({ reviewer: EMP.manager.employee_id, rules: [{ rule_type: 'NOTIFY_REVIEWER_ON_SUBMIT', target: 'REVIEWER' }] });
    const r = await insertRun(id, { reviewer: EMP.manager.employee_id });
    const submit = () => asUser(EMP.cashier.user_id, "UPDATE ckl.runs SET status = 'PENDING_REVIEW', row_version = row_version + 1 WHERE id = $1", [r]);
    await submit();
    await asUser(EMP.manager.user_id, "UPDATE ckl.runs SET status = 'IN_PROGRESS', review_comment = 'Floor still wet', row_version = row_version + 1 WHERE id = $1", [r]);
    const [rej] = await notificationsFor(EMP.cashier.user_id);
    expect(rej).toMatchObject({ type: 'RUN_REJECTED', body: 'Reviewer note: Floor still wet' });
    await submit();
    expect(await typesFor(EMP.manager.user_id)).toEqual(['RUN_SUBMITTED', 'RUN_SUBMITTED']);
  });

  test('reassign notifies the new assignee; a slot the employee already has is refused', async () => {
    const id = await createChecklist({ assignees: [EMP.cashier.employee_id, EMP.nologin.employee_id] });
    const r = await insertRun(id, { assignee: EMP.nologin, slotOffsetMin: 300 });
    await asUser(EMP.owner.user_id, 'UPDATE ckl.runs SET assignee_employee_id = $2, assignee_name = $3, row_version = row_version + 1 WHERE id = $1',
      [r, EMP.cashier.employee_id, EMP.cashier.name]);
    expect(await typesFor(EMP.cashier.user_id)).toEqual(['RUN_REASSIGNED']);

    const other = await insertRun(id, { assignee: EMP.nologin, slotOffsetMin: 300 });
    // same slot, copied in SQL (a JS Date would drop the microseconds)
    await pool.query('UPDATE ckl.runs SET slot_at = (SELECT slot_at FROM ckl.runs WHERE id = $2) WHERE id = $1', [other, r]);
    await expect(pool.query('UPDATE ckl.runs SET assignee_employee_id = $2 WHERE id = $1', [other, EMP.cashier.employee_id]))
      .rejects.toMatchObject({ code: '23505', constraint: 'uq_run_slot' });
  });
});

describe('notifications', () => {
  const notify = (userIds, key, { channels = ['IN_APP'], severity = 'INFO' } = {}) => q1(
    `SELECT ckl.fn_notify('Z001', 'B1', $1::uuid[], 'RUN_REMINDER', $3, 't', 'b', NULL, NULL, NULL, '{}', $2, $4::text[]) AS n`,
    [userIds, key, severity, channels],
  );

  test('dedupe per recipient; disabled in-app preference suppresses the inbox row', async () => {
    expect((await notify([EMP.cashier.user_id, EMP.manager.user_id], 'k1')).n).toBe(2);
    expect((await notify([EMP.cashier.user_id], 'k1')).n).toBe(0);
    await pool.query(
      "INSERT INTO ckl.notification_preferences VALUES ('Z001', $1, 'RUN_REMINDER', 'IN_APP', false)",
      [EMP.cashier.user_id],
    );
    expect((await notify([EMP.cashier.user_id], 'k2')).n).toBe(0);
  });

  test('quiet hours defer push but not the inbox; CRITICAL ignores quiet hours', async () => {
    // quiet the whole day except one minute, whatever time the test runs
    const now = await q1("SELECT to_char(now() AT TIME ZONE 'UTC', 'HH24:MI') AS t, to_char((now() - interval '1 minute') AT TIME ZONE 'UTC', 'HH24:MI') AS e");
    await pool.query(
      "INSERT INTO ckl.notification_settings (zodu_id, user_id, timezone, quiet_start, quiet_end) VALUES ('Z001', $1, 'UTC', $2, $3)",
      [EMP.cashier.user_id, now.t, now.e],
    );
    await pool.query(
      "INSERT INTO ckl.notification_preferences VALUES ('Z001', $1, 'RUN_REMINDER', 'WEB_PUSH', true)",
      [EMP.cashier.user_id],
    );
    await notify([EMP.cashier.user_id], 'quiet', { channels: ['IN_APP', 'WEB_PUSH'] });
    await notify([EMP.cashier.user_id], 'loud', { channels: ['IN_APP', 'WEB_PUSH'], severity: 'CRITICAL' });
    const rows = (await pool.query(
      `SELECT n.dedupe_key, n.show_in_inbox, d.next_attempt_at > now() + interval '1 hour' AS deferred
         FROM ckl.notifications n JOIN ckl.notification_deliveries d ON d.notification_id = n.id
        ORDER BY n.dedupe_key`,
    )).rows;
    expect(rows).toEqual([
      { dedupe_key: 'loud', show_in_inbox: true, deferred: false },
      { dedupe_key: 'quiet', show_in_inbox: true, deferred: true },
    ]);
  });

  test('fn_quiet_hours_end across midnight', async () => {
    await pool.query(
      "INSERT INTO ckl.notification_settings (zodu_id, user_id, timezone, quiet_start, quiet_end) VALUES ('Z001', $1, 'Asia/Kolkata', '22:00', '07:00')",
      [EMP.cashier.user_id],
    );
    // local wall-clock in → local wall-clock out (as text: no Node time zone involved)
    const at = (local) => q1(
      `SELECT to_char(ckl.fn_quiet_hours_end('Z001', $1, ($2::timestamp AT TIME ZONE 'Asia/Kolkata')) AT TIME ZONE 'Asia/Kolkata',
                      'YYYY-MM-DD"T"HH24:MI') AS t`,
      [EMP.cashier.user_id, local],
    ).then((r) => r.t);
    expect(await at('2026-11-16 23:30')).toBe('2026-11-17T07:00');
    expect(await at('2026-11-17 03:00')).toBe('2026-11-17T07:00');
    expect(await at('2026-11-17 12:00')).toBe('2026-11-17T12:00');
  });

  test('pg_notify reaches a LISTEN client after commit, never on rollback', async () => {
    const client = new Client(connection());
    await client.connect();
    const got = [];
    client.on('notification', (m) => got.push(JSON.parse(m.payload)));
    await client.query('LISTEN ckl_notifications');
    const c = await pool.connect();
    await c.query('BEGIN');
    await c.query("SELECT ckl.fn_notify('Z001','B1', ARRAY[$1]::uuid[], 'RUN_REMINDER','INFO','t','b',NULL,NULL,NULL,'{}','rolled')", [EMP.cashier.user_id]);
    await c.query('ROLLBACK');
    await c.query("SELECT ckl.fn_notify('Z001','B1', ARRAY[$1]::uuid[], 'RUN_REMINDER','INFO','t','b',NULL,NULL,NULL,'{}','kept')", [EMP.cashier.user_id]);
    c.release();
    await new Promise((r) => setTimeout(r, 300));
    await client.end();
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ user_id: EMP.cashier.user_id, zodu_id: 'Z001', branch_id: 'B1' });
  });
});

test('CALL ckl.sp_scheduler_tick(): generation + rules + bookkeeping with zero job errors', async () => {
  const id = await createChecklist({ rules: [{ rule_type: 'NOTIFY_ON_OVERDUE' }] });
  await insertRun(id, { dueInMin: -3, slotOffsetMin: -100000 });   // a slot generation will never touch
  const c = new Client(connection());
  await c.connect();
  await c.query("CALL ckl.sp_scheduler_tick(interval '36 hours')");
  await c.end();
  const tick = await q1("SELECT stats FROM ckl.job_state WHERE job = 'tick'");
  expect(tick.stats.errors).toBe(0);
  expect(tick.stats.runs_generated).toBeGreaterThanOrEqual(1);
  expect(tick.stats.rules_fired).toBe(1);
  expect(await q1("SELECT last_run_at FROM ckl.job_state WHERE job = 'housekeeping'")).toBeTruthy();
  expect((await q1('SELECT count(*) AS n FROM ckl.job_errors')).n).toBe(0);
});

test('purge of one branch leaves the other company untouched (idempotent)', async () => {
  await seedDirectory(T2, [OTHER]);
  const mine = await createChecklist();
  const theirs = await createChecklist({ tenant: T2, assignees: [OTHER.employee_id] });
  await insertRun(mine);
  await insertRun(theirs, { assignee: OTHER });
  const first = (await q1("SELECT ckl.fn_purge_branch('Z001', 'B1') AS r")).r;
  expect(first).toMatchObject({ runs: 1, checklists: 1, directory: 5 });
  expect((await q1("SELECT ckl.fn_purge_branch('Z001', 'B1') AS r")).r).toMatchObject({ runs: 0, checklists: 0 });
  expect((await q1("SELECT count(*) AS n FROM ckl.runs WHERE zodu_id = 'Z002'")).n).toBe(1);
  expect((await q1("SELECT count(*) AS n FROM ckl.checklists WHERE zodu_id = 'Z002'")).n).toBe(1);
  expect((await q1("SELECT ckl.fn_purge_company('Z002') AS r")).r).toMatchObject({ runs: 1, checklists: 1, directory: 1 });
});
