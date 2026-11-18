// fn_generate_for_schedule + fn_reschedule_checklist (§5.2, §5.3).
const { pool, q1, reset, seedDirectory, createChecklist, localToday, EMP } = require('../helpers/db');

afterAll(() => pool.end());
beforeEach(async () => {
  await reset();
  await seedDirectory();
});

const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// Until the end of tomorrow (local), so the tests never depend on the hour they run at.
const untilEndOfTomorrow = async (tz = 'Asia/Kolkata') =>
  (await q1("SELECT ((((now() AT TIME ZONE $1)::date + 2)::timestamp AT TIME ZONE $1) - interval '1 second') AS t", [tz])).t;

const generate = async (id, until) => (await q1('SELECT ckl.fn_generate_for_schedule($1, $2) AS n', [id, until])).n;
const runs = async (id) => (await pool.query('SELECT * FROM ckl.runs WHERE checklist_id = $1 ORDER BY slot_at, assignee_name', [id])).rows;
const schedule = (id) => q1('SELECT * FROM ckl.checklist_schedules WHERE checklist_id = $1', [id]);

test('daily: today and tomorrow, per active assignee; no back-fill; idempotent', async () => {
  const today = await localToday();
  const id = await createChecklist({
    schedule: { start_date: addDays(today, -3) },
    assignees: [EMP.cashier.employee_id, EMP.nologin.employee_id, EMP.gone.employee_id],
  });
  const until = await untilEndOfTomorrow();
  expect(await generate(id, until)).toBe(4);           // 2 days × 2 active (the inactive one gets nothing)
  const rows = await runs(id);
  expect(new Set(rows.map((r) => r.run_date))).toEqual(new Set([today, addDays(today, 1)]));
  expect(rows.some((r) => r.assignee_employee_id === EMP.gone.employee_id)).toBe(false);
  expect(rows[0]).toMatchObject({ status: 'TODO', total_items: 3, done_items: 0, priority: 'HIGH', frequency: 'DAILY' });
  // the 3 past days were counted (After N) but never materialised
  expect((await schedule(id)).occurrences_generated).toBe(5);

  expect(await generate(id, until)).toBe(0);
  expect(await runs(id)).toHaveLength(4);
});

test('item snapshot: require_photo = task AND checklist setting', async () => {
  const off = await createChecklist({ requirePhoto: false });
  const on = await createChecklist({ requirePhoto: true, name: 'Photo checks' });
  const until = await untilEndOfTomorrow();
  await generate(off, until);
  await generate(on, until);
  const photo = async (id) => (await pool.query(
    `SELECT i.position, i.require_photo FROM ckl.run_items i JOIN ckl.runs r ON r.id = i.run_id
      WHERE r.checklist_id = $1 AND r.run_date = (SELECT min(run_date) FROM ckl.runs WHERE checklist_id = $1)
      ORDER BY position`, [id])).rows.map((r) => r.require_photo);
  expect(await photo(off)).toEqual([false, false, false]);
  expect(await photo(on)).toEqual([true, false, false]);   // task 1 asks for a photo
});

test('slot time is the trigger time in the checklist\'s own zone', async () => {
  const id = await createChecklist({ timezone: 'Asia/Dubai', schedule: { trigger_time: '09:00', start_date: await localToday('Asia/Dubai') } });
  await generate(id, await untilEndOfTomorrow('Asia/Dubai'));
  const [r] = await runs(id);
  expect(new Date(r.slot_at).toISOString().slice(11, 16)).toBe('05:00');   // 09:00 +04
  expect(new Date(r.due_at).getTime()).toBe(new Date(r.slot_at).getTime());
  // non-hourly runs open at the start of their local day
  const day = await q1("SELECT ($1::date::timestamp AT TIME ZONE 'Asia/Dubai') AS t", [r.run_date]);
  expect(new Date(r.available_at).getTime()).toBe(new Date(day.t).getTime());
});

test('After N: counts past slots, materialises today onwards, then stops for good', async () => {
  const today = await localToday();
  const id = await createChecklist({ schedule: { start_date: addDays(today, -3), ends: 'AFTER', max_occurrences: 5 } });
  await generate(id, await q1("SELECT now() + interval '6 days' AS t").then((r) => r.t));
  const rows = await runs(id);
  expect(rows.map((r) => r.run_date)).toEqual([today, addDays(today, 1)]);
  expect(rows.map((r) => r.sequence_no)).toEqual([4, 5]);
  expect(await schedule(id)).toMatchObject({ occurrences_generated: 5, is_exhausted: true });
  expect(await generate(id, await q1("SELECT now() + interval '9 days' AS t").then((r) => r.t))).toBe(0);
});

