const db = require('../database/connection');
const { likeOf, EMPLOYEES_CTE } = require('../utils/sql');
const { rosterJson } = require('../clients/employee-directory');

// Employee dashboard queries. Each one is a single index range scan: tbl_attendance on its
// (employee_id, attendance_date) unique key, tbl_holidays on (zodu_id, branch_id, holiday_date).
// Dates and times are formatted by the database so the service only counts and the screen only shows.

/** The employee's attendance rows in [from, to), one per day. Covers the week and the calendar month in one scan. */
exports.findDays = async ({ zodu_id, branch_id, employee_id, from, to }) => {
  const { rows } = await db.query(
    `SELECT TO_CHAR(attendance_date, 'YYYY-MM-DD') AS date,
            status,
            TO_CHAR(check_in_time  AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM') AS check_in_time,
            TO_CHAR(check_out_time AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM') AS check_out_time,
            CASE WHEN check_out_time > check_in_time
                 THEN ROUND(EXTRACT(EPOCH FROM (check_out_time - check_in_time)) / 60)::int END AS working_minutes
     FROM tbl_attendance
     WHERE employee_id = $1 AND zodu_id = $2 AND branch_id = $3
       AND attendance_date >= $4::date AND attendance_date < $5::date`,
    [employee_id, zodu_id, branch_id, from, to]
  );
  return rows;
};

