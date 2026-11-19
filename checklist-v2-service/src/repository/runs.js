// SQL for runs (the board). Tenant first in every function.
const pool = require('../database/pool');

// The board's four columns as SQL conditions (same mapping as ckl.fn_board_status).
const BOARD_SQL = {
  TODO: "(r.status = 'TODO' AND r.due_at >= now())",
  IN_PROGRESS: "((r.status = 'IN_PROGRESS' AND r.due_at >= now()) OR r.status = 'PENDING_REVIEW')",
  OVERDUE: "((r.status IN ('TODO','IN_PROGRESS') AND r.due_at < now()) OR r.status = 'MISSED')",
  COMPLETED: "(r.status = 'COMPLETED')",
};

const SELECT_RUN = `
  SELECT r.*, c.code, c.timezone, c.created_by_user_id AS creator_user_id,
         cat.color AS category_color,
         ckl.fn_board_status(r.status, r.due_at) AS board_status,
         to_char(r.due_at AT TIME ZONE c.timezone, 'HH24:MI') AS due_time,
         GREATEST(0, floor(EXTRACT(EPOCH FROM now() - r.due_at) / 60))::int AS late_min,
         rv.employee_name AS reviewer_name,
         to_char(r.due_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS due_key
    FROM ckl.runs r
    JOIN ckl.checklists c ON c.id = r.checklist_id
    LEFT JOIN ckl.categories cat ON cat.id = r.category_id
    LEFT JOIN ckl.employee_directory rv
      ON rv.zodu_id = r.zodu_id AND rv.branch_id = r.branch_id AND rv.employee_id = r.reviewer_employee_id`;

// Board filters → WHERE. f.assignee: forced to the caller for view=my. Shared runs
// (assignee NULL, "Assign To All") are everyone's, so they match any assignee.
function filterSql(tenant, f, { withStatus = true } = {}) {
  const params = [tenant.zodu_id, tenant.branch_id];
  const where = ['r.zodu_id = $1', 'r.branch_id = $2', "r.status <> 'CANCELLED'"];
  const add = (sql, ...vals) => {
    let out = sql;
    for (const v of vals) { params.push(v); out = out.replace('?', `$${params.length}`); }
    where.push(out);
  };
  if (f.date) add('r.run_date = ?', f.date);
  if (f.from) add('r.run_date BETWEEN ? AND ?', f.from, f.to);
  if (f.assignee) add('(r.assignee_employee_id = ? OR r.assignee_employee_id IS NULL)', f.assignee);
  if (f.priority) add('r.priority = ?', f.priority);
  if (f.category_id) add('r.category_id = ?', f.category_id);
  if (f.checklist_id) add('r.checklist_id = ?', f.checklist_id);
  if (f.frequency) add('r.frequency = ?', f.frequency);
  if (f.search) {
    const like = `%${f.search.replace(/[\\%_]/g, '\\$&')}%`;
    add("(r.title ILIKE ? ESCAPE '\\' OR r.assignee_name ILIKE ? ESCAPE '\\' OR c.code ILIKE ? ESCAPE '\\')", like, like, like);
  }
  if (withStatus && f.status) where.push(BOARD_SQL[f.status]);
  return { params, where };
}