test('ON_DATE end is honoured', async () => {
  const today = await localToday();
  const id = await createChecklist({ schedule: { start_date: today, ends: 'ON_DATE', end_date: today } });
  await generate(id, await q1("SELECT now() + interval '5 days' AS t").then((r) => r.t));
  expect((await runs(id)).map((r) => r.run_date)).toEqual([today]);
  expect((await schedule(id)).is_exhausted).toBe(true);
});

test('hourly: window end inclusive, available one interval before the slot', async () => {
  const today = await localToday();
  const id = await createChecklist({
    schedule: { frequency: 'HOURLY', every_n: 2, all_day: false, window_start: '09:00', window_end: '13:00', trigger_time: null, start_date: today },
  });
  await generate(id, await untilEndOfTomorrow());
  const todays = (await runs(id)).filter((r) => r.run_date === today);
  expect(todays).toHaveLength(3);
  for (const r of todays) {
    expect(new Date(r.slot_at) - new Date(r.available_at)).toBe(2 * 3600_000);
  }
});

test('ALL mode: one shared run per slot, not one per employee', async () => {
  const id = await createChecklist({ assignMode: 'ALL', assignees: [] });
  await generate(id, await untilEndOfTomorrow());
  const all = await runs(id);
  expect(all.length).toBeGreaterThan(0);
  expect(new Set(all.map((r) => r.slot_at.toISOString())).size).toBe(all.length);
  for (const r of all) expect(r).toMatchObject({ assignee_employee_id: null, assignee_name: 'All employees' });
  // generating again over the same slots adds nothing (NULLs collide in uq_run_slot)
  await pool.query('UPDATE ckl.checklist_schedules SET generated_until = NULL WHERE checklist_id = $1', [id]);
  await generate(id, await untilEndOfTomorrow());
  expect(await runs(id)).toHaveLength(all.length);
});

test('ALL mode: no shared run while the branch has no active employee', async () => {
  await pool.query('UPDATE ckl.employee_directory SET is_active = false');
  const id = await createChecklist({ assignMode: 'ALL', assignees: [] });
  await generate(id, await untilEndOfTomorrow());
  expect(await runs(id)).toHaveLength(0);
});

test('no directory yet: nothing generated and the watermark stays', async () => {
  await pool.query('DELETE FROM ckl.directory_sync_state');
  const id = await createChecklist();
  expect(await generate(id, await untilEndOfTomorrow())).toBe(0);
  expect((await schedule(id)).generated_until).toBeNull();
});

test('paused checklists generate nothing', async () => {
  const id = await createChecklist({ status: 'PAUSED' });
  expect(await generate(id, await untilEndOfTomorrow())).toBe(0);
});

describe('fn_reschedule_checklist', () => {
  test('drops untouched future runs, keeps touched ones, regenerates the rest', async () => {
    const today = await localToday();
    const id = await createChecklist({
      schedule: { start_date: today, trigger_time: '23:59' },
      assignees: [EMP.cashier.employee_id, EMP.nologin.employee_id],
    });
    await generate(id, await untilEndOfTomorrow());
    const before = await runs(id);
    expect(before).toHaveLength(4);
    const touched = before.find((r) => r.run_date === addDays(today, 1));
    await pool.query("INSERT INTO ckl.run_events (run_id, zodu_id, branch_id, event_type) VALUES ($1, 'Z001', 'B1', 'NOTE')", [touched.id]);

    const deleted = (await q1("SELECT ckl.fn_reschedule_checklist($1, now() - interval '1 minute', false) AS n", [id])).n;
    expect(deleted).toBe(3);
    expect((await runs(id)).map((r) => r.id)).toEqual([touched.id]);
    // slots that lost every run are counted again; the touched slot keeps its count
    expect((await schedule(id)).occurrences_generated).toBe(1);

    await generate(id, await untilEndOfTomorrow());
    expect(await runs(id)).toHaveLength(4);
    expect((await schedule(id)).occurrences_generated).toBe(2);
  });

  test('never moves an empty watermark forward', async () => {
    await pool.query('DELETE FROM ckl.directory_sync_state');
    const id = await createChecklist();
    await q1("SELECT ckl.fn_reschedule_checklist($1, now() + interval '1 day', true)", [id]);
    expect((await schedule(id)).generated_until).toBeNull();
  });

  test('reset_count restarts After N from the effective point', async () => {
    const today = await localToday();
    const id = await createChecklist({ schedule: { start_date: today, ends: 'AFTER', max_occurrences: 2 } });
    await generate(id, await untilEndOfTomorrow());
    expect((await schedule(id)).is_exhausted).toBe(true);
    await q1("SELECT ckl.fn_reschedule_checklist($1, now() + interval '3 days', true)", [id]);
    expect(await schedule(id)).toMatchObject({ occurrences_generated: 0, is_exhausted: false });
  });
});
