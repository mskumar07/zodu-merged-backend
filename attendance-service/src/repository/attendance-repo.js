const db = require('../database/connection');

// ── MARK / UPSERT ─────────────────────────────────────────────────────────────
// One row per employee per date — re-marking the same date overwrites it.

exports.upsertAttendance = async (client, d) => {
  const { rows } = await client.query(
    `INSERT INTO tbl_attendance (
       zodu_id, branch_id, employee_id, attendance_date, status,
       check_in_time, check_out_time, remarks, marked_by, marked_by_name
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (employee_id, attendance_date) DO UPDATE SET
       status         = EXCLUDED.status,
       check_in_time  = EXCLUDED.check_in_time,
       check_out_time = EXCLUDED.check_out_time,
       remarks        = EXCLUDED.remarks,
       marked_by      = EXCLUDED.marked_by,
       marked_by_name = EXCLUDED.marked_by_name,
       updated_at     = NOW()
     RETURNING *`,
    [
      d.zodu_id, d.branch_id, d.employee_id, d.attendance_date, d.status,
      d.check_in_time || null, d.check_out_time || null,
      d.remarks || null, d.marked_by, d.marked_by_name,
    ]
  );
  return rows[0];
};

// ── ONE EMPLOYEE'S DAY  (save from the "Edit Attendance" dialog) ───────────────
// $4 is the day, `a` the saved attendance row, `e` the employee. Times come back as the
// form's own "HH:mm" (IST); the service adds the hours text.

const EMPLOYEE_DAY_COLUMNS = `
  e.employee_id, e.employee_code, e.name AS employee_name,
  TO_CHAR($4::date, 'DD Mon YYYY') AS attendance_date,
  TO_CHAR($4::date, 'Dy') AS day,
  a.status,
  TO_CHAR(a.check_in_time  AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS check_in_time,
  TO_CHAR(a.check_out_time AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS check_out_time,
  CASE WHEN a.check_out_time > a.check_in_time THEN ROUND(EXTRACT(EPOCH FROM (a.check_out_time - a.check_in_time)) / 60)::int END AS working_minutes,
  a.remarks`;

/**
 * Save the day, in one statement. The row is built from the employee's own record
 * (INSERT ... SELECT), so an employee outside this company / branch saves nothing and
 * the result is null. The IST times are built on the database from the day + "HH:mm".
 */
exports.saveEmployeeDay = async (d) => {
  const { rows } = await db.query(
    `WITH saved AS (
       INSERT INTO tbl_attendance (
         zodu_id, branch_id, employee_id, attendance_date, status,
         check_in_time, check_out_time, remarks, marked_by, marked_by_name
       )
       SELECT e.zodu_id, e.branch_id, e.employee_id, $4::date, $5,
              ($4::date + $6::time) AT TIME ZONE 'Asia/Kolkata',
              ($4::date + $7::time) AT TIME ZONE 'Asia/Kolkata',
              $8, $9, $10
       FROM tbl_employees e
       WHERE e.employee_id = $3 AND e.zodu_id = $1 AND e.branch_id = $2
       ON CONFLICT (employee_id, attendance_date) DO UPDATE SET
         status         = EXCLUDED.status,
         check_in_time  = EXCLUDED.check_in_time,
         check_out_time = EXCLUDED.check_out_time,
         remarks        = EXCLUDED.remarks,
         marked_by      = EXCLUDED.marked_by,
         marked_by_name = EXCLUDED.marked_by_name,
         updated_at     = NOW()
       RETURNING employee_id, status, check_in_time, check_out_time, remarks
     )
     SELECT ${EMPLOYEE_DAY_COLUMNS}
     FROM saved a
     JOIN tbl_employees e ON e.employee_id = a.employee_id`,
    [d.zodu_id, d.branch_id, d.employee_id, d.attendance_date, d.status,
     d.check_in_time, d.check_out_time, d.remarks, d.marked_by, d.marked_by_name]
  );
  return rows[0] || null;
};

// ── EMPLOYEES FOR MARK ATTENDANCE MODAL  (per zodu_id/branch_id/date) ─────────
// One row per active employee, left-joined to that date's attendance row (if any)
// so the modal can prefill check-in/check-out/status when re-opened for a date
// that was already marked.

exports.findEmployeesForMarking = async ({ zodu_id, branch_id, attendance_date, limit, offset }) => {
  const { rows } = await db.query(
    `SELECT
       e.employee_id,
       e.employee_code,
       e.name AS employee_name,
       TO_CHAR(a.check_in_time  AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS') AS check_in_time,
       TO_CHAR(a.check_out_time AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS') AS check_out_time,
       a.status,
       COUNT(*) OVER()::int AS total
     FROM tbl_employees e
     LEFT JOIN tbl_attendance a
       ON a.employee_id = e.employee_id AND a.attendance_date = $3::date
     WHERE e.zodu_id = $1 AND e.branch_id = $2 AND e.status = 'active' and e.name != 'Admin'
     ORDER BY e.name
     LIMIT $4 OFFSET $5`,
    [zodu_id, branch_id, attendance_date, limit, offset]
  );
  return rows;
};

