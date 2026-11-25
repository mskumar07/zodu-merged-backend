const Joi = require('joi');
const calendarDate = require('./calendar-date');

// zodu_id / branch_id always come from the access token (tenantOf), never from the client.
const zodu_branch = {
  zodu_id:   Joi.string().max(50).required(),
  branch_id: Joi.string().max(50).required(),
};

// GET /api/shift-schedule?from=&to=&search=&page=&limit=
// The period is the week or month the grid shows; the service refuses more than 31 days.
exports.shift_schedule_list = Joi.object({
  ...zodu_branch,
  from:   calendarDate.required(),
  to:     calendarDate.required(),
  search: Joi.string().trim().max(100).allow(''),
  page:   Joi.number().integer().min(1).default(1),
  limit:  Joi.number().integer().min(1).max(200).default(50),
});

// GET /api/shift-schedule/my?month=2026-11      the signed-in employee's own schedule (default: this month)
exports.shift_schedule_my = Joi.object({
  ...zodu_branch,
  month: Joi.string().pattern(/^\d{4}-(0[1-9]|1[0-2])$/).messages({ 'string.pattern.base': '{{#label}} must be YYYY-MM' }),
});

// One changed cell of the grid. shift_template_id null = OFF / rest day. `version` is the cell's version when the screen
// loaded it (0 = the cell was empty, nothing scheduled yet).
const change = Joi.object({
  employee_id:       Joi.string().guid().required(),
  work_date:         calendarDate.required(),
  shift_template_id: Joi.string().guid().allow(null).required(),
  version:           Joi.number().integer().min(0).default(0),
});

// PUT /api/shift-schedule: Assign Shifts, only the cells that changed.
exports.shift_schedule_assign = Joi.object({
  ...zodu_branch,
  changes: Joi.array().items(change).min(1).max(1000).required(),
});