async function list(tenant, f, cursorKey) {
  const { params, where } = filterSql(tenant, f);
  if (cursorKey) {
    params.push(cursorKey[0], cursorKey[1]);
    where.push(`(r.due_at, r.id) > ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
  }
  params.push(f.limit + 1);
  const { rows } = await pool.query(
    `${SELECT_RUN} WHERE ${where.join(' AND ')} ORDER BY r.due_at, r.id LIMIT $${params.length}`,
    params,
  );
  return rows;
}

async function summary(tenant, f) {
  const { params, where } = filterSql(tenant, f, { withStatus: false });
  const { rows: [s] } = await pool.query(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE ${BOARD_SQL.TODO}) AS todo,
            count(*) FILTER (WHERE ${BOARD_SQL.IN_PROGRESS}) AS in_progress,
            count(*) FILTER (WHERE ${BOARD_SQL.OVERDUE}) AS overdue,
            count(*) FILTER (WHERE ${BOARD_SQL.COMPLETED}) AS completed,
            count(*) FILTER (WHERE r.status = 'PENDING_REVIEW') AS pending_review,
            count(*) FILTER (WHERE r.status = 'MISSED') AS missed,
            count(*) FILTER (WHERE r.status = 'COMPLETED' AND r.completed_at > r.due_at) AS completed_late
       FROM ckl.runs r JOIN ckl.checklists c ON c.id = r.checklist_id
      WHERE ${where.join(' AND ')}`,
    params,
  );
  return { ...s, completion_rate: s.total ? Math.round((s.completed / s.total) * 1000) / 10 : 0 };
}

async function reviewQueue(tenant, reviewerEmployeeId) {
  const { rows } = await pool.query(
    `${SELECT_RUN}
      WHERE r.zodu_id = $1 AND r.branch_id = $2 AND r.status = 'PENDING_REVIEW' AND r.reviewer_employee_id = $3
      ORDER BY r.submitted_at, r.id LIMIT 500`,
    [tenant.zodu_id, tenant.branch_id, reviewerEmployeeId],
  );
  return rows;
}

async function findRun(tenant, id, db = pool) {
  const { rows: [r] } = await db.query(
    `${SELECT_RUN} WHERE r.id = $1 AND r.zodu_id = $2 AND r.branch_id = $3`,
    [id, tenant.zodu_id, tenant.branch_id],
  );
  return r || null;
}

// Row lock for a mutation (§8.5: SELECT … FOR UPDATE on the run).
async function lockRun(db, tenant, id) {
  const { rows: [r] } = await db.query(
    `SELECT r.*, now() < r.available_at AS not_started, c.created_by_user_id AS creator_user_id
       FROM ckl.runs r JOIN ckl.checklists c ON c.id = r.checklist_id
      WHERE r.id = $1 AND r.zodu_id = $2 AND r.branch_id = $3 FOR UPDATE OF r`,
    [id, tenant.zodu_id, tenant.branch_id],
  );
  return r || null;
}

async function items(runId, db = pool) {
  const { rows } = await db.query(
    `SELECT i.*, COALESCE(json_agg(json_build_object('id', p.id, 'file_id', p.file_id, 'file_name', p.file_name,
                                                     'created_at', p.created_at) ORDER BY p.created_at)
                          FILTER (WHERE p.id IS NOT NULL), '[]') AS photos
       FROM ckl.run_items i LEFT JOIN ckl.run_item_photos p ON p.run_item_id = i.id
      WHERE i.run_id = $1 GROUP BY i.id ORDER BY i.position`,
    [runId],
  );
  return rows;
}

async function events(runId, db = pool) {
  const { rows } = await db.query(
    `SELECT e.id, e.event_type, e.from_status, e.to_status, e.actor_user_id, e.payload, e.created_at,
            (SELECT d.employee_name FROM ckl.employee_directory d
              WHERE d.user_id = e.actor_user_id AND d.zodu_id = e.zodu_id AND d.branch_id = e.branch_id LIMIT 1) AS actor_name
       FROM ckl.run_events e WHERE e.run_id = $1 ORDER BY e.created_at, e.id LIMIT 500`,
    [runId],
  );
  return rows;
}

const runOut = (r) => ({
  id: r.id,
  checklist_id: r.checklist_id,
  code: r.code,
  name: r.title,
  description: r.description,
  category: r.category_id ? { id: r.category_id, name: r.category_name, color: r.category_color } : null,
  priority: r.priority,
  frequency: r.frequency,
  run_date: r.run_date,
  slot_at: r.slot_at,
  available_at: r.available_at,
  due_at: r.due_at,
  due_time: r.due_time,
  status: r.status,
  board_status: r.board_status,
  overdue_minutes: r.board_status === 'OVERDUE' ? r.late_min : 0,
  // Shared run: employee_id null, name 'All employees'; any active employee works on it.
  assign_all: r.assignee_employee_id === null,
  assignee: { employee_id: r.assignee_employee_id, name: r.assignee_name },
  // The checklist's creator may complete its runs too (besides the assignee).
  created_by_user_id: r.creator_user_id,
  submitted_by: r.submitted_by_employee_id ? { employee_id: r.submitted_by_employee_id, name: r.submitted_by_name } : null,
  reviewer: r.reviewer_employee_id ? { employee_id: r.reviewer_employee_id, name: r.reviewer_name } : null,
  requires_review: r.requires_review,
  allow_partial: r.allow_partial,
  // done = closed tasks (done or can't do); skipped = how many of those are can't do.
  progress: { done: r.done_items, total: r.total_items, skipped: r.skipped_items ?? 0 },
  started_at: r.started_at,
  submitted_at: r.submitted_at,
  completed_at: r.completed_at,
  completed_late: Boolean(r.completed_at && new Date(r.completed_at) > new Date(r.due_at)),
  reviewed_at: r.reviewed_at,
  review_comment: r.review_comment,
  rejected_count: r.rejected_count,
  row_version: r.row_version,
});

const itemOut = (i, tenant) => ({
  id: i.id,
  position: i.position,
  title: i.title,
  instructions: i.instructions,
  require_photo: i.require_photo,
  allow_notes: i.allow_notes,
  is_done: i.is_done,
  note: i.note,
  done_at: i.done_at,
  done_by_employee_id: i.done_by_employee_id,
  // Sub-status (Settings → task statuses), as it was when set. closes_task: the task
  // counts as closed (is_skipped) without being done.
  sub_status: i.sub_status_name
    ? { id: i.sub_status_id, name: i.sub_status_name, color: i.sub_status_color, closes_task: i.sub_status_closes,
        set_at: i.sub_status_at, set_by_employee_id: i.sub_status_by_employee_id }
    : null,
  is_skipped: i.is_skipped,
  // file refs → { id, file_name, created_at, url } (fileUrlsMiddleware)
  photos: i.photos.map((p) => ({ ...p, file_ctx: `${tenant.zodu_id}/${tenant.branch_id}`, url_key: 'url' })),
});

module.exports = { list, summary, reviewQueue, findRun, lockRun, items, events, runOut, itemOut, BOARD_SQL };
