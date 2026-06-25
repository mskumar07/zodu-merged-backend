const Joi = require('@hapi/joi');

exports.salary_create = Joi.object({
  employee_id:         Joi.string().uuid().required(),
  user_id:             Joi.string().uuid().required(),
  zodu_id:             Joi.string().required(),
  branch_id:           Joi.string().required(),
  basic_salary:        Joi.number().min(0).required(),
  allowances:          Joi.number().min(0).default(0),
  payment_type:        Joi.string().valid('Monthly', 'Weekly', 'Daily').default('Monthly'),
  bank_account_number: Joi.string().max(30).allow(null, ''),
  bank_name:           Joi.string().max(100).allow(null, ''),
  ifsc_code:           Joi.string().max(20).allow(null, ''),
});

exports.salary_update = Joi.object({
  basic_salary:        Joi.number().min(0),
  allowances:          Joi.number().min(0),
  payment_type:        Joi.string().valid('Monthly', 'Weekly', 'Daily'),
  bank_account_number: Joi.string().max(30).allow(null, ''),
  bank_name:           Joi.string().max(100).allow(null, ''),
  ifsc_code:           Joi.string().max(20).allow(null, ''),
  user_id:             Joi.string().uuid(),
  zodu_id:             Joi.string(),
  branch_id:           Joi.string(),
  updated_by:          Joi.string().uuid().allow(null, ''),
}).min(1);
