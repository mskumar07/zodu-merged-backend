const Joi = require('joi');

const createEmployee = Joi.object({
    zodu_id: Joi.string().required(),
    branch_id: Joi.string().required(),
    name: Joi.string().min(3).required(),
    phone: Joi.string().pattern(/^[0-9]{10}$/).required(),
    email: Joi.string().email().required(),   // 🔥 add this
    role_id: Joi.string().required()          // 🔥 role belongs to auth
});

const updateEmployee = Joi.object({
    name: Joi.string().min(3),
    phone: Joi.string().pattern(/^[0-9]{10}$/),
    role: Joi.string()
}).min(1);

module.exports = { createEmployee, updateEmployee };