const Joi = require('joi');

// zodu_id / branch_id always come from the access token (tenantOf), never from the client.
const zodu_branch = {
  zodu_id:   Joi.string().max(50).required(),
  branch_id: Joi.string().max(50).required(),
};

const shift_template_id = Joi.string().guid().required();

// 24-hour "HH:mm" — what a time input sends.
const clock = Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/).messages({ 'string.pattern.base': '{{#label}} must be a time as HH:mm (24-hour)' });

// ── The fields of a shift template (what the Add Shift Template form edits) ──
const fields = {
  name:        Joi.string().trim().min(2).max(60),
  code:        Joi.string().trim().uppercase().pattern(/^[A-Z0-9]{1,10}$/)
                 .messages({ 'string.pattern.base': 'Shift code must be 1-10 letters or digits' }),
  description: Joi.string().trim().max(255).allow(''),
  start_time:  clock,
  end_time:    clock,
  is_cross_day: Joi.boolean(),
  break_start:   clock.allow(null),
  break_minutes: Joi.number().integer().min(0).max(600),
  applicable_to:  Joi.string().valid('ALL', 'DEPARTMENTS'),
  department_ids: Joi.array().items(Joi.string().trim().max(64)).max(200).unique(),
  ot_eligible: Joi.boolean(),
  is_active:   Joi.boolean(),
};

// GET /api/shift-templates?status=&search=
exports.shift_template_list = Joi.object({
  ...zodu_branch,
  status: Joi.string().valid('active', 'inactive', 'all').default('all'),
  search: Joi.string().trim().max(100).allow(''),
});

// GET /api/shift-templates/:shift_template_id  and  DELETE (switches the template off)
exports.shift_template_id = Joi.object({ ...zodu_branch, shift_template_id });

// POST /api/shift-templates
exports.shift_template_create = Joi.object({
  ...zodu_branch,
  name:        fields.name.required(),
  code:        fields.code.required(),
  description: fields.description.default(''),
  start_time:  fields.start_time.required(),
  end_time:    fields.end_time.required(),
  is_cross_day:  fields.is_cross_day,            // optional: worked out from the times when left out
  break_start:   fields.break_start.default(null),
  break_minutes: fields.break_minutes.default(0),
  applicable_to:  fields.applicable_to.default('ALL'),
  department_ids: fields.department_ids.default([]),
  ot_eligible: fields.ot_eligible.default(false),
  is_active:   fields.is_active.default(true),
});

// PUT /api/shift-templates/:shift_template_id — send only what changed
exports.shift_template_update = Joi.object({
  ...zodu_branch,
  shift_template_id,
  ...fields,
}).or('name', 'code', 'description', 'start_time', 'end_time', 'is_cross_day', 'break_start', 'break_minutes',
  'applicable_to', 'department_ids', 'ot_eligible', 'is_active');
