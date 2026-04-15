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
    ifsc_code: joi.string().allow(null, ''),
    same_for_branch: joi.boolean().default(true),
  }),

  login: joi.object({
    phone_number: joi.string().length(10).pattern(/^[0-9]+$/),

    email: joi.string().email(),

    password: joi.string().pattern(passwordRegex).required()
  }),

  add_company: joi.object({
    restaurant_name: joi.string().max(100).required(),
    owner_admin_name: joi.string().max(100).allow(null, ''),
    gst_no: joi.string().max(50).allow(null, ''),
    phone_number:    joi.string().length(10).pattern(/^[0-9]+$/).required(),
    email:           joi.string().email().required(),
    pincode: joi.string().pattern(/^[0-9]{5,10}$/).allow(null, ''),
    city: joi.string().max(50).allow(null, ''),
    district: joi.string().max(50).allow(null, ''),
    state: joi.string().max(50).allow(null, ''),
    building_no: joi.string().max(100).allow(null, ''),
    area_street_name: joi.string().max(100).allow(null, ''),
    account_number: joi.string().max(30).allow(null, ''),
    account_type: joi.string().allow(null, ''),
    ifsc_code: joi.string().max(20).allow(null, ''),
    same_for_branch: joi.boolean().default(true),
  }),

  edit_company: joi.object({
    zodu_id: joi.string().required(),
    restaurant_name: joi.string().max(100),
    owner_admin_name: joi.string().max(100).allow(null, ''),
    gst_no: joi.string().max(50).allow(null, ''),
    phone_number: joi.string().length(10).pattern(/^[0-9]+$/),
    email: joi.string().email(),
    pincode: joi.string().pattern(/^[0-9]{5,10}$/).allow(null, ''),
    city: joi.string().max(50).allow(null, ''),
    district: joi.string().max(50).allow(null, ''),
    state: joi.string().max(50).allow(null, ''),
    building_no: joi.string().max(100).allow(null, ''),
    area_street_name: joi.string().max(100).allow(null, ''),
    account_number: joi.string().max(30).allow(null, ''),
    account_type: joi.string().allow(null, ''),
    ifsc_code: joi.string().max(20).allow(null, ''),
  }).min(2),

  add_branch: joi.object({
    zodu_id: joi.string().required(),
    branch_name: joi.string().max(100).required(),
    branch_manager_or_admin: joi.string().max(100).allow(null, ''),
    branch_mobile_no: joi.string().pattern(/^[0-9]{10,15}$/).required(),
    branch_mail_id: joi.string().email().required(),
    branch_city: joi.string().max(50).required(),
    branch_pincode: joi.string().pattern(/^[0-9]{5,10}$/).required(),
    branch_district: joi.string().max(50).required(),
    branch_state: joi.string().max(50).required(),
    branch_image: joi.string().uri().allow(null, ''),
   
    branch_floor_building_no: joi.string().max(100).required(),
    branch_area_street_name: joi.string().max(100).required(),
    branch_account_no: joi.string().max(30).required(),
    branch_ifsc: joi.string().max(20).required(),
    branch_account_type: joi.string().max(20).required(),
  }),

  edit_branch: joi.object({
    zodu_id: joi.string().required(),
    branch_id: joi.string().required(),
    branch_name: joi.string().max(100),
    branch_manager_or_admin: joi.string().max(100).allow(null, ''),
    branch_mobile_no: joi.string().pattern(/^[0-9]{10,15}$/),
    branch_mail_id: joi.string().email(),
    branch_city: joi.string().max(50),
    branch_pincode: joi.string().pattern(/^[0-9]{5,10}$/),
    branch_district: joi.string().max(50),
    branch_state: joi.string().max(50),
    branch_image: joi.string().uri().allow(null, ''),
    fssai: joi.string().max(50).allow(null, ''),
    opening_hours: joi.array().items(
      joi.object({
        day: joi.string().required(),
        open: joi.string().required(),
        close: joi.string().required(),
      })
    ).allow(null),
    branch_floor_building_no: joi.string().max(100),
    branch_area_street_name: joi.string().max(100),
    branch_account_no: joi.string().max(30),
    branch_ifsc: joi.string().max(20),
    branch_account_type: joi.string().max(20),
  }).min(3),
};

module.exports = schema;
