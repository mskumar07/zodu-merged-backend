const Joi = require('joi');

const createDepartment = Joi.object({
    department_code: Joi.string().required(),
    department_name: Joi.string().required(),
    zodu_id: Joi.string().required(),
    branch_id: Joi.string().required()
});

const updateDepartment = Joi.object({
    department_code: Joi.string(),
    department_name: Joi.string(),
    // zodu_id and branch_id usually don't change, but add here if needed
}).min(1);

module.exports = { createDepartment, updateDepartment };