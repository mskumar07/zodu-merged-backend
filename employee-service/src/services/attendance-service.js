const db   = require('../database/connection');
const repo = require('../repository/attendance-repo');

// ── MARK ATTENDANCE  (bulk — one save covers all employees for a date) ────────
// Body: { zodu_id, branch_id, attendance_date, marked_by, marked_by_name,
//         records: [{ employee_id, status, check_in_time, check_out_time, remarks }] }

exports.markAttendance = async (data) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const results = [];
    for (const record of data.records) {
      const saved = await repo.upsertAttendance(client, {
        zodu_id:         data.zodu_id,
        branch_id:       data.branch_id,
        employee_id:     record.employee_id,
        attendance_date: data.attendance_date,
        status:          record.status,
        check_in_time:   record.check_in_time,
        check_out_time:  record.check_out_time,
        remarks:         record.remarks,
        marked_by:       data.marked_by,
        marked_by_name:  data.marked_by_name,
      });
      results.push(saved);
    }

    await client.query('COMMIT');
    return { success: true, data: results };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── EMPLOYEES FOR MARK ATTENDANCE MODAL  ──────────────────────────────────────

exports.getEmployeesForMarking = async ({ zodu_id, branch_id, attendance_date, page = 1, limit = 10 }) => {
  const parsedLimit  = Math.min(parseInt(limit, 10) || 10, 100);
  const parsedOffset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * parsedLimit;

  const rows  = await repo.findEmployeesForMarking({
    zodu_id, branch_id, attendance_date, limit: parsedLimit, offset: parsedOffset,
  });
  const total = rows[0]?.total || 0;

  return {
    success: true,
    data: rows,
    pagination: { total, page: +page, limit: parsedLimit, pages: Math.ceil(total / parsedLimit) },
  };
};

// ── TEAM ATTENDANCE  ("My Team Attendance" grid + summary cards) ──────────────

exports.getTeamAttendance = async ({ zodu_id, branch_id, employee_id, month, year }) => {
  const rows = await repo.findTeamAttendance({ zodu_id, branch_id, employee_id, month, year });

  // rows are already one-per-employee with `days` pre-aggregated by Postgres
  // (see findTeamAttendance) — no grouping/pivoting needed here.
  const summary = rows[0] || { avg_present_days: 0, avg_attendance_pct: 0, avg_absent_pct: 0 };

  return {
    success: true,
    data: {
      summary: {
        avg_present_days:   Number(summary.avg_present_days) || 0,
        avg_attendance_pct: Number(summary.avg_attendance_pct) || 0,
        avg_absent_pct:     Number(summary.avg_absent_pct) || 0,
      },
      employees: rows.map(r => ({
        employee_id:   r.employee_id,
        employee_code: r.employee_code,
        employee_name: r.employee_name,
        designation:   r.designation,
        days:          r.days,
        present_days:  r.present_days,
        absent_days:   r.absent_days,
      })),
    },
  };
};

// ── MY ATTENDANCE  ("My Attendance" personal daily view + summary cards) ──────

exports.getMyAttendance = async ({ employee_id, zodu_id, branch_id, month, year }) => {
  const [rows, summary] = await Promise.all([
    repo.findMyAttendance({ employee_id, zodu_id, branch_id, month, year }),
    repo.findMySummary({ employee_id, zodu_id, branch_id, month, year }),
  ]);

  return {
    success: true,
    data: {
      summary: {
        present_days:   Number(summary.present_days),
        absent_days:    Number(summary.absent_days),
        attendance_pct: Number(summary.attendance_pct) || 0,
      },
      days: rows.map(r => ({
        attendance_date: r.attendance_date,
        status:          r.status,
        check_in_time:   r.check_in_time,
        check_out_time:  r.check_out_time,
        remarks:         r.remarks,
      })),
    },
  };
};
