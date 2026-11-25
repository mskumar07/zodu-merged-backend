// Test data straight into the database (the SQL tests exercise procedures,
// not the API). Ids are fixed so assertions can name people.
const pool = require('../../src/database/pool');
const { USERS } = require('@zodu/security/testing');

const T1 = { zodu_id: 'Z001', branch_id: 'B1' };
const T2 = { zodu_id: 'Z002', branch_id: 'B1' };

// Employees of Z001 / B1; the first three have the fake auth-service's users as logins.
const EMP = {
  owner: { employee_id: 'e0000000-0000-4000-8000-000000000001', user_id: USERS.owner.userId, name: 'Owner One' },
  manager: { employee_id: 'e0000000-0000-4000-8000-000000000002', user_id: USERS.manager.userId, name: 'Meena Manager' },
  cashier: { employee_id: 'e0000000-0000-4000-8000-000000000003', user_id: USERS.cashier.userId, name: 'Karthik Cashier', manager: 'e0000000-0000-4000-8000-000000000002' },
  nologin: { employee_id: 'e0000000-0000-4000-8000-000000000004', user_id: null, name: 'Ravi NoLogin', manager: 'e0000000-0000-4000-8000-000000000002' },
  gone: { employee_id: 'e0000000-0000-4000-8000-000000000005', user_id: null, name: 'Left Already', active: false },
};
const OTHER = { employee_id: 'e0000000-0000-4000-8000-000000000099', user_id: USERS.other.userId, name: 'Other Co' };

const TABLES = ['runs', 'checklists', 'checklist_code_counters', 'employee_directory', 'directory_sync_state',
  'notifications', 'notification_preferences', 'notification_settings', 'idempotency_keys', 'job_state', 'job_errors'];

async function reset() {
  await pool.query(`TRUNCATE ${TABLES.map((t) => `ckl.${t}`).join(', ')} RESTART IDENTITY CASCADE`);
  await pool.query('DELETE FROM ckl.categories');
  await pool.query('DELETE FROM ckl.company_settings');
  await pool.query('DELETE FROM ckl.task_statuses');
  await pool.query('DELETE FROM ckl.task_files');
}

async function seedDirectory(tenant = T1, people = Object.values(EMP)) {
  for (const p of people) {
    await pool.query(
      `INSERT INTO ckl.employee_directory (zodu_id, branch_id, employee_id, user_id, employee_name, is_active, reporting_manager_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (zodu_id, branch_id, employee_id) DO UPDATE
         SET is_active = EXCLUDED.is_active, reporting_manager_id = EXCLUDED.reporting_manager_id`,
      [tenant.zodu_id, tenant.branch_id, p.employee_id, p.user_id, p.name, p.active !== false, p.manager ?? null],
    );
  }
  await pool.query(
    `INSERT INTO ckl.directory_sync_state (zodu_id, branch_id, last_success_at, last_full_sync_at)
     VALUES ($1, $2, now(), now()) ON CONFLICT (zodu_id, branch_id) DO UPDATE SET last_success_at = now()`,
    [tenant.zodu_id, tenant.branch_id],
  );
}

const q1 = async (sql, params) => (await pool.query(sql, params)).rows[0];

async function localToday(tz = 'Asia/Kolkata') {
  return (await q1('SELECT (now() AT TIME ZONE $1)::date AS d', [tz])).d;
}

