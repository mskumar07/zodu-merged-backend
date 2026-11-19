const Joi = require('joi');

// zodu_id / branch_id always come from the access token (tenantOf), never from the client.
const zodu_branch = {
  zodu_id:   Joi.string().max(50).required(),
  branch_id: Joi.string().max(50).required(),
};

const policy_id = Joi.string().guid().required();

// ── The fields of a leave policy (what the Add / Edit Policy form edits) ─────
const fields = {
  name:        Joi.string().trim().min(2).max(100),
  description: Joi.string().trim().max(200).allow('', null),
  is_active:   Joi.boolean(),
  applicable_to:  Joi.string().valid('ALL', 'DEPARTMENTS'),
  // Department ids are opaque to this service (there is no departments table here yet).
  department_ids: Joi.array().items(Joi.string().trim().max(64)).max(200).unique(),

  annual_entitlement:     Joi.boolean(),
  // The Leave Year dropdown: the month the year starts in (1 = Jan – Dec, 4 = Apr – Mar ...).
  leave_year_start_month: Joi.number().integer().min(1).max(12),
  carry_forward:          Joi.boolean(),
  // Whether a number is needed (box ticked) or ignored (unticked) is decided by the service, which has the whole row.
  carry_forward_max_days: Joi.number().min(0).max(366).precision(1),
  encashment:             Joi.boolean(),
  encashment_limit_days:  Joi.number().min(0).max(366).precision(1),
};

// GET /api/leave-policies?status=&search=
exports.leave_policy_list = Joi.object({
  ...zodu_branch,
  status: Joi.string().valid('active', 'inactive', 'all').default('all'),
  search: Joi.string().trim().max(100).allow(''),
});

// GET /api/leave-policies/:policy_id  and  DELETE
exports.leave_policy_id = Joi.object({ ...zodu_branch, policy_id });

// POST /api/leave-policies
exports.leave_policy_create = Joi.object({
  ...zodu_branch,
  name:        fields.name.required(),
  description: fields.description.default(null),
  is_active:   fields.is_active.default(true),
  applicable_to:  fields.applicable_to.default('ALL'),
  department_ids: fields.department_ids.default([]),
  annual_entitlement:     fields.annual_entitlement.default(true),
  leave_year_start_month: fields.leave_year_start_month.default(1),
  carry_forward:          fields.carry_forward.default(false),
  carry_forward_max_days: fields.carry_forward_max_days.default(0),
  encashment:             fields.encashment.default(false),
  encashment_limit_days:  fields.encashment_limit_days.default(0),
});

// PUT /api/leave-policies/:policy_id — send the `version` you loaded, and only what changed
exports.leave_policy_update = Joi.object({
  ...zodu_branch,
  policy_id,
  version: Joi.number().integer().min(1).required(),
  ...fields,
}).or('name', 'description', 'is_active', 'applicable_to', 'department_ids', 'annual_entitlement',
  'leave_year_start_month', 'carry_forward', 'carry_forward_max_days', 'encashment', 'encashment_limit_days');
