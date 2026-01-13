const Joi = require('joi');

const createEmployee = Joi.object({
    zodu_id: Joi.string().required(),
    branch_id: Joi.string().required(),
    name: Joi.string().min(3).required(),
    phone: Joi.string().pattern(/^[0-9]{10}$/).required(),
    role: Joi.string().required(),
    department_ids: Joi.array().items(Joi.string().uuid()).optional()
});

const updateEmployee = Joi.object({
    name: Joi.string().min(3),
    phone: Joi.string().pattern(/^[0-9]{10}$/),
    role: Joi.string()
}).min(1);

module.exports = { createEmployee, updateEmployee };