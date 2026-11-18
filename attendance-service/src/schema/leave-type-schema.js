const Joi = require('joi');

// zodu_id / branch_id always come from the access token (tenantOf), never from the client.
const zodu_branch = {
  zodu_id:   Joi.string().max(50).required(),
  branch_id: Joi.string().max(50).required(),
};

const leave_type_id = Joi.string().guid().required();

// A real calendar day: "2026-02-30" has the right shape but isn't one.
const calendar_date = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).custom((value, helpers) => {
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? helpers.error('any.invalid') : value;
}).messages({ 'any.invalid': '{{#label}} must be a real date', 'string.pattern.base': '{{#label}} must be YYYY-MM-DD' });

// ── The fields of a leave type (what the Leave Types form edits) ─────────────
const fields = {
  name:        Joi.string().trim().min(2).max(60),
  // "CL": letters and digits, stored upper-case so "cl" and "CL" are the same code.
  code:        Joi.string().trim().uppercase().pattern(/^[A-Z0-9]{1,10}$/)
                 .messages({ 'string.pattern.base': 'Leave code must be 1-10 letters or digits' }),
  annual_days: Joi.number().min(0).max(366).precision(1),
  is_paid:     Joi.boolean(),
  carry_forward:          Joi.boolean(),
  // Whether it is needed (carry_forward on) or ignored (off) is decided by the service, which has the whole row.
  carry_forward_max_days: Joi.number().min(0).max(366).precision(1),
  encashment:  Joi.boolean(),
  applicable_to:  Joi.string().valid('ALL', 'DEPARTMENTS'),
  // Department ids are opaque to this service (there is no departments table here yet).
  department_ids: Joi.array().items(Joi.string().trim().max(64)).max(200).unique(),
  effective_from: calendar_date,
  is_active:   Joi.boolean(),
};

// GET /api/leave-types?status=&search=
exports.leave_type_list = Joi.object({
  ...zodu_branch,
  status: Joi.string().valid('active', 'inactive', 'all').default('all'),
  search: Joi.string().trim().max(100).allow(''),
});

// GET /api/leave-types/:leave_type_id  and  DELETE (switches the type off)
exports.leave_type_id = Joi.object({ ...zodu_branch, leave_type_id });

// POST /api/leave-types
exports.leave_type_create = Joi.object({
  ...zodu_branch,
  name:        fields.name.required(),
  code:        fields.code.required(),
  annual_days: fields.annual_days.required(),
  is_paid:     fields.is_paid.default(true),
  carry_forward:          fields.carry_forward.default(false),
  carry_forward_max_days: fields.carry_forward_max_days.default(0),
  encashment:  fields.encashment.default(false),
  applicable_to:  fields.applicable_to.default('ALL'),
  department_ids: fields.department_ids.default([]),
  effective_from: fields.effective_from,
  is_active:   fields.is_active.default(true),
});

// PUT /api/leave-types/:leave_type_id — send only what changed
exports.leave_type_update = Joi.object({
  ...zodu_branch,
  leave_type_id,
  ...fields,
}).or('name', 'code', 'annual_days', 'is_paid', 'carry_forward', 'carry_forward_max_days', 'encashment',
  'applicable_to', 'department_ids', 'effective_from', 'is_active');
