const Joi = require('@hapi/joi');

const permissionObject = Joi.object({
  module_id:  Joi.string().uuid().required(),
  can_read:   Joi.boolean().default(false),
  can_create: Joi.boolean().default(false),
  can_edit:   Joi.boolean().default(false),
  can_delete: Joi.boolean().default(false),
});

exports.createRole = Joi.object({
  zodu_id:     Joi.string().required(),
  branch_id:   Joi.string().required(),
  role_name:   Joi.string().min(2).max(100).required(),
  description: Joi.string().max(255).allow(null, ''),
  permissions: Joi.array().items(permissionObject).min(1).required(),
});

exports.updateRole = Joi.object({
  zodu_id:     Joi.string().required(),
  branch_id:   Joi.string().required(),
  role_name:   Joi.string().min(2).max(100),
  description: Joi.string().max(255).allow(null, ''),
  permissions: Joi.array().items(permissionObject).min(1),
}).min(3); // zodu_id + branch_id + at least one field

exports.createEmployeeUser = Joi.object({
  email:                Joi.string().email().required(),
  phone:                Joi.string().pattern(/^[0-9]{10,15}$/).required(),
  zodu_id:              Joi.string().required(),
  branch_id:            Joi.string().required(),
  role_id:              Joi.string().uuid().required(),
  access_level:         Joi.string().max(30).default('Full Access'),
  reporting_manager_id: Joi.string().uuid().allow(null, ''),
  password:             Joi.string().pattern(/^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,20}$/).allow(null, '').messages({
    'string.pattern.base': 'Password must be 8-20 chars with 1 uppercase, 1 number, 1 special char',
  }),
});

exports.updateEmployeeRole = Joi.object({
  role_id:              Joi.string().uuid(),
  access_level:         Joi.string().max(30),
  zodu_id:              Joi.string(),
  branch_id:            Joi.string(),
  reporting_manager_id: Joi.string().uuid().allow(null, ''),
}).min(1);