// ── TEAM: shared pieces ───────────────────────────────────────────────────────
// The team is the branch's active employees, minus the caller (their own data is /my).
// $3 is the caller's employee_id, or null when the caller has no employee record.

const TEAM_BASE = `e.zodu_id = $1 AND e.branch_id = $2 AND e.status = 'active'
       AND ($3::uuid IS NULL OR e.employee_id <> $3::uuid)`;

const likeOf = (search) => (search ? `%${search.replace(/[\\%_]/g, '\\$&')}%` : null);

// ── TEAM ATTENDANCE · MONTH  ("Attendance – Month View") ──────────────────────
// Two queries, run together:
//  · page    — one page of employees (search + order + limit first), then each one's
//              counts and day map computed only for those rows. The month's rows are
//              never aggregated for employees that aren't shown.
//  · summary — branch-wide totals in one aggregate pass, independent of search and
//              page, so the summary cards stay put while the list is filtered.

exports.findTeamAttendance = async ({ zodu_id, branch_id, employee_id, month, year, search, limit, offset }) => {
  const [page, summary] = await Promise.all([
    db.query(
      `WITH page AS (
         SELECT e.employee_id, e.employee_code, e.name AS employee_name,
                e.reporting_manager_name AS designation,
                COUNT(*) OVER()::int AS filtered_total
         FROM tbl_employees e
         WHERE ${TEAM_BASE}
           AND ($6::text IS NULL OR e.name ILIKE $6 OR e.employee_code ILIKE $6)
         ORDER BY e.name, e.employee_id
         LIMIT $7 OFFSET $8
       )
       SELECT p.*, x.present_days, x.absent_days, x.leave_days, x.weekly_off_days, x.days
       FROM page p
       CROSS JOIN LATERAL (
         SELECT
           COUNT(*) FILTER (WHERE a.status = 'Present')::int    AS present_days,
           COUNT(*) FILTER (WHERE a.status = 'Absent')::int     AS absent_days,
           COUNT(*) FILTER (WHERE a.status = 'On Leave')::int   AS leave_days,
           COUNT(*) FILTER (WHERE a.status = 'Weekly Off')::int AS weekly_off_days,
           COALESCE(
             jsonb_object_agg(
               TO_CHAR(a.attendance_date, 'YYYY-MM-DD'),
               jsonb_build_object(
                 'status', a.status,
                 'check_in_time',  TO_CHAR(a.check_in_time  AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM'),
                 'check_out_time', TO_CHAR(a.check_out_time AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM')
               )
             ),
             '{}'::jsonb
           ) AS days
         FROM tbl_attendance a
         WHERE a.employee_id = p.employee_id
           AND a.attendance_date >= MAKE_DATE($4::int, $5::int, 1)
           AND a.attendance_date <  MAKE_DATE($4::int, $5::int, 1) + INTERVAL '1 month'
       ) x
       ORDER BY p.employee_name, p.employee_id`,
      [zodu_id, branch_id, employee_id, year, month, likeOf(search), limit, offset]
    ),
    db.query(
      `SELECT
         (SELECT COUNT(*)::int FROM tbl_employees e WHERE ${TEAM_BASE}) AS total_employees,
         COUNT(*) FILTER (WHERE a.status = 'Present')::int    AS total_present_days,
         COUNT(*) FILTER (WHERE a.status = 'Absent')::int     AS total_absent_days,
         COUNT(*) FILTER (WHERE a.status = 'On Leave')::int   AS total_leave_days,
         COUNT(*) FILTER (WHERE a.status = 'Weekly Off')::int AS total_weekly_off_days
       FROM tbl_attendance a
       JOIN tbl_employees e ON e.employee_id = a.employee_id
       WHERE ${TEAM_BASE}
         AND a.attendance_date >= MAKE_DATE($4::int, $5::int, 1)
         AND a.attendance_date <  MAKE_DATE($4::int, $5::int, 1) + INTERVAL '1 month'`,
      [zodu_id, branch_id, employee_id, year, month]
    ),
  ]);
  return { rows: page.rows, summary: summary.rows[0] };
};

// ── TEAM ATTENDANCE · DAY  ("Mark Attendance" daily list) ─────────────────────
// Same shape of work: the summary is one aggregate over the day's rows; the list is
// one page of employees LEFT JOINed to that day's attendance row.

