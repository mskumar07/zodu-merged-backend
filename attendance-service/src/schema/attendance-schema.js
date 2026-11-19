const Joi = require('joi');

const zodu_branch = {
  zodu_id:   Joi.string().max(50).required(),
  branch_id: Joi.string().max(50).required(),
};

const date_pattern = /^\d{4}-\d{2}-\d{2}$/;

// ── MARK ATTENDANCE  POST /api/attendance ─────────────────────────────────────

exports.attendance_mark_save = Joi.object({
  ...zodu_branch,
  attendance_date: Joi.string().pattern(date_pattern).required(),
  // Ignored when the caller has an employee record: the server stamps who saved it.
  marked_by:       Joi.string().max(50),
  marked_by_name:  Joi.string().max(100).allow(null, ''),
  records: Joi.array().items(
    Joi.object({
      employee_id:    Joi.string().max(50).required(),
      status:         Joi.string().valid('Present', 'Absent', 'Weekly Off', 'On Leave').required(),
      check_in_time:  Joi.string().allow(null, ''),
      check_out_time: Joi.string().allow(null, ''),
      remarks:        Joi.string().allow(null, ''),
    })
  ).min(1).required(),
});

// ── EMPLOYEES FOR MARK ATTENDANCE MODAL  GET /api/attendance/mark ─────────────

exports.attendance_mark_list = Joi.object({
  ...zodu_branch,
  attendance_date: Joi.string().pattern(date_pattern).required(),
  page:  Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
});

// ── TEAM ATTENDANCE  GET /api/attendance/team ─────────────────────────────────

exports.attendance_team = Joi.object({
  ...zodu_branch,
  // The caller, left out of the team. Omitted: the signed-in user's own employee record.
  employee_id: Joi.string().max(50),
  month: Joi.number().integer().min(1).max(12),
  year:  Joi.number().integer().min(2000).max(2100),
  search: Joi.string().trim().max(100).allow(''),
  page:  Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(100),
});

// ── TEAM ATTENDANCE · DAY  GET /api/attendance/team/daily ─────────────────────

exports.attendance_team_day = Joi.object({
  ...zodu_branch,
  employee_id: Joi.string().max(50),
  attendance_date: Joi.string().pattern(date_pattern).required(),
  search: Joi.string().trim().max(100).allow(''),
  // 'none' = not marked yet
  status: Joi.string().valid('Present', 'Absent', 'On Leave', 'Weekly Off', 'none'),
  page:  Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

// ── MY ATTENDANCE  GET /api/attendance/my ─────────────────────────────────────

exports.attendance_my = Joi.object({
  ...zodu_branch,
  // Omitted: the signed-in user's own employee record.
  employee_id: Joi.string().max(50),
  month: Joi.number().integer().min(1).max(12),
  year:  Joi.number().integer().min(2000).max(2100),
});

// ── MY DASHBOARD  GET /api/attendance/dashboard ───────────────────────────────
// week_start: any day of the wanted week (default: this week). month / year: the calendar (default: this month).

exports.attendance_dashboard = Joi.object({
  ...zodu_branch,
  week_start: Joi.string().pattern(date_pattern),
  month: Joi.number().integer().min(1).max(12),
  year:  Joi.number().integer().min(2000).max(2100),
});

// ── TEAM DASHBOARD  GET /api/attendance/dashboard/team ────────────────────────
// date: any day of the week to show (default: this week). The cards, donut and log are that week;
// view only changes the trend chart: that week (weekly) or that date's month (monthly).

exports.attendance_team_dashboard = Joi.object({
  ...zodu_branch,
  date: Joi.string().pattern(date_pattern),
  view: Joi.string().valid('weekly', 'monthly').default('weekly'),
  search: Joi.string().trim().max(100).allow(''),
  page:  Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
});

// ── CHECK-IN / CHECK-OUT  POST /api/attendance/check-in | check-out ──────────
// No fields: the employee is the signed-in user and the time is the server's.

exports.attendance_punch = Joi.object({ ...zodu_branch });

// ── ONE EMPLOYEE'S DAY  PUT /api/attendance/employee/:employee_id ─────────────
// The "Edit Attendance" dialog's save. Times are "HH:mm" (24h, IST), the form's own values.

// A real calendar day: "2026-02-30" has the right shape but isn't one.
const calendar_date = Joi.string().pattern(date_pattern).custom((value, helpers) => {
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? helpers.error('any.invalid') : value;
});
const hhmm = Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/);

exports.attendance_employee_day_save = Joi.object({
  ...zodu_branch,
  employee_id:     Joi.string().guid().required(),
  attendance_date: calendar_date.required(),
  status:          Joi.string().valid('Present', 'Absent', 'Weekly Off', 'On Leave').required(),
  // Only used when Present; for any other status they are cleared.
  check_in_time:   hhmm.allow(null, ''),
  check_out_time:  hhmm.allow(null, ''),
  remarks:         Joi.string().trim().max(200).allow(null, ''),
});
