const joi = require("@hapi/joi");

const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,30}$/;

const schema = {
  account_create: joi.object({
    restaurant_name: joi.string().max(50).required(),

    // Use string for phone numbers
    phone_number: joi.string().length(10).pattern(/^[0-9]+$/).required(),

    email: joi.string().email().required(),

    password: joi.string().pattern(passwordRegex).required(),
    business_type: joi.string().max(50).allow(null, ''),

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
    type: joi.string().max(50).allow(null, ''),
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
    type: joi.string().max(50).allow(null, ''),
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
    branch_city: joi.string().max(50).allow(null, ''),
    branch_pincode: joi.string().pattern(/^[0-9]{5,10}$/).allow(null, ''),
    branch_district: joi.string().max(50).allow(null, ''),
    branch_state: joi.string().max(50).allow(null, ''),
    branch_image: joi.string().uri().allow(null, ''),
    address_id: joi.string().allow(null, ''),
    bank_details_id: joi.string().allow(null, ''),
    same_as_address: joi.boolean(),
    same_as_bank_details: joi.boolean(),
    address_line_1: joi.string().max(100).allow(null, ''),
    address_line_2: joi.string().max(100).allow(null, ''),
    bank_name: joi.string().max(100).allow(null, ''),
    bank_branch: joi.string().max(100).allow(null, ''),
    holder_name: joi.string().max(100).allow(null, ''),
    account_number: joi.string().max(30).allow(null, ''),
    account_type: joi.string().allow(null, ''),
    ifsc_code: joi.string().max(20).allow(null, ''),
  }),

  edit_branch: joi.object({
    zodu_id: joi.string().required(),
    branch_id: joi.string().required(),
    branch_name: joi.string().max(100).allow(null, ''),
    branch_manager_or_admin: joi.string().max(100).allow(null, ''),
    branch_mobile_no: joi.string().pattern(/^[0-9]{10,15}$/).allow(null, ''),
    branch_mail_id: joi.string().email().allow(null, ''),
    branch_city: joi.string().max(50).allow(null, ''),
    branch_pincode: joi.string().pattern(/^[0-9]{5,10}$/).allow(null, ''),
    branch_district: joi.string().max(50).allow(null, ''),
    branch_state: joi.string().max(50).allow(null, ''),
    branch_image: joi.string().uri().allow(null, ''),
    address_id: joi.string().allow(null, ''),
    bank_details_id: joi.string().allow(null, ''),
    address_line_1: joi.string().max(100).allow(null, ''),
    address_line_2: joi.string().max(100).allow(null, ''),
    bank_name: joi.string().max(100).allow(null, ''),
    bank_branch: joi.string().max(100).allow(null, ''),
    holder_name: joi.string().max(100).allow(null, ''),
    account_number: joi.string().max(30).allow(null, ''),
    account_type: joi.string().allow(null, ''),
    ifsc_code: joi.string().max(20).allow(null, ''),
    same_as_address: joi.boolean(),
    same_as_bank_details: joi.boolean(),
  }).min(3),

  edit_invoice_settings: joi.object({
    zodu_id: joi.string().required(),
    branch_id: joi.string().required(),
    invoice_prefix: joi.string().max(20).allow(null, ''),
    invoice_digit_count: joi.number().integer().min(1).max(10),
    invoice_start_number: joi.number().integer().min(1),
    default_tax_label: joi.string().max(50).allow(null, ''),
    invoice_due_days: joi.number().integer().min(0),
    default_payment_method: joi.string().max(30).allow(null, ''),
    printer_inch: joi.string().max(10).allow(null, ''),
    show_company_logo: joi.boolean(),
    print_thank_you_message: joi.boolean(),
  }).min(3),
};

module.exports = schema;
