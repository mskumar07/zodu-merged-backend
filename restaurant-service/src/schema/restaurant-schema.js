// validators/company.schema.js
const Joi = require("joi");

const company_create = Joi.object({
    zodu_id: Joi.required(),
  restaurant_name: Joi.string().min(2).max(255).required(),
  // owner_admin_name: Joi.string().max(100).required(),
  mobile_no: Joi.number().min(15).required(), // allows 10-15 digit numbers,
  mail_id: Joi.string().email().max(100).required(),
  // gst_no: Joi.string().max(50).required(),
  // pincode: Joi.string().pattern(/^[0-9]{5,10}$/).required(), // allows 5-10 digit numbers,
  // city: Joi.string().max(50).required(),
  // district: Joi.string().max(50).required(),
  // state: Joi.string().max(50).required(),
  // building_no: Joi.string().max(100).required(),
  // area_street_name: Joi.string().max(100).required(),
  // account_number: Joi.string().pattern(/^[0-9]{6,30}$/).required(), // typical bank account numbers,
  // account_type: Joi.string().required(),
  // ifsc_code: Joi.string().pattern(/^[A-Z]{4}0[A-Z0-9]{6}$/).required(), // standard IFSC code format
});

const update_company = Joi.object({

  owner_admin_name: Joi.string().max(100).required(),
  gst_no: Joi.string().max(50).required(),
  pincode: Joi.string().pattern(/^[0-9]{5,10}$/).required(), // allows 5-10 digit numbers,
  city: Joi.string().max(50).required(),
  district: Joi.string().max(50).required(),
  state: Joi.string().max(50).required(),
  building_no: Joi.string().max(100).required(),
  area_street_name: Joi.string().max(100).required(),
  account_number: Joi.string().pattern(/^[0-9]{6,30}$/).required(), // typical bank account numbers,
  account_type: Joi.string().required(),
  ifsc_code: Joi.string().pattern(/^[A-Z]{4,5}0[A-Z0-9]{6}$/).required(), // standard IFSC code format
});

const branch_create = Joi.object({
  zodu_id: Joi.required(),
  branch_name: Joi.string().max(100).required(),
  // qr_code_id: Joi.string().max(100),
  branch_manager_or_admin: Joi.string().max(100),
  branch_mobile_no: Joi.string().pattern(/^[0-9]{10,15}$/).required(),
  branch_mail_id: Joi.string().email().max(100).required(),
  branch_city: Joi.string().max(50).required(),
  branch_pincode:  Joi.string().pattern(/^[0-9]{5,10}$/).required(),
  branch_district: Joi.string().max(50).required(),
  branch_state: Joi.string().max(50).required(),
  branch_image: Joi.string().uri(), // Optional image URL
  fssai: Joi.string().max(50),
  opening_hours: Joi.array().items(
    Joi.object({
      day: Joi.string().required(),
      open: Joi.string().required(),
      close: Joi.string().required(),
    })
  ).allow(null), // JSONB array
  branch_floor_building_no: Joi.string().max(100).required(),
  branch_area_street_name: Joi.string().max(100).required(),
  branch_account_no: Joi.string().max(30).required(),
  branch_ifsc: Joi.string().max(20).required(),
  branch_account_type: Joi.string().max(20).required()
});

const menu_item_create = Joi.object({
  zodu_id: Joi.string().max(50).required(),
  branch_id: Joi.string().max(50).required(),
  menu_type: Joi.string().max(100).required(),
  menu_name: Joi.string().max(100).required(),
  food_type: Joi.string().max(25).allow(null),
  variants: Joi.alternatives().try(
    Joi.array().items(Joi.object()),   
    Joi.string()                      
  ).allow(null),
  item_code: Joi.string().required(), 
  menu_category: Joi.string().max(100).required(),
  sell_price: Joi.string().max(100).required(),
  purchase_price: Joi.string().max(100).allow(null),
  hsn_code: Joi.string().max(50).required(),
  gst_tax: Joi.string().max(50).required(),
  tax_include_or_exclude: Joi.boolean().required(),
  menu_image: Joi.object().required(), 
  menu_unit: Joi.string()        
});



module.exports = {
  company_create,
  branch_create,
  menu_item_create,
  update_company
};