exports.findTeamDay = async ({ zodu_id, branch_id, employee_id, attendance_date, search, status, limit, offset }) => {
  const [page, summary] = await Promise.all([
    db.query(
      `SELECT
         e.employee_id, e.employee_code, e.name AS employee_name,
         a.status,
         TO_CHAR(a.check_in_time  AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM') AS check_in_time,
         TO_CHAR(a.check_out_time AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM') AS check_out_time,
         CASE WHEN a.check_out_time > a.check_in_time THEN ROUND(EXTRACT(EPOCH FROM (a.check_out_time - a.check_in_time)) / 60)::int END AS working_minutes,
         a.remarks,
         COUNT(*) OVER()::int AS filtered_total
       FROM tbl_employees e
       LEFT JOIN tbl_attendance a
         ON a.employee_id = e.employee_id AND a.attendance_date = $4::date
       WHERE ${TEAM_BASE}
         AND ($5::text IS NULL OR e.name ILIKE $5 OR e.employee_code ILIKE $5)
         AND ($6::text IS NULL OR ($6 = 'none' AND a.status IS NULL) OR a.status = $6)
       ORDER BY e.name, e.employee_id
       LIMIT $7 OFFSET $8`,
      [zodu_id, branch_id, employee_id, attendance_date, likeOf(search), status || null, limit, offset]
    ),
    db.query(
      `SELECT
         COUNT(*)::int                                          AS total_employees,
         COUNT(*) FILTER (WHERE a.status = 'Present')::int      AS present,
         COUNT(*) FILTER (WHERE a.status = 'Absent')::int       AS absent,
         COUNT(*) FILTER (WHERE a.status = 'On Leave')::int     AS on_leave,
         COUNT(*) FILTER (WHERE a.status = 'Weekly Off')::int   AS weekly_off
       FROM tbl_employees e
       LEFT JOIN tbl_attendance a
         ON a.employee_id = e.employee_id AND a.attendance_date = $4::date
       WHERE ${TEAM_BASE}`,
      [zodu_id, branch_id, employee_id, attendance_date]
    ),
  ]);
  return { rows: page.rows, summary: summary.rows[0] };
};

// ── MY ATTENDANCE  (single employee, daily list — "My Attendance — July 2026") ─

// One day, ready to show: "16 Nov 2026", "Mon", "02:06 PM" (IST, null until punched) and
// the whole minutes between check-in and check-out (the service turns it into "8h 57m").
const DAY_COLUMNS = `
  TO_CHAR(attendance_date, 'DD Mon YYYY') AS attendance_date,
  TO_CHAR(attendance_date, 'Dy') AS day,
  status,
  TO_CHAR(check_in_time  AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM') AS check_in_time,
  TO_CHAR(check_out_time AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM') AS check_out_time,
  CASE WHEN check_out_time > check_in_time THEN ROUND(EXTRACT(EPOCH FROM (check_out_time - check_in_time)) / 60)::int END AS working_minutes,
  remarks`;

exports.findMyAttendance = async ({ employee_id, zodu_id, branch_id, month, year }) => {
  const { rows } = await db.query(
    `SELECT ${DAY_COLUMNS}
     FROM tbl_attendance
     WHERE employee_id = $1 AND zodu_id = $2 AND branch_id = $3
       AND attendance_date >= MAKE_DATE($4::int, $5::int, 1)
       AND attendance_date <  MAKE_DATE($4::int, $5::int, 1) + INTERVAL '1 month'
     ORDER BY attendance_date`,
    [employee_id, zodu_id, branch_id, year, month]
  );
  return rows;
};

// ── SELF CHECK-IN / CHECK-OUT ────────────────────────────────────────────────
// Both take their time from the database clock (never from the client) and
// their calendar day from IST, so a wrong device clock or time zone can't
// back-date a punch. Each is one atomic statement: two taps, or two devices,
// can't both win.

const IST_TODAY = `(NOW() AT TIME ZONE 'Asia/Kolkata')::date`;
const PUNCH_COLUMNS = DAY_COLUMNS;

/** Today's check-in. Returns the row, or null if the employee already checked in today. */
exports.checkIn = async ({ zodu_id, branch_id, employee_id, employee_name }) => {
  const { rows } = await db.query(
    `INSERT INTO tbl_attendance (
       zodu_id, branch_id, employee_id, attendance_date, status,
       check_in_time, marked_by, marked_by_name
     ) VALUES ($1, $2, $3, ${IST_TODAY}, 'Present', NOW(), $3, $4)
     ON CONFLICT (employee_id, attendance_date) DO UPDATE SET
       status         = 'Present',
       check_in_time  = NOW(),
       check_out_time = NULL,
       marked_by      = EXCLUDED.marked_by,
       marked_by_name = EXCLUDED.marked_by_name,
       updated_at     = NOW()
     WHERE tbl_attendance.check_in_time IS NULL
     RETURNING ${PUNCH_COLUMNS}`,
    [zodu_id, branch_id, employee_id, employee_name]
  );
  return rows[0] || null;
};

/** Today's check-out. Returns the row, or null if there is no open check-in to close. */
exports.checkOut = async ({ employee_id }) => {
  const { rows } = await db.query(
    `UPDATE tbl_attendance
        SET check_out_time = NOW(), updated_at = NOW()
      WHERE employee_id = $1 AND attendance_date = ${IST_TODAY}
        AND status = 'Present' AND check_in_time IS NOT NULL AND check_out_time IS NULL
      RETURNING ${PUNCH_COLUMNS}`,
    [employee_id]
  );
  return rows[0] || null;
};

/** Today's row, to explain why a punch was refused. */
exports.findToday = async ({ employee_id }) => {
  const { rows } = await db.query(
    `SELECT ${PUNCH_COLUMNS} FROM tbl_attendance
      WHERE employee_id = $1 AND attendance_date = ${IST_TODAY}`,
    [employee_id]
  );
  return rows[0] || null;
};
