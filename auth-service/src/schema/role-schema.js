const Joi = require('joi');

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
  email:                Joi.string().email().allow(null, ''),
  phone:                Joi.string().pattern(/^[0-9]{10,15}$/).required(),
  zodu_id:              Joi.string().required(),
  branch_id:            Joi.string().required(),
  role_id:              Joi.string().uuid().allow(null, ''),
  access_level:         Joi.string().max(30).default('Full Access'),
  reporting_manager_id: Joi.string().uuid().allow(null, ''),
  is_first_employee:    Joi.boolean().default(false),
  // Length and the common-password list: the password policy
  // (src/auth/password.js). No composition rules (NIST SP 800-63B).
  password:             Joi.string().max(128).allow(null, ''),
});

exports.updateEmployeeRole = Joi.object({
  role_id:              Joi.string().uuid(),
  access_level:         Joi.string().max(30),
  zodu_id:              Joi.string(),
  branch_id:            Joi.string(),
  reporting_manager_id: Joi.string().uuid().allow(null, ''),
}).min(1);

exports.setEmployeeLogin = Joi.object({
  user_id:              Joi.string().uuid().required(),
  zodu_id:              Joi.string().required(),
  branch_id:            Joi.string().required(),
  role_id:              Joi.string().uuid(),
  password:             Joi.string().max(128),
  login_user:           Joi.boolean(),
  reporting_manager_id: Joi.string().uuid().allow(null, ''),
  // Used only when the login user does not exist yet and has to be created
  email:                Joi.string().email().allow(null, ''),
  phone:                Joi.string().pattern(/^[0-9]{10,15}$/).allow(null, ''),
  is_first_employee:    Joi.boolean().default(false),
}).or('role_id', 'password', 'login_user');
