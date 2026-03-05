const Joi = require('joi');

const markAttendance = Joi.object({
    employee_id: Joi.string().uuid().required(),
    branch_id: Joi.string().required(),
    type: Joi.string().valid('in', 'out').required()
});

const leaveRequest = Joi.object({
    employee_id: Joi.string().uuid().required(),
    leave_type: Joi.string().required(),
    start_date: Joi.date().required(),
    end_date: Joi.date().min(Joi.ref('start_date')).required(),
    reason: Joi.string().required(),
    zodu_id: Joi.string().required(),
    branch_id: Joi.string().required()
});

module.exports = { markAttendance, leaveRequest };