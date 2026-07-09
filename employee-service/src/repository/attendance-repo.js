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

// ── TEAM ATTENDANCE  (grid + summary in one query — "Team Attendance — July 2026") ──
// Aggregates per-employee days into JSON server-side (jsonb_object_agg), so Postgres
// returns one row per employee instead of one row per (employee, date). Cuts row
// count ~30x for a 30-day month and avoids re-grouping the result set in Node.
// Team-wide averages are computed in the same pass via a window function, so this
// single round trip replaces what used to be two separate queries.

exports.findTeamAttendance = async ({ zodu_id, branch_id, employee_id, month, year }) => {
  const { rows } = await db.query(
    `WITH per_employee AS (
       SELECT
         e.employee_id, e.employee_code, e.name AS employee_name,
         e.reporting_manager_name AS designation,
         COUNT(*) FILTER (WHERE a.status = 'Present') AS present_days,
         COUNT(*) FILTER (WHERE a.status = 'Absent')  AS absent_days,
         100.0 * COUNT(*) FILTER (WHERE a.status = 'Present')
           / NULLIF(COUNT(*) FILTER (WHERE a.status IN ('Present','Absent')), 0) AS attendance_pct,
         100.0 * COUNT(*) FILTER (WHERE a.status = 'Absent')
           / NULLIF(COUNT(*) FILTER (WHERE a.status IN ('Present','Absent')), 0) AS absent_pct,
         COALESCE(
           jsonb_object_agg(
             TO_CHAR(a.attendance_date, 'YYYY-MM-DD'),
             jsonb_build_object(
               'status', a.status,
               'check_in_time',  TO_CHAR(a.check_in_time  AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS'),
               'check_out_time', TO_CHAR(a.check_out_time AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS')
             )
           ) FILTER (WHERE a.attendance_date IS NOT NULL),
           '{}'::jsonb
         ) AS days
       FROM tbl_employees e
       LEFT JOIN tbl_attendance a
         ON a.employee_id = e.employee_id
        AND a.attendance_date >= MAKE_DATE($4::int, $5::int, 1)
        AND a.attendance_date <  MAKE_DATE($4::int, $5::int, 1) + INTERVAL '1 month'
       WHERE e.zodu_id = $1 AND e.branch_id = $2 AND e.employee_id <> $3 AND e.status = 'active'
       GROUP BY e.employee_id, e.employee_code, e.name, e.reporting_manager_name
     )
     SELECT
       employee_id, employee_code, employee_name, designation, days,
       present_days::int AS present_days, absent_days::int AS absent_days,
       ROUND(AVG(present_days)    OVER ())::numeric(10,1) AS avg_present_days,
       ROUND(AVG(attendance_pct)  OVER (), 1) AS avg_attendance_pct,
       ROUND(AVG(absent_pct)      OVER (), 1) AS avg_absent_pct
     FROM per_employee
     ORDER BY employee_name`,
    [zodu_id, branch_id, employee_id, year, month]
  );
  return rows;
};

// ── MY ATTENDANCE  (single employee, daily list — "My Attendance — July 2026") ─

exports.findMyAttendance = async ({ employee_id, zodu_id, branch_id, month, year }) => {
  const { rows } = await db.query(
    `SELECT
       TO_CHAR(attendance_date, 'YYYY-MM-DD') AS attendance_date,
       status,
       TO_CHAR(check_in_time  AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS') AS check_in_time,
       TO_CHAR(check_out_time AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS') AS check_out_time,
       remarks
     FROM tbl_attendance
     WHERE employee_id = $1 AND zodu_id = $2 AND branch_id = $3
       AND attendance_date >= MAKE_DATE($4::int, $5::int, 1)
       AND attendance_date <  MAKE_DATE($4::int, $5::int, 1) + INTERVAL '1 month'
     ORDER BY attendance_date`,
    [employee_id, zodu_id, branch_id, year, month]
  );
  return rows;
};

// ── MY SUMMARY CARDS  (Present Days / Absent Days / Attendance %) ─────────────

exports.findMySummary = async ({ employee_id, zodu_id, branch_id, month, year }) => {
  const { rows } = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'Present') AS present_days,
       COUNT(*) FILTER (WHERE status = 'Absent')  AS absent_days,
       ROUND(
         100.0 * COUNT(*) FILTER (WHERE status = 'Present')
         / NULLIF(COUNT(*) FILTER (WHERE status IN ('Present','Absent')), 0)
       )::int AS attendance_pct
     FROM tbl_attendance
     WHERE employee_id = $1 AND zodu_id = $2 AND branch_id = $3
       AND attendance_date >= MAKE_DATE($4::int, $5::int, 1)
       AND attendance_date <  MAKE_DATE($4::int, $5::int, 1) + INTERVAL '1 month'`,
    [employee_id, zodu_id, branch_id, year, month]
  );
  return rows[0];
};
