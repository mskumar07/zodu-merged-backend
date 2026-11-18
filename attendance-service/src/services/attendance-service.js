const db   = require('../database/connection');
const repo = require('../repository/attendance-repo');

// ── MARK ATTENDANCE  (bulk — one save covers all employees for a date) ────────
// Body: { zodu_id, branch_id, attendance_date, marked_by, marked_by_name,
//         records: [{ employee_id, status, check_in_time, check_out_time, remarks }] }

exports.markAttendance = async (data) => {
  if (data.attendance_date > istToday()) throw new AttendanceError(400, 'Attendance cannot be marked for a future date');
  for (const r of data.records) {
    if (r.check_in_time && r.check_out_time && Date.parse(r.check_out_time) <= Date.parse(r.check_in_time)) {
      throw new AttendanceError(400, 'Check-out must be after check-in');
    }
  }

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

// ── TEAM ATTENDANCE · MONTH  ("My Team Attendance" grid + summary cards) ─────

const pagination = (total, page, limit) => ({ total, page, limit, pages: Math.ceil(total / limit) });
// One decimal, no trailing ".0" noise left to the client: 11.3, 1.1, 3.
const avg = (sum, n) => (n ? Math.round((sum / n) * 10) / 10 : 0);

exports.getTeamAttendance = async ({ zodu_id, branch_id, employee_id, month, year, search, page = 1, limit = 100 }) => {
  const parsedLimit = Math.min(parseInt(limit, 10) || 100, 200);
  const parsedPage  = Math.max(parseInt(page, 10) || 1, 1);

  const { rows, summary } = await repo.findTeamAttendance({
    zodu_id, branch_id, employee_id, month, year, search,
    limit: parsedLimit, offset: (parsedPage - 1) * parsedLimit,
  });
  const n = summary.total_employees;

  return {
    success: true,
    data: {
      summary: {
        total_employees:     n,
        total_present_days:  summary.total_present_days,
        total_absent_days:   summary.total_absent_days,
        total_leave_days:    summary.total_leave_days,
        total_weekly_off_days: summary.total_weekly_off_days,
        // Per-employee averages over the month ("Avg. Present" etc.).
        avg_present_days:    avg(summary.total_present_days, n),
        avg_absent_days:     avg(summary.total_absent_days, n),
        avg_leave_days:      avg(summary.total_leave_days, n),
        avg_weekly_off_days: avg(summary.total_weekly_off_days, n),
      },
      employees: rows.map(r => ({
        employee_id:     r.employee_id,
        employee_code:   r.employee_code,
        employee_name:   r.employee_name,
        designation:     r.designation,
        days:            r.days,
        present_days:    r.present_days,
        absent_days:     r.absent_days,
        leave_days:      r.leave_days,
        weekly_off_days: r.weekly_off_days,
        // Days the employee was expected to work: everything except weekly offs.
        working_days:    r.present_days + r.absent_days + r.leave_days,
      })),
      pagination: pagination(rows[0]?.filtered_total ?? 0, parsedPage, parsedLimit),
    },
  };
};

// ── TEAM ATTENDANCE · DAY  ("Mark Attendance" daily list + summary cards) ─────

exports.getTeamDay = async ({ zodu_id, branch_id, employee_id, attendance_date, search, status, page = 1, limit = 20 }) => {
  const parsedLimit = Math.min(parseInt(limit, 10) || 20, 100);
  const parsedPage  = Math.max(parseInt(page, 10) || 1, 1);

  const { rows, summary } = await repo.findTeamDay({
    zodu_id, branch_id, employee_id, attendance_date, search, status,
    limit: parsedLimit, offset: (parsedPage - 1) * parsedLimit,
  });

  return {
    success: true,
    data: {
      summary: {
        total_employees: summary.total_employees,
        present:    summary.present,
        absent:     summary.absent,
        on_leave:   summary.on_leave,
        weekly_off: summary.weekly_off,
      },
      employees: rows.map(r => ({
        employee_id:    r.employee_id,
        employee_code:  r.employee_code,
        employee_name:  r.employee_name,
        status:         r.status,            // null: not marked yet
        check_in_time:  r.check_in_time,     // "09:07 AM"
        check_out_time: r.check_out_time,
        working_hours:  hoursText(r.working_minutes),   // "8h 57m"
        remarks:        r.remarks,
      })),
      pagination: pagination(rows[0]?.filtered_total ?? 0, parsedPage, parsedLimit),
    },
  };
};

// ── MY ATTENDANCE  ("My Attendance" personal daily view + summary cards) ──────
// One query: the summary is counted from the month's rows (at most 31) here,
// instead of a second aggregate query over the same rows.

// "8h 57m" from whole minutes; null until both punches exist.
const hoursText = (minutes) => (minutes == null ? null : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`);

// A day as the screens show it: the query already formatted the date and times.
const toDay = (r) => ({
  attendance_date: r.attendance_date,   // "16 Nov 2026"
  day:             r.day,               // "Mon"
  status:          r.status,
  check_in_time:   r.check_in_time,     // "02:06 PM"
  check_out_time:  r.check_out_time,
  working_hours:   hoursText(r.working_minutes),   // "0h 22m"
  remarks:         r.remarks,
});

// Calendar day in India, the zone attendance days are kept in.
const istToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

exports.getMyAttendance = async ({ employee_id, zodu_id, branch_id, month, year }) => {
  const rows = await repo.findMyAttendance({ employee_id, zodu_id, branch_id, month, year });

  const count = { Present: 0, Absent: 0, 'On Leave': 0, 'Weekly Off': 0 };
  for (const r of rows) if (r.status in count) count[r.status] += 1;
  const marked = count.Present + count.Absent;

  return {
    success: true,
    data: {
      today: istToday(),
      summary: {
        present_days:    count.Present,
        absent_days:     count.Absent,
        leave_days:      count['On Leave'],
        weekly_off_days: count['Weekly Off'],
        // Days the employee was expected to work: everything except weekly offs.
        working_days:    count.Present + count.Absent + count['On Leave'],
        attendance_pct:  marked ? Math.round((100 * count.Present) / marked) : 0,
      },
      days: rows.map(toDay),
    },
  };
};

// ── SELF CHECK-IN / CHECK-OUT ─────────────────────────────────────────────────

// An expected failure with its HTTP status (the controller sends it as is).
class AttendanceError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
exports.AttendanceError = AttendanceError;
exports.PunchError = AttendanceError;   // the name the punch code (and its tests) use
const PunchError = AttendanceError;

exports.checkIn = async ({ zodu_id, branch_id, employee }) => {
  const row = await repo.checkIn({ zodu_id, branch_id, employee_id: employee.employee_id, employee_name: employee.name });
  if (!row) throw new PunchError(409, 'You have already checked in today');
  return { success: true, data: toDay(row) };
};

exports.checkOut = async ({ employee }) => {
  const row = await repo.checkOut({ employee_id: employee.employee_id });
  if (row) return { success: true, data: toDay(row) };
  // Nothing was closed: say why.
  const today = await repo.findToday({ employee_id: employee.employee_id });
  if (!today || !today.check_in_time) throw new PunchError(400, 'You have not checked in today');
  throw new PunchError(409, 'You have already checked out today');
};

// ── ONE EMPLOYEE'S DAY  (save from the "Edit Attendance" dialog) ───────────────

const toEmployeeDay = (r) => ({
  employee_id:     r.employee_id,
  employee_code:   r.employee_code,
  employee_name:   r.employee_name,
  attendance_date: r.attendance_date,   // "16 Nov 2026"
  day:             r.day,               // "Mon"
  status:          r.status,            // null: not marked yet
  check_in_time:   r.check_in_time,      // "09:07" (24h IST, the form's value)
  check_out_time:  r.check_out_time,
  working_hours:   hoursText(r.working_minutes),   // "8h 57m"
  remarks:         r.remarks,
});

exports.saveEmployeeDay = async (input) => {
  if (input.attendance_date > istToday()) throw new AttendanceError(400, 'Attendance cannot be marked for a future date');

  const present = input.status === 'Present';
  const check_in_time  = present ? input.check_in_time  || null : null;
  const check_out_time = present ? input.check_out_time || null : null;
  if (present && !check_in_time) throw new AttendanceError(400, 'Check-in time is required for Present');
  if (check_out_time && check_out_time <= check_in_time) throw new AttendanceError(400, 'Check-out must be after check-in');

  const row = await repo.saveEmployeeDay({ ...input, check_in_time, check_out_time, remarks: input.remarks || null });
  if (!row) throw new AttendanceError(404, 'Employee not found');
  return { success: true, data: toEmployeeDay(row) };
};
