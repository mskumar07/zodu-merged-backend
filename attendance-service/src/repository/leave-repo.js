const db = require('../database/connection');
const { likeOf, EMPLOYEES_CTE } = require('../utils/sql');
const { rosterJson } = require('../clients/employee-directory');
const { ensureDefaults } = require('./leave-type-repo');

// Employees come from employee-service: queries that read them start with `WITH ${EMPLOYEES_CTE(n)}`, a CTE named
// tbl_employees built from the branch roster passed as parameter $n.

// Leave queries. Every list is scoped by (zodu_id, branch_id) first, which is what the indexes lead
// with; dates, times and the period text are formatted here, by the database, so the screens only show them.

// Sunday is the weekly off. A leave counts the days in its range that are neither a Sunday nor a holiday.
const WORKING_DAYS = (from, to, zodu, branch) => `(
  SELECT COUNT(*)
  FROM generate_series(${from}::date::timestamp, ${to}::date::timestamp, interval '1 day') AS d(day)
  WHERE EXTRACT(DOW FROM d.day) <> 0
    AND NOT EXISTS (
      SELECT 1 FROM tbl_holidays h
      WHERE h.zodu_id = ${zodu} AND h.branch_id = ${branch} AND h.holiday_date = d.day::date
    )
)`;

// "22 Dec – 23 Dec 2026", or "04 Dec 2026" for one day.
const PERIOD = `CASE WHEN lr.from_date = lr.to_date
  THEN TO_CHAR(lr.from_date, 'DD Mon YYYY')
  ELSE TO_CHAR(lr.from_date, 'DD Mon') || ' – ' || TO_CHAR(lr.to_date, 'DD Mon YYYY') END`;

// One request, ready to show.
const REQUEST_COLUMNS = `
  lr.leave_request_id,
  lt.code AS leave_type_code, lt.name AS leave_type_name,
  TO_CHAR(lr.from_date, 'YYYY-MM-DD') AS from_date,
  TO_CHAR(lr.to_date,   'YYYY-MM-DD') AS to_date,
  ${PERIOD} AS period,
  lr.days::float8 AS days,
  lr.status, lr.reason, lr.decision_note,
  TO_CHAR(lr.applied_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM') AS applied_on,
  (lr.status = 'Pending') AS can_cancel`;

const EMPLOYEE_COLUMNS = `e.employee_id, e.employee_code, e.name AS employee_name`;

// ── Balances ─────────────────────────────────────────────────────────────────
// entitlement - approved - pending, added up from the requests (there is no stored balance).

exports.findBalances = async ({ zodu_id, branch_id, employee_id, year }) => {
  await ensureDefaults({ zodu_id, branch_id });
  const { rows } = await db.query(
    `SELECT lt.leave_type_id, lt.code, lt.name,
            lt.annual_days::float8 AS entitlement,
            COALESCE(SUM(lr.days) FILTER (WHERE lr.status = 'Approved'), 0)::float8 AS availed,
            COALESCE(SUM(lr.days) FILTER (WHERE lr.status = 'Pending'),  0)::float8 AS pending
     FROM tbl_leave_types lt
     LEFT JOIN tbl_leave_requests lr
       ON lr.leave_type_id = lt.leave_type_id AND lr.employee_id = $3
      AND lr.from_date >= make_date($4::int, 1, 1) AND lr.from_date < make_date($4::int + 1, 1, 1)
     WHERE lt.zodu_id = $1 AND lt.branch_id = $2 AND lt.is_active
     GROUP BY lt.leave_type_id
     ORDER BY lt.sort_order, lt.code`,
    [zodu_id, branch_id, employee_id, year]
  );
  return rows;
};

// ── Holidays ─────────────────────────────────────────────────────────────────

