// SQL for checklist definitions. Every function takes the tenant first and
// filters by it; db is the pool or a transaction client.
const pool = require('../database/pool');

const hm = (t) => (t ? String(t).slice(0, 5) : null);

// The full definition, or null (another tenant's id, deleted, or unknown).
async function findDefinition(tenant, id, db = pool, { forUpdate = false } = {}) {
  const { rows: [c] } = await db.query(
    `SELECT c.*, cat.name AS category_name, cat.color AS category_color, cat.icon AS category_icon
       FROM ckl.checklists c
       LEFT JOIN ckl.categories cat ON cat.id = c.category_id
      WHERE c.id = $1 AND c.zodu_id = $2 AND c.branch_id = $3 AND c.deleted_at IS NULL
      ${forUpdate ? 'FOR UPDATE OF c' : ''}`,
    [id, tenant.zodu_id, tenant.branch_id],
  );
  if (!c) return null;
  // A transaction client runs one query at a time; the pool may run them together.
  const all = db === pool ? (qs) => Promise.all(qs.map((q) => q())) : async (qs) => { const out = []; for (const q of qs) out.push(await q()); return out; };
  const [sched, tasks, assignees, rules, images, reviewer] = await all([
    () => db.query('SELECT * FROM ckl.checklist_schedules WHERE checklist_id = $1', [id]),
    () => db.query('SELECT * FROM ckl.checklist_tasks WHERE checklist_id = $1 ORDER BY position', [id]),
    () => db.query(
      `SELECT a.employee_id, d.employee_name AS name, COALESCE(d.is_active, false) AS is_active
         FROM ckl.checklist_assignees a
         LEFT JOIN ckl.employee_directory d
           ON d.zodu_id = $2 AND d.branch_id = $3 AND d.employee_id = a.employee_id
        WHERE a.checklist_id = $1 ORDER BY d.employee_name NULLS LAST`,
      [id, tenant.zodu_id, tenant.branch_id],
    ),
    () => db.query('SELECT * FROM ckl.checklist_rules WHERE checklist_id = $1 ORDER BY created_at, rule_type', [id]),
    () => db.query('SELECT * FROM ckl.checklist_images WHERE checklist_id = $1 ORDER BY position', [id]),
    () => (c.reviewer_employee_id
      ? db.query(
        'SELECT employee_name FROM ckl.employee_directory WHERE zodu_id = $1 AND branch_id = $2 AND employee_id = $3',
        [tenant.zodu_id, tenant.branch_id, c.reviewer_employee_id],
      )
      : { rows: [] }),
  ]);
  return { c, s: sched.rows[0], tasks: tasks.rows, assignees: assignees.rows, rules: rules.rows, images: images.rows, reviewerName: reviewer.rows[0]?.employee_name ?? null };
}

// The schedule row in the shape of the API / normalizeSchedule().
function scheduleOut(s) {
  if (!s) return null;
  return {
    task_type: s.task_type,
    frequency: s.frequency,
    every_n: s.every_n,
    all_day: s.all_day,
    window_start: hm(s.window_start),
    window_end: hm(s.window_end),
    weekdays_only: s.weekdays_only,
    weekdays: (s.weekdays || []).map(Number),
    monthly_by: s.monthly_by,
    month_day: s.month_day,
    nth: s.nth,
    nth_weekday: s.nth_weekday,
    trigger_time: hm(s.trigger_time),
    start_date: s.start_date,
    ends: s.ends,
    max_occurrences: s.max_occurrences,
    end_date: s.end_date,
    generated_until: s.generated_until,
    occurrences_generated: s.occurrences_generated,
    is_exhausted: s.is_exhausted,
  };
}

function definitionOut(def, tenant) {
  const { c, s, tasks, assignees, rules, images, reviewerName } = def;
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    description: c.description,
    category: c.category_id ? { id: c.category_id, name: c.category_name, color: c.category_color, icon: c.category_icon } : null,
    priority: c.priority,
    status: c.status,
    timezone: c.timezone,
    assign_mode: c.assign_mode,
    assignee_employee_ids: assignees.map((a) => a.employee_id),
    assignees: assignees.map((a) => ({ employee_id: a.employee_id, name: a.name, is_active: a.is_active })),
    reviewer_employee_id: c.reviewer_employee_id,
    reviewer: c.reviewer_employee_id ? { employee_id: c.reviewer_employee_id, name: reviewerName } : null,
    settings: { require_photo: c.require_photo, allow_partial: c.allow_partial, allow_notes: c.allow_notes },
    schedule: scheduleOut(s),
    tasks: tasks.map((t) => ({
      id: t.id, position: t.position, title: t.title, instructions: t.instructions,
      require_photo: t.require_photo, allow_notes: t.allow_notes,
    })),
    rules: rules.map((r) => ({
      id: r.id, rule_type: r.rule_type, offset_min: r.offset_min, threshold: r.threshold, target: r.target,
      target_employee_ids: r.target_employee_ids, channels: r.channels, is_active: r.is_active,
    })),
    // file refs: fileUrlsMiddleware swaps them for fresh URLs ({ ..., url }).
    images: images.map((i) => ({
      id: i.id, position: i.position, file_name: i.file_name, file_id: i.file_id,
      file_ctx: `${tenant.zodu_id}/${tenant.branch_id}`, url_key: 'url',
    })),
    created_by: { user_id: c.created_by_user_id, name: c.created_by_name },
    updated_by: c.updated_by_user_id ? { user_id: c.updated_by_user_id, name: c.updated_by_name } : null,
    row_version: c.row_version,
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}

