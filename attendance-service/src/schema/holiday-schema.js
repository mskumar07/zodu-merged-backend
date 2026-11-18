const Joi = require('joi');

// zodu_id / branch_id always come from the access token (tenantOf), never from the client.
const zodu_branch = {
  zodu_id:   Joi.string().max(50).required(),
  branch_id: Joi.string().max(50).required(),
};

const holiday_id = Joi.string().guid().required();
const year = Joi.number().integer().min(2000).max(2100);
// Stored as sent (a holiday type master will own the list); the column holds 20 characters.
const type = Joi.string().trim().min(1).max(20);

// A real calendar day: "2026-02-30" has the right shape but isn't one.
const calendar_date = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).custom((value, helpers) => {
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? helpers.error('any.invalid') : value;
}).messages({ 'any.invalid': '{{#label}} must be a real date', 'string.pattern.base': '{{#label}} must be YYYY-MM-DD' });

// ── The fields of a holiday (what the Add / Edit Holiday form edits) ─────────
const fields = {
  name:           Joi.string().trim().min(2).max(100),
  holiday_date:   calendar_date,
  type,
  applicable_to:  Joi.string().valid('ALL', 'DEPARTMENTS'),
  // Department ids are opaque to this service (there is no departments table here yet).
  department_ids: Joi.array().items(Joi.string().trim().max(64)).max(200).unique(),
};

// GET /api/holidays?year=&type=&search=
exports.holiday_list = Joi.object({
  ...zodu_branch,
  year,
  type,
  search: Joi.string().trim().max(100).allow(''),
});

// GET /api/holidays/export?year=
exports.holiday_export = Joi.object({ ...zodu_branch, year });

// GET /api/holidays/:holiday_id  and  DELETE
exports.holiday_id = Joi.object({ ...zodu_branch, holiday_id });

// POST /api/holidays
exports.holiday_create = Joi.object({
  ...zodu_branch,
  name:           fields.name.required(),
  holiday_date:   fields.holiday_date.required(),
  type:           fields.type.required(),
  applicable_to:  fields.applicable_to.default('ALL'),
  department_ids: fields.department_ids.default([]),
});

// PUT /api/holidays/:holiday_id — send only what changed
exports.holiday_update = Joi.object({
  ...zodu_branch,
  holiday_id,
  ...fields,
}).or('name', 'holiday_date', 'type', 'applicable_to', 'department_ids');