/** Holidays from `from` (inclusive) up to `to` (exclusive), soonest first. */
exports.findHolidays = async ({ zodu_id, branch_id, from, to, limit }) => {
  const { rows } = await db.query(
    `SELECT holiday_id,
            TO_CHAR(holiday_date, 'YYYY-MM-DD')          AS holiday_date,
            TO_CHAR(holiday_date, 'DD Mon YYYY (Dy)')    AS date,
            name, holiday_type AS type
     FROM tbl_holidays
     WHERE zodu_id = $1 AND branch_id = $2 AND holiday_date >= $3::date AND holiday_date < $4::date
     ORDER BY holiday_date
     LIMIT $5`,
    [zodu_id, branch_id, from, to, limit]
  );
  return rows;
};

/** Add or update many holidays in one statement. Returns how many were new and how many updated. */
exports.upsertHolidays = async ({ zodu_id, branch_id, created_by, rows }) => {
  const { rows: out } = await db.query(
    `INSERT INTO tbl_holidays (zodu_id, branch_id, holiday_date, name, holiday_type, created_by)
     SELECT $1, $2, u.d, u.n, u.t, $6
     FROM unnest($3::date[], $4::text[], $5::text[]) AS u(d, n, t)
     ON CONFLICT (zodu_id, branch_id, holiday_date) DO UPDATE
       SET name = EXCLUDED.name, holiday_type = EXCLUDED.holiday_type, updated_at = NOW()
     RETURNING (xmax = 0) AS inserted`,
    [zodu_id, branch_id, rows.map((r) => r.date), rows.map((r) => r.name), rows.map((r) => r.type), created_by]
  );
  const inserted = out.filter((r) => r.inserted).length;
  return { inserted, updated: out.length - inserted };
};

// ── Own leaves ───────────────────────────────────────────────────────────────

/** The employee's requests for a year, latest applied first, one page. `total` is on every row. */
exports.listMyLeaves = async ({ employee_id, year, limit, offset }) => {
  const { rows } = await db.query(
    `SELECT ${REQUEST_COLUMNS}, COUNT(*) OVER()::int AS total
     FROM tbl_leave_requests lr
     JOIN tbl_leave_types lt ON lt.leave_type_id = lr.leave_type_id
     WHERE lr.employee_id = $1
       AND lr.from_date >= make_date($2::int, 1, 1) AND lr.from_date < make_date($2::int + 1, 1, 1)
     ORDER BY lr.applied_at DESC, lr.leave_request_id
     LIMIT $3 OFFSET $4`,
    [employee_id, year, limit, offset]
  );
  return rows;
};

/** How many days a range would count, and whether it runs into the employee's own live leave. */
exports.previewDays = async ({ zodu_id, branch_id, employee_id, from_date, to_date }) => {
  const { rows } = await db.query(
    `SELECT ${WORKING_DAYS('$4', '$5', '$1', '$2')}::float8 AS days,
            EXISTS (
              SELECT 1 FROM tbl_leave_requests lr
              WHERE lr.employee_id = $3 AND lr.status IN ('Pending', 'Approved')
                AND daterange(lr.from_date, lr.to_date, '[]') && daterange($4::date, $5::date, '[]')
            ) AS overlaps`,
    [zodu_id, branch_id, employee_id, from_date, to_date]
  );
  return rows[0];
};

/**
 * Save a request. Built from the employee's and the leave type's own rows (INSERT ... SELECT), so an
 * employee or type outside this branch saves nothing and the result is null. The day count is worked
 * out in the same statement. Overlapping live leave raises 23P01, no working day raises 23514.
 */
exports.insertRequest = async ({ zodu_id, branch_id, employee_id, leave_type_id, from_date, to_date, reason }) => {
  const roster = await rosterJson({ zodu_id, branch_id });
  const { rows } = await db.query(
    `WITH ${EMPLOYEES_CTE(8)}, ins AS (
       INSERT INTO tbl_leave_requests (zodu_id, branch_id, employee_id, leave_type_id, from_date, to_date, days, reason)
       SELECT e.zodu_id, e.branch_id, e.employee_id, lt.leave_type_id, $5::date, $6::date,
              ${WORKING_DAYS('$5', '$6', '$1', '$2')}, $7
       FROM tbl_employees e
       JOIN tbl_leave_types lt
         ON lt.leave_type_id = $4 AND lt.zodu_id = e.zodu_id AND lt.branch_id = e.branch_id AND lt.is_active
       WHERE e.employee_id = $3 AND e.zodu_id = $1 AND e.branch_id = $2 AND e.status = 'active'
       RETURNING *
     )
     SELECT ${REQUEST_COLUMNS}
     FROM ins lr JOIN tbl_leave_types lt ON lt.leave_type_id = lr.leave_type_id`,
    [zodu_id, branch_id, employee_id, leave_type_id, from_date, to_date, reason, roster]
  );
  return rows[0] || null;
};

