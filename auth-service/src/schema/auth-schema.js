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
    address_line_1: joi.string().allow(null, ''),
    address_line_2: joi.string().allow(null, ''),
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

  add_business: joi.object({
    restaurant_name: joi.string().max(100).required(),
    owner_admin_name: joi.string().max(100).allow(null, ''),
    gst_no: joi.string().max(50).allow(null, ''),
    phone_number:    joi.string().length(10).pattern(/^[0-9]+$/).required(),
    email:           joi.string().email().required(),
    pincode: joi.string().pattern(/^[0-9]{5,10}$/).allow(null, ''),
    city: joi.string().max(50).allow(null, ''),
    district: joi.string().max(50).allow(null, ''),
    state: joi.string().max(50).allow(null, ''),
    address_line_1: joi.string().max(100).allow(null, ''),
    address_line_2: joi.string().max(100).allow(null, ''),
    bank_name: joi.string().max(100).allow(null, ''),
    bank_branch: joi.string().max(100).allow(null, ''),
    holder_name: joi.string().max(100).allow(null, ''),
    account_number: joi.string().max(30).allow(null, ''),
    account_type: joi.string().allow(null, ''),
    ifsc_code: joi.string().max(20).allow(null, ''),
    can_use_for_branch: joi.boolean().default(true),
  }),

  edit_business: joi.object({
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
    address_line_1: joi.string().max(100).allow(null, ''),
    address_line_2: joi.string().max(100).allow(null, ''),
    bank_name: joi.string().max(100).allow(null, ''),
    bank_branch: joi.string().max(100).allow(null, ''),
    holder_name: joi.string().max(100).allow(null, ''),
    account_number: joi.string().max(30).allow(null, ''),
    account_type: joi.string().allow(null, ''),
    ifsc_code: joi.string().max(20).allow(null, ''),
    can_use_for_branch: joi.boolean(),
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
    // Option 1: Reuse business address and bank details via IDs
    address_id: joi.string(),
    bank_details_id: joi.string(),
    // Option 2: Create separate address for branch
    address_line_1: joi.string().max(100),
    address_line_2: joi.string().max(100).allow(null, ''),
    // Option 3: Create separate bank details for branch
    bank_name: joi.string().max(100),
    bank_branch: joi.string().max(100).allow(null, ''),
    holder_name: joi.string().max(100),
    account_number: joi.string().max(30),
    account_type: joi.string(),
    ifsc_code: joi.string().max(20),
  })
    .custom((value, helpers) => {
      const hasAddressId = value.address_id;
      const hasAddressFields = value.address_line_1;
      
      if (!hasAddressId && !hasAddressFields) {
        return helpers.error('any.required');
      }
      return value;
    }, 'Address validation: Either address_id OR address_line_1 required')
    .custom((value, helpers) => {
      const hasBankId = value.bank_details_id;
      const hasBankFields = value.bank_name && value.holder_name && value.account_number && value.ifsc_code;
      
      if (!hasBankId && !hasBankFields) {
        return helpers.error('any.required');
      }
      return value;
    }, 'Bank validation: Either bank_details_id OR (bank_name + holder_name + account_number + ifsc_code) required'),

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
    // Option 1: Update to use business address and bank details via IDs
    address_id: joi.string(),
    bank_details_id: joi.string(),
    // Option 2: Update to separate branch address
    address_line_1: joi.string().max(100),
    address_line_2: joi.string().max(100).allow(null, ''),
    // Option 3: Update to separate branch bank details
    bank_name: joi.string().max(100),
    bank_branch: joi.string().max(100).allow(null, ''),
    holder_name: joi.string().max(100),
    account_number: joi.string().max(30),
    account_type: joi.string(),
    ifsc_code: joi.string().max(20),
  }).min(3),
};

module.exports = schema;
