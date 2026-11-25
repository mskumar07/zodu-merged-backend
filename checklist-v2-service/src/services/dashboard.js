const { SHARED_WITH, IN_TEAM } = require('../repository/runs');
// Dashboards. Ranges are local calendar days (run_date); default: the last 30 days.
// Cancelled runs never count. "Due" runs are those whose due time has passed or
// that are closed: future open runs are not yet anyone's failure.
const pool = require('../database/pool');
const config = require('../config');
const { badRequest } = require('../utils/errors');
const { todayIn, addDays, daysBetween } = require('../utils/time');

async function range(q) {
  if (q.from) {
    if (q.to < q.from) throw badRequest('"to" must not be before "from"');
    if (daysBetween(q.from, q.to) > 366) throw badRequest('Range may span at most 366 days');
    return { from: q.from, to: q.to };
  }
  const today = await todayIn(config.DEFAULT_TIMEZONE);
  return { from: addDays(today, -29), to: today };
}

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

const COUNTS = `
  count(*) FILTER (WHERE r.due_at < now() OR r.status IN ('COMPLETED','MISSED')) AS due,
  count(*) FILTER (WHERE r.status = 'COMPLETED') AS completed,
  count(*) FILTER (WHERE r.status = 'COMPLETED' AND r.completed_at <= r.due_at) AS on_time,
  count(*) FILTER (WHERE r.status = 'MISSED') AS missed,
  count(*) FILTER (WHERE r.status IN ('TODO','IN_PROGRESS') AND r.due_at < now()) AS overdue_open,
  count(*) FILTER (WHERE r.status = 'PENDING_REVIEW') AS pending_review`;

async function my(tenant, me, q) {
  const { from, to } = await range(q);
  if (!me) {
    return { from, to, due: 0, completed: 0, on_time: 0, missed: 0, overdue_open: 0, pending_review: 0,
      completion_pct: 0, on_time_pct: 0, current_streak: 0, best_streak: 0, daily: [] };
  }
  const params = [tenant.zodu_id, tenant.branch_id, me, from, to];
  // Shared runs count on the dashboard of everyone they are shared with.
  const base = `FROM ckl.runs r WHERE r.zodu_id = $1 AND r.branch_id = $2
                  AND (r.assignee_employee_id = $3 OR ${SHARED_WITH('$3::uuid')})
                  AND r.run_date BETWEEN $4 AND $5 AND r.status <> 'CANCELLED'`;
  const [{ rows: [t] }, { rows: daily }, { rows: [streak] }] = await Promise.all([
    pool.query(`SELECT ${COUNTS} ${base}`, params),
    pool.query(`SELECT r.run_date AS date, ${COUNTS} ${base} GROUP BY r.run_date ORDER BY r.run_date`, params),
    // Streaks of consecutive closed runs completed on time, newest first.
    pool.query(
      `WITH c AS (
         SELECT (r.status = 'COMPLETED' AND r.completed_at <= r.due_at) AS ok, r.slot_at ${base}
            AND (r.due_at < now() OR r.status IN ('COMPLETED','MISSED'))
       ), g AS (
         SELECT ok, slot_at, count(*) FILTER (WHERE NOT ok) OVER (ORDER BY slot_at DESC) AS grp FROM c
       )
       SELECT COALESCE((SELECT count(*) FROM g WHERE grp = 0 AND ok), 0) AS current_streak,
              COALESCE((SELECT max(n) FROM (SELECT count(*) AS n FROM g WHERE ok GROUP BY grp) s), 0) AS best_streak`,
      params,
    ),
  ]);
  return {
    from, to, ...t,
    completion_pct: pct(t.completed, t.due),
    on_time_pct: pct(t.on_time, t.completed),
    current_streak: streak.current_streak,
    best_streak: streak.best_streak,
    daily: daily.map((d) => ({ ...d, completion_pct: pct(d.completed, d.due) })),
  };
}

// scope (see scopeOf): the Admin's covers the branch; a manager's only their team's runs.
async function team(tenant, q, scope) {
  const { from, to } = await range(q);
  const params = [tenant.zodu_id, tenant.branch_id, from, to];
  const limited = scope && !scope.all;
  if (limited) params.push(scope.team, scope.userId);
  const base = `FROM ckl.runs r WHERE r.zodu_id = $1 AND r.branch_id = $2
                  AND r.run_date BETWEEN $3 AND $4 AND r.status <> 'CANCELLED'
                  ${limited ? `AND (${IN_TEAM('$5::uuid[]')}
                       OR r.checklist_id IN (SELECT id FROM ckl.checklists WHERE created_by_user_id = $6::uuid))` : ''}`;
  const [{ rows: [t] }, { rows: people }, { rows: missedTop }] = await Promise.all([
    pool.query(`SELECT ${COUNTS} ${base}`, params),
    pool.query(
      `SELECT r.assignee_employee_id AS employee_id, max(r.assignee_name) AS name, ${COUNTS}
         ${base} GROUP BY r.assignee_employee_id ORDER BY max(r.assignee_name)`,
      params,
    ),
    pool.query(
      `SELECT r.checklist_id, max(r.title) AS name,
              count(*) FILTER (WHERE r.status = 'MISSED') AS missed,
              count(*) FILTER (WHERE r.status IN ('TODO','IN_PROGRESS') AND r.due_at < now()) AS overdue_open
         ${base} GROUP BY r.checklist_id
        HAVING count(*) FILTER (WHERE r.status = 'MISSED' OR (r.status IN ('TODO','IN_PROGRESS') AND r.due_at < now())) > 0
        ORDER BY 3 DESC, 4 DESC LIMIT 5`,
      params,
    ),
  ]);
  return {
    from, to, ...t,
    completion_pct: pct(t.completed, t.due),
    on_time_pct: pct(t.on_time, t.completed),
    employees: people.map((p) => ({ ...p, completion_pct: pct(p.completed, p.due), on_time_pct: pct(p.on_time, p.completed) })),
    top_missed_checklists: missedTop,
  };
}

module.exports = { my, team };