/** Cancel the employee's own Pending request. Null if it isn't theirs or isn't Pending any more. */
exports.cancelOwnPending = async ({ leave_request_id, employee_id }) => {
  const { rows } = await db.query(
    `UPDATE tbl_leave_requests
        SET status = 'Cancelled', cancelled_at = NOW(), updated_at = NOW()
      WHERE leave_request_id = $1 AND employee_id = $2 AND status = 'Pending'
      RETURNING leave_request_id`,
    [leave_request_id, employee_id]
  );
  return rows[0] || null;
};

/** The request's owner and status, to say why a cancel was refused. */
exports.findOwnerAndStatus = async ({ leave_request_id, zodu_id, branch_id }) => {
  const { rows } = await db.query(
    `SELECT employee_id, status FROM tbl_leave_requests
      WHERE leave_request_id = $1 AND zodu_id = $2 AND branch_id = $3`,
    [leave_request_id, zodu_id, branch_id]
  );
  return rows[0] || null;
};

// ── Team (the caller's reports; the company Admin sees everyone) ─────────────
// $3 = the caller's employee_id (null when they have none), $4 = the caller is the company Admin.
// Never your own requests: those are decided by someone else, and live under "Myself".

const TEAM_SCOPE = `
  AND ($3::uuid IS NULL OR lr.employee_id <> $3::uuid)
  AND ($4::boolean OR e.reporting_manager_id = $3::uuid)`;

/** Pending requests waiting for the caller, soonest leave first. */
exports.listPending = async ({ zodu_id, branch_id, caller_id, is_owner, search, limit, offset }) => {
  const roster = await rosterJson({ zodu_id, branch_id });
  const { rows } = await db.query(
    `WITH ${EMPLOYEES_CTE(8)}
     SELECT ${REQUEST_COLUMNS}, ${EMPLOYEE_COLUMNS}, COUNT(*) OVER()::int AS total
     FROM tbl_leave_requests lr
     JOIN tbl_employees e    ON e.employee_id = lr.employee_id
     JOIN tbl_leave_types lt ON lt.leave_type_id = lr.leave_type_id
     WHERE lr.zodu_id = $1 AND lr.branch_id = $2 AND lr.status = 'Pending'
       ${TEAM_SCOPE}
       AND ($5::text IS NULL OR e.name ILIKE $5 OR e.employee_code ILIKE $5)
     ORDER BY lr.from_date, lr.applied_at, lr.leave_request_id
     LIMIT $6 OFFSET $7`,
    [zodu_id, branch_id, caller_id, is_owner, likeOf(search), limit, offset, roster]
  );
  return rows;
};

/** "All Leaves": the team's requests for a year, latest applied first. */
exports.listTeamLeaves = async ({ zodu_id, branch_id, caller_id, is_owner, year, search, leave_type, status, limit, offset }) => {
  const roster = await rosterJson({ zodu_id, branch_id });
  const { rows } = await db.query(
    `WITH ${EMPLOYEES_CTE(11)}
     SELECT ${REQUEST_COLUMNS}, ${EMPLOYEE_COLUMNS}, COUNT(*) OVER()::int AS total
     FROM tbl_leave_requests lr
     JOIN tbl_employees e    ON e.employee_id = lr.employee_id
     JOIN tbl_leave_types lt ON lt.leave_type_id = lr.leave_type_id
     WHERE lr.zodu_id = $1 AND lr.branch_id = $2
       AND lr.from_date >= make_date($5::int, 1, 1) AND lr.from_date < make_date($5::int + 1, 1, 1)
       ${TEAM_SCOPE}
       AND ($6::text IS NULL OR e.name ILIKE $6 OR e.employee_code ILIKE $6)
       AND ($7::text IS NULL OR lt.code = $7)
       AND ($8::text IS NULL OR lr.status = $8)
     ORDER BY lr.applied_at DESC, lr.leave_request_id
     LIMIT $9 OFFSET $10`,
    [zodu_id, branch_id, caller_id, is_owner, year, likeOf(search), leave_type || null, status || null, limit, offset, roster]
  );
  return rows;
};