async function list(tenant, f, cursorKey) {
  const params = [tenant.zodu_id, tenant.branch_id];
  const where = ['c.zodu_id = $1', 'c.branch_id = $2', 'c.deleted_at IS NULL'];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (f.status) add('c.status = ?', f.status);
  if (f.category_id) add('c.category_id = ?', f.category_id);
  if (f.priority) add('c.priority = ?', f.priority);
  if (f.frequency === 'ONE_TIME') where.push("s.task_type = 'ONCE'");
  else if (f.frequency) add("s.task_type = 'RECURRING' AND s.frequency = ?", f.frequency);
  if (f.search) add("(c.name ILIKE ? ESCAPE '\\' OR c.code ILIKE $" + (params.length + 1) + " ESCAPE '\\')", `%${f.search.replace(/[\\%_]/g, '\\$&')}%`);
  if (cursorKey) {
    params.push(cursorKey[0], cursorKey[1]);
    where.push(`(c.created_at, c.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
  }
  params.push(f.limit + 1);
  const { rows } = await pool.query(
    `SELECT c.id, c.code, c.name, c.description, c.priority, c.status, c.assign_mode, c.reviewer_employee_id,
            c.timezone, c.row_version, c.created_at, c.updated_at, c.created_by_name,
            to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_key,
            cat.id AS category_id, cat.name AS category_name, cat.color AS category_color, cat.icon AS category_icon,
            s.task_type, s.frequency, s.every_n, s.trigger_time, s.window_start, s.window_end, s.weekdays,
            s.start_date, s.ends, s.end_date, s.max_occurrences, s.is_exhausted,
            (SELECT count(*) FROM ckl.checklist_tasks t WHERE t.checklist_id = c.id) AS task_count,
            (SELECT count(*) FROM ckl.checklist_assignees a WHERE a.checklist_id = c.id) AS assignee_count
       FROM ckl.checklists c
       JOIN ckl.checklist_schedules s ON s.checklist_id = c.id
       LEFT JOIN ckl.categories cat ON cat.id = c.category_id
      WHERE ${where.join(' AND ')}
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT $${params.length}`,
    params,
  );
  return rows;
}

const listRowOut = (r) => ({
  id: r.id,
  code: r.code,
  name: r.name,
  description: r.description,
  category: r.category_id ? { id: r.category_id, name: r.category_name, color: r.category_color, icon: r.category_icon } : null,
  priority: r.priority,
  status: r.status,
  assign_mode: r.assign_mode,
  assignee_count: r.assignee_count,
  reviewer_employee_id: r.reviewer_employee_id,
  task_count: r.task_count,
  timezone: r.timezone,
  schedule: {
    task_type: r.task_type, frequency: r.frequency, every_n: r.every_n, trigger_time: hm(r.trigger_time),
    window_start: hm(r.window_start), window_end: hm(r.window_end), weekdays: (r.weekdays || []).map(Number),
    start_date: r.start_date, ends: r.ends, end_date: r.end_date, max_occurrences: r.max_occurrences,
    is_exhausted: r.is_exhausted,
  },
  created_by_name: r.created_by_name,
  row_version: r.row_version,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

async function insertSchedule(db, checklistId, s) {
  await db.query(
    `INSERT INTO ckl.checklist_schedules
       (checklist_id, task_type, frequency, every_n, all_day, window_start, window_end, weekdays_only, weekdays,
        monthly_by, month_day, nth, nth_weekday, trigger_time, start_date, ends, max_occurrences, end_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::smallint[],$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [checklistId, s.task_type, s.frequency, s.every_n, s.all_day, s.window_start, s.window_end, s.weekdays_only,
      s.weekdays, s.monthly_by, s.month_day, s.nth, s.nth_weekday, s.trigger_time, s.start_date, s.ends,
      s.max_occurrences, s.end_date],
  );
}

async function updateSchedule(db, checklistId, s) {
  await db.query(
    `UPDATE ckl.checklist_schedules
        SET task_type = $2, frequency = $3, every_n = $4, all_day = $5, window_start = $6, window_end = $7,
            weekdays_only = $8, weekdays = $9::smallint[], monthly_by = $10, month_day = $11, nth = $12,
            nth_weekday = $13, trigger_time = $14, start_date = $15, ends = $16, max_occurrences = $17,
            end_date = $18, updated_at = now()
      WHERE checklist_id = $1`,
    [checklistId, s.task_type, s.frequency, s.every_n, s.all_day, s.window_start, s.window_end, s.weekdays_only,
      s.weekdays, s.monthly_by, s.month_day, s.nth, s.nth_weekday, s.trigger_time, s.start_date, s.ends,
      s.max_occurrences, s.end_date],
  );
}

async function replaceTasks(db, checklistId, tasks) {
  await db.query('DELETE FROM ckl.checklist_tasks WHERE checklist_id = $1', [checklistId]);
  if (!tasks.length) return;
  await db.query(
    `INSERT INTO ckl.checklist_tasks (checklist_id, position, title, instructions, require_photo, allow_notes)
     SELECT $1, x.ord, x.title, NULLIF(x.instructions, ''), x.require_photo, x.allow_notes
       FROM unnest($2::text[], $3::text[], $4::boolean[], $5::boolean[]) WITH ORDINALITY
            AS x(title, instructions, require_photo, allow_notes, ord)`,
    [checklistId, tasks.map((t) => t.title), tasks.map((t) => t.instructions ?? null),
      tasks.map((t) => t.require_photo), tasks.map((t) => t.allow_notes)],
  );
}

async function replaceAssignees(db, checklistId, ids) {
  await db.query('DELETE FROM ckl.checklist_assignees WHERE checklist_id = $1', [checklistId]);
  if (!ids.length) return;
  await db.query(
    'INSERT INTO ckl.checklist_assignees (checklist_id, employee_id) SELECT $1, unnest($2::uuid[])',
    [checklistId, ids],
  );
}

// Upsert by (rule_type, offset_min, target): unchanged rules keep their id, so
// their rule_firings stay and an edit never re-sends reminders already sent.
async function syncRules(db, checklistId, rules) {
  const keys = rules.map((r) => `${r.rule_type}|${r.offset_min}|${r.target}`);
  await db.query(
    `DELETE FROM ckl.checklist_rules
      WHERE checklist_id = $1 AND NOT (rule_type || '|' || offset_min || '|' || target = ANY ($2::text[]))`,
    [checklistId, keys],
  );
  for (const r of rules) {
    await db.query(
      `INSERT INTO ckl.checklist_rules
         (checklist_id, rule_type, offset_min, threshold, target, target_employee_ids, channels, is_active)
       VALUES ($1, $2, $3, $4, $5, $6::uuid[], $7::varchar[], $8)
       ON CONFLICT (checklist_id, rule_type, offset_min, target) DO UPDATE
         SET threshold = EXCLUDED.threshold, target_employee_ids = EXCLUDED.target_employee_ids,
             channels = EXCLUDED.channels, is_active = EXCLUDED.is_active`,
      [checklistId, r.rule_type, r.offset_min, r.threshold, r.target, r.target_employee_ids, r.channels, r.is_active],
    );
  }
}

// Employees among `ids` that are NOT active in the branch directory.
async function missingEmployees(tenant, ids, db = pool) {
  if (!ids.length) return [];
  const { rows } = await db.query(
    `SELECT x.id FROM unnest($3::uuid[]) AS x(id)
      WHERE NOT EXISTS (SELECT 1 FROM ckl.employee_directory d
                         WHERE d.zodu_id = $1 AND d.branch_id = $2 AND d.employee_id = x.id AND d.is_active)`,
    [tenant.zodu_id, tenant.branch_id, ids],
  );
  return rows.map((r) => r.id);
}

async function categoryUsable(tenant, categoryId, db = pool) {
  const { rowCount } = await db.query(
    'SELECT 1 FROM ckl.categories WHERE id = $1 AND is_active AND (zodu_id IS NULL OR zodu_id = $2)',
    [categoryId, tenant.zodu_id],
  );
  return rowCount > 0;
}

module.exports = {
  findDefinition, definitionOut, scheduleOut, list, listRowOut,
  insertSchedule, updateSchedule, replaceTasks, replaceAssignees, syncRules, missingEmployees, categoryUsable,
};
