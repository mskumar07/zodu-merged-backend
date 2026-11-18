const Joi = require('joi');

// zodu_id / branch_id always come from the access token (tenantOf), never from the client.
const zodu_branch = {
  zodu_id:   Joi.string().max(50).required(),
  branch_id: Joi.string().max(50).required(),
};

// A real calendar day: "2026-02-30" has the right shape but isn't one.
const calendar_date = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).custom((value, helpers) => {
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? helpers.error('any.invalid') : value;
});

const year   = Joi.number().integer().min(2000).max(2100);
const search = Joi.string().trim().max(100).allow('');
const paging = (limit) => ({
  page:  Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(limit),
});

const LEAVE_STATUSES = ['Pending', 'Approved', 'Rejected', 'Cancelled'];

// ── Own leave ────────────────────────────────────────────────────────────────

// GET /api/leave/summary and /api/leave/balance
exports.leave_year = Joi.object({ ...zodu_branch, year });

// GET /api/leave/my
exports.leave_my_list = Joi.object({ ...zodu_branch, year, ...paging(20) });

// GET /api/leave/holidays
exports.leave_holidays = Joi.object({ ...zodu_branch, year, upcoming: Joi.boolean().default(false) });

// GET /api/leave/preview — the days a range would count, before applying
exports.leave_preview = Joi.object({
  ...zodu_branch,
  from_date: calendar_date.required(),
  to_date:   calendar_date.required(),
});

// POST /api/leave
exports.leave_apply = Joi.object({
  ...zodu_branch,
  leave_type_id: Joi.string().guid().required(),
  from_date:     calendar_date.required(),
  to_date:       calendar_date.required(),
  reason:        Joi.string().trim().min(1).max(200).required(),
});

// PUT /api/leave/:leave_request_id/cancel
exports.leave_cancel = Joi.object({ ...zodu_branch, leave_request_id: Joi.string().guid().required() });

// ── Team (the employee's reporting manager; the company Admin sees everyone) ──

// GET /api/leave/requests — pending, waiting for the caller
exports.leave_pending_list = Joi.object({ ...zodu_branch, search, ...paging(20) });

// GET /api/leave/team — "All Leaves"
exports.leave_team_list = Joi.object({
  ...zodu_branch,
  year,
  search,
  leave_type: Joi.string().trim().max(10),
  status:     Joi.string().valid(...LEAVE_STATUSES),
  ...paging(20),
});

// PUT /api/leave/decision — approve or reject one request or many ("Select All")
exports.leave_decision = Joi.object({
  ...zodu_branch,
  ids:      Joi.array().items(Joi.string().guid()).min(1).max(100).unique().required(),
  decision: Joi.string().valid('Approved', 'Rejected').required(),
  note:     Joi.string().trim().max(200).allow(null, ''),
});

// POST /api/leave/holidays/upload carries the sheet as multipart; only the tenant is validated here.
exports.leave_holidays_upload = Joi.object({ ...zodu_branch });
