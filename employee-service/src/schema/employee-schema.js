const Joi = require('@hapi/joi');

const zodu_branch = {
  zodu_id:   Joi.string().max(50).required(),
  branch_id: Joi.string().max(50).required(),
};

// ── EMPLOYEE ──────────────────────────────────────────────────────────────────

exports.employee_create = Joi.object({
  ...zodu_branch,
  name:       Joi.string().min(2).max(100).required(),
  phone:      Joi.string().pattern(/^[0-9]{10,15}$/).required(),
  email:      Joi.string().email().allow(null, ''),
  status:     Joi.string().valid('active', 'inactive').default('active'),

  date_of_birth:  Joi.string().pattern(/^\d{4}-\d{2}-\d{2}/).allow(null, ''),
  gender:         Joi.string().valid('Male', 'Female', 'Other').allow(null, ''),
  address_line1:  Joi.string().max(255).allow(null, ''),
  address_line2:  Joi.string().max(255).allow(null, ''),
  city:           Joi.string().max(100).allow(null, ''),
  state:          Joi.string().max(100).allow(null, ''),
  pincode:        Joi.string().max(10).allow(null, ''),

  employment_type:         Joi.string().valid('Full Time', 'Part Time', 'Contract').allow(null, ''),
  date_of_joining:         Joi.string().pattern(/^\d{4}-\d{2}-\d{2}/).allow(null, ''),
  reporting_manager_id:    Joi.string().uuid().allow(null, ''),
  reporting_manager_name:  Joi.string().max(100).allow(null, ''),

  emergency_contact_name: Joi.string().max(100).allow(null, ''),
  emergency_relationship: Joi.string().max(50).allow(null, ''),
  emergency_mobile:       Joi.string().pattern(/^[0-9]{10,15}$/).allow(null, ''),

  basic_salary:        Joi.number().min(0).allow(null),
  allowances:          Joi.number().min(0).default(0),
  payment_type:        Joi.string().valid('Monthly', 'Weekly', 'Daily').allow(null, ''),
  bank_account_number: Joi.string().max(30).allow(null, ''),
  bank_name:           Joi.string().max(100).allow(null, ''),
  ifsc_code:           Joi.string().max(20).allow(null, ''),

  role_id:      Joi.string().uuid().required(),
  access_level: Joi.string().max(30).allow(null, ''),

  password: Joi.string().pattern(/^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,20}$/).allow(null, '').messages({
    'string.pattern.base': 'Password must be 8-20 chars with 1 uppercase, 1 number, 1 special char',
  }),
  notes: Joi.string().allow(null, ''),
});

exports.employee_update = Joi.object({
  ...zodu_branch,
  name:       Joi.string().min(2).max(100),
  phone:      Joi.string().pattern(/^[0-9]{10,15}$/),
  email:      Joi.string().email().allow(null, ''),
  status: Joi.string().valid('active', 'inactive'),

  date_of_birth:  Joi.string().pattern(/^\d{4}-\d{2}-\d{2}/).allow(null, ''),
  gender:         Joi.string().valid('Male', 'Female', 'Other').allow(null, ''),
  address_line1:  Joi.string().max(255).allow(null, ''),
  address_line2:  Joi.string().max(255).allow(null, ''),
  city:           Joi.string().max(100).allow(null, ''),
  state:          Joi.string().max(100).allow(null, ''),
  pincode:        Joi.string().max(10).allow(null, ''),

  employment_type:         Joi.string().valid('Full Time', 'Part Time', 'Contract').allow(null, ''),
  date_of_joining:         Joi.string().pattern(/^\d{4}-\d{2}-\d{2}/).allow(null, ''),
  reporting_manager_id:    Joi.string().uuid().allow(null, ''),
  reporting_manager_name:  Joi.string().max(100).allow(null, ''),

  emergency_contact_name: Joi.string().max(100).allow(null, ''),
  emergency_relationship: Joi.string().max(50).allow(null, ''),
  emergency_mobile:       Joi.string().pattern(/^[0-9]{10,15}$/).allow(null, ''),

  basic_salary:        Joi.number().min(0).allow(null),
  allowances:          Joi.number().min(0),
  payment_type:        Joi.string().valid('Monthly', 'Weekly', 'Daily').allow(null, ''),
  bank_account_number: Joi.string().max(30).allow(null, ''),
  bank_name:           Joi.string().max(100).allow(null, ''),
  ifsc_code:           Joi.string().max(20).allow(null, ''),

  role_id:      Joi.string().uuid().allow(null, ''),
  access_level: Joi.string().max(30),

  password: Joi.string().pattern(/^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,20}$/).allow(null, '').messages({
    'string.pattern.base': 'Password must be 8-20 chars with 1 uppercase, 1 number, 1 special char',
  }),
  notes: Joi.string().allow(null, ''),
}).min(1);

// ── DOCUMENT ──────────────────────────────────────────────────────────────────

exports.document_upload = Joi.object({
  ...zodu_branch,
  document_type: Joi.string().max(50).required(),
  file_name:     Joi.string().max(255).allow(null, ''),
  file_url:      Joi.string().required(),
});
