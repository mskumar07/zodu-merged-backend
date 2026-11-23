const Joi = require('joi');

// zodu_id / branch_id always come from the access token (tenantOf), never from the client.
const zodu_branch = {
  zodu_id:   Joi.string().max(50).required(),
  branch_id: Joi.string().max(50).required(),
};

const rotation_id = Joi.string().guid().required();

const calendarDate = require('./calendar-date');

// One day of the pattern. shift_template_id null = OFF / rest day.
const day = Joi.object({
  day_no:            Joi.number().integer().min(1).max(365).required(),
  shift_template_id: Joi.string().guid().allow(null).required(),
});

// ── The fields of a rotation (what the Add Rotation form edits) ──
const fields = {
  name:          Joi.string().trim().min(2).max(100),
  description:   Joi.string().trim().max(255).allow(''),
  rotation_type: Joi.string().valid('FIXED_CYCLE', 'CUSTOM'),
  cycle_length:  Joi.number().integer().min(1).max(365),
  // Only "All Employees" until the departments exist; then add 'DEPARTMENTS' here and fill department_ids.
  applicable_to: Joi.string().valid('ALL'),
  effective_from: calendarDate,
  is_active:     Joi.boolean(),
  days:          Joi.array().items(day).min(1).max(365),
};

// GET /api/shift-rotations?status=&search=
exports.shift_rotation_list = Joi.object({
  ...zodu_branch,
  status: Joi.string().valid('active', 'inactive', 'all').default('all'),
  search: Joi.string().trim().max(100).allow(''),
});

// GET /api/shift-rotations/:rotation_id  and  DELETE (switches the rotation off)
exports.shift_rotation_id = Joi.object({ ...zodu_branch, rotation_id });

// POST /api/shift-rotations
exports.shift_rotation_create = Joi.object({
  ...zodu_branch,
  name:           fields.name.required(),
  description:    fields.description.default(''),
  rotation_type:  fields.rotation_type.required(),
  cycle_length:   fields.cycle_length.required(),
  applicable_to:  fields.applicable_to.default('ALL'),
  effective_from: fields.effective_from.required(),
  is_active:      fields.is_active.default(true),
  days:           fields.days.required(),
});

// PUT /api/shift-rotations/:rotation_id — send `version` (the one the screen loaded) and only what changed.
// Changing the cycle length or the type means sending the whole `days` pattern again.
exports.shift_rotation_update = Joi.object({
  ...zodu_branch,
  rotation_id,
  version: Joi.number().integer().min(1).required(),
  ...fields,
}).or('name', 'description', 'rotation_type', 'cycle_length', 'applicable_to', 'effective_from', 'is_active', 'days');