// ── Decisions ────────────────────────────────────────────────────────────────

/**
 * Approve or reject, in one statement, only what the caller may: Pending requests of their own
 * reports (or anyone's, for the company Admin), never their own. The rows are locked first so two
 * managers deciding at once can't both win. Returns the rows that were changed.
 */
exports.decide = async (client, d) => {
  const roster = await rosterJson(d);
  const { rows } = await client.query(
    `WITH ${EMPLOYEES_CTE(10)}, target AS (
       SELECT lr.leave_request_id
       FROM tbl_leave_requests lr
       JOIN tbl_employees e ON e.employee_id = lr.employee_id
       WHERE lr.leave_request_id = ANY($1::uuid[]) AND lr.zodu_id = $2 AND lr.branch_id = $3
         AND lr.status = 'Pending'
         AND ($4::uuid IS NULL OR lr.employee_id <> $4::uuid)
         AND ($5::boolean OR e.reporting_manager_id = $4::uuid)
       FOR UPDATE OF lr
     )
     UPDATE tbl_leave_requests lr
        SET status = $6, decided_by = $7, decided_by_name = $8, decided_at = NOW(),
            decision_note = $9, updated_at = NOW()
       FROM target t
      WHERE lr.leave_request_id = t.leave_request_id
      RETURNING lr.leave_request_id`,
    [d.ids, d.zodu_id, d.branch_id, d.caller_id, d.is_owner, d.decision, d.decided_by, d.decided_by_name, d.note || null, roster]
  );
  return rows.map((r) => r.leave_request_id);
};

/**
 * Write the approved leaves into attendance: one 'On Leave' row per working day (no Sundays, no
 * holidays). A day the employee already worked (Present) stays Present; any other existing mark for
 * that day is replaced. The row remembers its leave (leave_request_id) so a cancel can undo exactly it.
 */
exports.writeLeaveAttendance = async (client, { ids, decided_by, decided_by_name }) => {
  const { rowCount } = await client.query(
    `INSERT INTO tbl_attendance (
       zodu_id, branch_id, employee_id, attendance_date, status, remarks,
       marked_by, marked_by_name, leave_request_id
     )
     SELECT lr.zodu_id, lr.branch_id, lr.employee_id, d.day::date, 'On Leave', lt.name,
            $2, $3, lr.leave_request_id
     FROM tbl_leave_requests lr
     JOIN tbl_leave_types lt ON lt.leave_type_id = lr.leave_type_id
     CROSS JOIN LATERAL generate_series(lr.from_date::timestamp, lr.to_date::timestamp, interval '1 day') AS d(day)
     WHERE lr.leave_request_id = ANY($1::uuid[])
       AND EXTRACT(DOW FROM d.day) <> 0
       AND NOT EXISTS (
         SELECT 1 FROM tbl_holidays h
         WHERE h.zodu_id = lr.zodu_id AND h.branch_id = lr.branch_id AND h.holiday_date = d.day::date
       )
     ON CONFLICT (employee_id, attendance_date) DO UPDATE SET
       status           = 'On Leave',
       check_in_time    = NULL,
       check_out_time   = NULL,
       leave_request_id = EXCLUDED.leave_request_id,
       marked_by        = EXCLUDED.marked_by,
       marked_by_name   = EXCLUDED.marked_by_name,
       updated_at       = NOW()
     WHERE tbl_attendance.status <> 'Present'`,
    [ids, decided_by, decided_by_name]
  );
  return rowCount;
};
