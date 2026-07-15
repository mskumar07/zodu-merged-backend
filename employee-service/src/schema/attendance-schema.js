const Joi = require('@hapi/joi');

const zodu_branch = {
  zodu_id:   Joi.string().max(50).required(),
  branch_id: Joi.string().max(50).required(),
};

const date_pattern = /^\d{4}-\d{2}-\d{2}$/;

// ── MARK ATTENDANCE  POST /api/attendance ─────────────────────────────────────

exports.attendance_mark_save = Joi.object({
  ...zodu_branch,
  attendance_date: Joi.string().pattern(date_pattern).required(),
  marked_by:       Joi.string().max(50).required(),
  marked_by_name:  Joi.string().max(100).allow(null, ''),
  records: Joi.array().items(
    Joi.object({
      employee_id:    Joi.string().max(50).required(),
      status:         Joi.string().valid('Present', 'Absent', 'Weekly Off').required(),
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
  employee_id: Joi.string().max(50).required(),
  month: Joi.number().integer().min(1).max(12),
  year:  Joi.number().integer().min(2000).max(2100),
});

// ── MY ATTENDANCE  GET /api/attendance/my ─────────────────────────────────────

exports.attendance_my = Joi.object({
  ...zodu_branch,
  employee_id: Joi.string().max(50).required(),
  month: Joi.number().integer().min(1).max(12),
  year:  Joi.number().integer().min(2000).max(2100),
});