// A checklist written directly (no API). schedule: column overrides.
async function createChecklist({
  tenant = T1, name = 'Opening checks', timezone = 'Asia/Kolkata', schedule = {}, assignMode = 'SPECIFIC',
  assignees = [EMP.cashier.employee_id], reviewer = null, rules = [], tasks = 3, status = 'ACTIVE',
  requirePhoto = false, createdBy = USERS.owner.userId, categoryId = null,
} = {}) {
  const today = await localToday(timezone);
  const c = await q1(
    `INSERT INTO ckl.checklists (zodu_id, branch_id, code, name, priority, status, assign_mode, reviewer_employee_id,
                                 timezone, require_photo, created_by_user_id, created_by_name, category_id)
     VALUES ($1::text, $2::text, ckl.fn_next_checklist_code($1::text, $2::text), $3, 'HIGH', $4, $5, $6, $7, $8, $9, 'Owner One', $10) RETURNING id`,
    [tenant.zodu_id, tenant.branch_id, name, status, assignMode, reviewer, timezone, requirePhoto, createdBy, categoryId],
  );
  const s = {
    task_type: 'RECURRING', frequency: 'DAILY', every_n: 1, trigger_time: '10:00', start_date: today,
    ends: 'NEVER', weekdays: [], ...schedule,
  };
  const cols = Object.keys(s);
  await pool.query(
    `INSERT INTO ckl.checklist_schedules (checklist_id, ${cols.join(', ')})
     VALUES ($1, ${cols.map((k, i) => (k === 'weekdays' ? `$${i + 2}::smallint[]` : `$${i + 2}`)).join(', ')})`,
    [c.id, ...cols.map((k) => s[k])],
  );
  for (let i = 1; i <= tasks; i++) {
    await pool.query(
      'INSERT INTO ckl.checklist_tasks (checklist_id, position, title, require_photo) VALUES ($1, $2, $3, $4)',
      [c.id, i, `Task ${i}`, i === 1],
    );
  }
  for (const e of assignees) {
    await pool.query('INSERT INTO ckl.checklist_assignees (checklist_id, employee_id) VALUES ($1, $2)', [c.id, e]);
  }
  for (const r of rules) {
    await pool.query(
      `INSERT INTO ckl.checklist_rules (checklist_id, rule_type, offset_min, threshold, target, target_employee_ids, channels)
       VALUES ($1, $2, $3, $4, $5, $6::uuid[], $7::varchar[])`,
      [c.id, r.rule_type, r.offset_min ?? 0, r.threshold ?? null, r.target ?? 'ASSIGNEE', r.target_employee_ids ?? [], r.channels ?? ['IN_APP']],
    );
  }
  return c.id;
}

// A run written directly, with times relative to now (minutes).
async function insertRun(checklistId, {
  assignee = EMP.cashier, dueInMin = 60, createdAgoMin = 120, status = 'TODO', slotOffsetMin, items = 2, reviewer = null,
} = {}) {
  const r = await q1(
    `INSERT INTO ckl.runs (zodu_id, branch_id, checklist_id, slot_at, run_date, sequence_no, assignee_employee_id,
                           assignee_name, title, priority, frequency, reviewer_employee_id, requires_review,
                           available_at, due_at, status, total_items, created_at)
     SELECT c.zodu_id, c.branch_id, c.id, now() + make_interval(mins => $3::int), (now() AT TIME ZONE c.timezone)::date, 1, $2,
            $4, c.name, c.priority, 'DAILY', $8::uuid, $8::uuid IS NOT NULL,
            now() - interval '1 day', now() + make_interval(mins => $5::int), $6, $7, now() - make_interval(mins => $9::int)
       FROM ckl.checklists c WHERE c.id = $1
     RETURNING id`,
    [checklistId, assignee.employee_id, slotOffsetMin ?? dueInMin, assignee.name, dueInMin, status, items, reviewer, createdAgoMin],
  );
  for (let i = 1; i <= items; i++) {
    await pool.query('INSERT INTO ckl.run_items (run_id, position, title) VALUES ($1, $2, $3)', [r.id, i, `Item ${i}`]);
  }
  return r.id;
}

async function notificationsFor(userId) {
  return (await pool.query(
    'SELECT * FROM ckl.notifications WHERE recipient_user_id = $1 ORDER BY created_at, id',
    [userId],
  )).rows;
}

module.exports = { pool, q1, reset, seedDirectory, createChecklist, insertRun, notificationsFor, localToday, T1, T2, EMP, OTHER };
