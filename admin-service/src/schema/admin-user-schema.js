const joi = require('@hapi/joi');

const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,30}$/;

// Keep in sync with tbl_admin_users.role's comment in migrations/001_init.sql.
const ROLES = ['super_admin', 'support', 'finance', 'viewer'];

const schema = {
  create_admin_user: joi.object({
    name: joi.string().max(120).required(),
    email: joi.string().email().max(150).required(),
    // Same complexity rule as auth-service's customer signup password.
    password: joi.string().pattern(passwordRegex).required().messages({
      'string.pattern.base':
        '"password" must be 8-30 characters and include an uppercase letter, a lowercase letter, and a number',
    }),
    role: joi.string().valid(...ROLES).default('viewer'),
  }),
};

module.exports = schema;