// ── Manager / Admin dashboard ────────────────────────────────────────────────
// ONE statement, ONE round trip, ONE pooled connection per request (the pool holds 20, so a
// dashboard that took four connections would starve under load). Everything is built from two
// small materialised sets, read once and shared by every section:
//   team  the branch's active employees minus the caller (the same team as /team and /team/daily)
//   att   the team's attendance rows for the trend range (one index range scan)
// Counting is done by the database; paging touches only one page of employees.
//
// $1 zodu  $2 branch  $3 caller user_id
// $4 week from  $5 week to (exclusive)      the week: the cards, the donut and the log
// $6 trend from  $7 trend to (exclusive)    the trend chart: the same week, or the month (Weekly / Monthly)
// $8 search  $9 caller is the company Admin  $10 page size  $11 offset  $12 pending requests to list
// $13 today (IST): counts stop there, so a leave approved ahead (written for a coming day) isn't counted yet
// $14 the branch roster from employee-service (JSON): its CTE is named tbl_employees, so the rest reads as before
const TEAM_DASHBOARD_SQL = `
WITH ${EMPLOYEES_CTE(14)},
caller AS (
  SELECT employee_id FROM tbl_employees
  WHERE user_id = $3 AND zodu_id = $1 AND branch_id = $2
  LIMIT 1
),
team AS MATERIALIZED (
  SELECT e.employee_id, e.employee_code, e.name
  FROM tbl_employees e
  WHERE e.zodu_id = $1 AND e.branch_id = $2 AND e.status = 'active'
    AND NOT EXISTS (SELECT 1 FROM caller c WHERE c.employee_id = e.employee_id)
),
-- one index range scan covering the week and the trend range (a month may not contain the whole week)
att AS MATERIALIZED (
  SELECT a.attendance_date, a.employee_id, a.status
  FROM tbl_attendance a
  JOIN team t ON t.employee_id = a.employee_id
  WHERE a.zodu_id = $1 AND a.branch_id = $2
    AND a.attendance_date >= LEAST($4::date, $6::date)
    AND a.attendance_date <  GREATEST($5::date, $7::date)
    AND a.attendance_date <= $13::date
),
wk AS MATERIALIZED (
  SELECT attendance_date, employee_id, status FROM att
  WHERE attendance_date >= $4::date AND attendance_date < $5::date
),
pending AS MATERIALIZED (
  SELECT lr.leave_request_id, e.employee_id, e.employee_code, e.name AS employee_name,
         lt.code AS leave_type_code, lt.name AS leave_type_name,
         lr.from_date, lr.to_date, lr.days::float8 AS days, lr.reason, lr.applied_at
  FROM tbl_leave_requests lr
  JOIN tbl_employees e    ON e.employee_id = lr.employee_id
  JOIN tbl_leave_types lt ON lt.leave_type_id = lr.leave_type_id
  WHERE lr.zodu_id = $1 AND lr.branch_id = $2 AND lr.status = 'Pending'
    AND NOT EXISTS (SELECT 1 FROM caller c WHERE c.employee_id = lr.employee_id)
    AND ($9::boolean OR e.reporting_manager_id = (SELECT employee_id FROM caller))
)
SELECT
  (SELECT COUNT(*)::int FROM team) AS total_employees,

  -- the week (up to today): person-days by status
  (SELECT jsonb_build_object(
            'present',    COUNT(*) FILTER (WHERE status = 'Present'),
            'absent',     COUNT(*) FILTER (WHERE status = 'Absent'),
            'on_leave',   COUNT(*) FILTER (WHERE status = 'On Leave'),
            'weekly_off', COUNT(*) FILTER (WHERE status = 'Weekly Off'))
     FROM wk) AS range_counts,

  -- the trend: one row per day of the trend range that has attendance
  (SELECT COALESCE(jsonb_agg(jsonb_build_object('date', d, 'present', p, 'absent', ab, 'on_leave', l) ORDER BY d), '[]'::jsonb)
     FROM (SELECT TO_CHAR(attendance_date, 'YYYY-MM-DD') AS d,
                  COUNT(*) FILTER (WHERE status = 'Present')  AS p,
                  COUNT(*) FILTER (WHERE status = 'Absent')   AS ab,
                  COUNT(*) FILTER (WHERE status = 'On Leave') AS l
           FROM att
           WHERE attendance_date >= $6::date AND attendance_date < $7::date
           GROUP BY attendance_date) x) AS trend,

  -- the employees' log for the week: one row per employee per marked day, newest day first.
  -- Only the sort keys come from the index-only scan; punch times are read for the page's rows alone.
  (CASE WHEN $8::text IS NULL THEN (SELECT COUNT(*)::int FROM wk)
        ELSE (SELECT COUNT(*)::int FROM wk a JOIN team t ON t.employee_id = a.employee_id
               WHERE t.name ILIKE $8 OR t.employee_code ILIKE $8) END) AS log_total,
  (SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.no), '[]'::jsonb)
     FROM (SELECT ($11::int + ROW_NUMBER() OVER (ORDER BY pg.attendance_date DESC, pg.name, pg.employee_id))::int AS no,
                  pg.employee_id, pg.employee_code, pg.name AS employee_name,
                  TO_CHAR(pg.attendance_date, 'YYYY-MM-DD') AS attendance_date,
                  pg.status,
                  TO_CHAR(x.check_in_time  AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM') AS check_in_time,
                  TO_CHAR(x.check_out_time AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM') AS check_out_time,
                  CASE WHEN x.check_out_time > x.check_in_time
                       THEN ROUND(EXTRACT(EPOCH FROM (x.check_out_time - x.check_in_time)) / 60)::int END AS working_minutes
           FROM (SELECT a.attendance_date, a.status, t.employee_id, t.employee_code, t.name
                 FROM wk a
                 JOIN team t ON t.employee_id = a.employee_id
                 WHERE $8::text IS NULL OR t.name ILIKE $8 OR t.employee_code ILIKE $8
                 ORDER BY a.attendance_date DESC, t.name, t.employee_id
                 LIMIT $10 OFFSET $11) pg
           LEFT JOIN LATERAL (
             SELECT k.check_in_time, k.check_out_time
             FROM tbl_attendance k
             WHERE k.employee_id = pg.employee_id AND k.attendance_date = pg.attendance_date
           ) x ON TRUE) p) AS log,

  -- leave requests waiting for the caller: the count, and the soonest few
  (SELECT COUNT(*)::int FROM pending) AS pending_total,
  (SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.sort_from, q.sort_applied, q.leave_request_id), '[]'::jsonb)
     FROM (SELECT leave_request_id, employee_id, employee_code, employee_name, leave_type_code, leave_type_name,
                  days, reason, from_date AS sort_from, applied_at AS sort_applied,
                  TO_CHAR(from_date, 'YYYY-MM-DD') AS from_date,
                  TO_CHAR(to_date,   'YYYY-MM-DD') AS to_date,
                  CASE WHEN from_date = to_date THEN TO_CHAR(from_date, 'DD Mon YYYY')
                       ELSE TO_CHAR(from_date, 'DD Mon') || ' – ' || TO_CHAR(to_date, 'DD Mon YYYY') END AS period
           FROM pending
           ORDER BY from_date, applied_at, leave_request_id
           LIMIT $12) q) AS pending`;

exports.findTeamDashboard = async (p) => {
  const roster = await rosterJson(p);
  const { rows } = await db.query(TEAM_DASHBOARD_SQL, [
    p.zodu_id, p.branch_id, p.user_id,
    p.week_from, p.week_to, p.trend_from, p.trend_to,
    likeOf(p.search), p.is_owner, p.limit, p.offset, p.pending_limit, p.today, roster,
  ]);
  return rows[0];
};

/** The next holidays of the branch from `from` (inclusive), soonest first. */
exports.findUpcomingHolidays = async ({ zodu_id, branch_id, from, limit }) => {
  const { rows } = await db.query(
    `SELECT holiday_id,
            TO_CHAR(holiday_date, 'YYYY-MM-DD')      AS date,
            UPPER(TO_CHAR(holiday_date, 'Mon'))      AS month,
            EXTRACT(DAY FROM holiday_date)::int      AS day,
            TO_CHAR(holiday_date, 'Dy')              AS weekday,
            name,
            holiday_type                             AS type
     FROM tbl_holidays
     WHERE zodu_id = $1 AND branch_id = $2 AND holiday_date >= $3::date
     ORDER BY holiday_date
     LIMIT $4`,
    [zodu_id, branch_id, from, limit]
  );
  return rows;
};
