const joi = require("@hapi/joi");

const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9]).{8,30}$/;

const schema = {
  account_create: joi.object({
    restaurant_name: joi.string().max(50).required(),

    // Use string for phone numbers
    phone_number: joi.string().length(10).pattern(/^[0-9]+$/).required(),

    email: joi.string().email().required(),

    password: joi.string().pattern(passwordRegex).required(),

    gst_no: joi.string().allow(null, ''),
    pincode: joi.string().allow(null, ''),
    city: joi.string().allow(null, ''),
    district: joi.string().allow(null, ''),
    state: joi.string().allow(null, ''),
    building_no: joi.string().allow(null, ''),
    area_street_name: joi.string().allow(null, ''),
    account_number: joi.string().allow(null, ''),
    account_type: joi.string().allow(null, ''),
    ifsc_code: joi.string().allow(null, '')
  }),

  login: joi.object({
    phone_number: joi.string().length(10).pattern(/^[0-9]+$/),

    email: joi.string().email(),

    password: joi.string().pattern(passwordRegex).required()
  })
};

module.exports = schema;