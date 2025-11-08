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
  menu_image: Joi.object().allow(null).optional(),
  menu_unit: Joi.string()
});

// item schema for each order item
const inventorySchema = 
      Joi.object({
        inventory_id: Joi.number().required(),
        stock_qty: Joi.number().optional(),
        stock_alert: Joi.number().optional(),
        selling_price: Joi.number().optional(),
        purchase_price: Joi.number().optional(),
        last_purchase_date: Joi.date().optional(),
      });
    
    
// item schema
const itemSchema = Joi.object({
  menu_id: Joi.string().max(100).required(),
  name: Joi.string().max(200).required(),
  qty: Joi.number().integer().min(1).required(),
  price: Joi.number().precision(2).min(0).required(),
  image: Joi.string().allow(null, ''),
  tax: Joi.number().precision(2).min(0).required(),
  menu_unit: Joi.string().max(50).optional(),
  variant_name: Joi.string().max(100).optional().allow(null, ''),
  variant_id: Joi.string().max(100).optional().allow(null, ''),
});
// order schema
 const order_create = Joi.object({
  zodu_id: Joi.string().max(50).required(),
  branch_id: Joi.string().max(50).required(),
  table_no: Joi.number().integer().required(),
  kot_no:Joi.string().required(),
  no_of_items:Joi.number().integer().required(),
  order_type: Joi.string().valid('Dine-In', 'Takeaway', 'Delivery').required(),
  order_id:Joi.string().max(50),
  customer_name: Joi.string().max(100).allow('', null),
  customer_phone: Joi.string()
    .pattern(/^[0-9]{7,15}$/)
    .allow('', null),
  total_amt: Joi.number().precision(2).min(0).required(),
items: Joi.array().items(itemSchema).min(1).required(),
  final_payment: Joi.boolean().required(),
   order_date: Joi.alternatives().try(
    Joi.date().iso(), // '2025-10-09'
    Joi.string().pattern(/^\d{2}-\d{2}-\d{4}$/) // '09-10-2025'
  ).required(),

  order_time: Joi.alternatives().try(
    Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/), // 15:30 or 15:30:00
    Joi.string().pattern(/^(0?[1-9]|1[0-2]):[0-5][0-9]\s?(AM|PM|am|pm)$/) // 03:30 PM
  ).required()
}).options({ abortEarly: false });

const purchase_order_create = Joi.object({
  zodu_id: Joi.string().max(50).required(),
  branch_id: Joi.string().max(50).required(),
  vendor: Joi.string().required(),
  category: Joi.string().max(100).required(),
  purchase_date: Joi.date().required(),
  purchase_type: Joi.string().max(100).required(),
  total_amount: Joi.number().precision(2).min(0).required(),
  paid_amount: Joi.number().precision(2).min(0).required(),
  attachment_url: Joi.object().required(),
  payment_type: Joi.string().valid("cash", "card", "upi", "credit").required(),
  notes: Joi.string().allow("", null),
  
  // array of items
  items: Joi.array()
    .items(
      Joi.object({
        id: Joi.string().required(),
        name: Joi.string().required(),
        qty: Joi.number().min(1).required(),
        unit: Joi.string().max(50).required(),
        purchase_price: Joi.number().precision(2).min(0).required(),
        selling_price: Joi.number().precision(2).min(0),
        gst_tax: Joi.number().min(0),
        total_price: Joi.number().precision(2).min(0).required(),
      })
    )
    .min(1)
    .required(),
});

const expense_data = Joi.object({
  zodu_id: Joi.string().max(50).required(),
  branch_id: Joi.string().max(50).required(),
  category: Joi.string().max(100).required(),
  expense_date: Joi.date().required(),
  expense_name:Joi.string().required(),
  // purchase_type: Joi.string().max(100).required(),
  total_amount: Joi.number().precision(2).min(0).required(),
  paid_amount: Joi.number().precision(2).min(0).required(),
  attachment_url: Joi.object().required(),
  // payment_type: Joi.string().valid("cash", "card", "upi", "credit").required(),
  description: Joi.string().allow("", null),
  
  // array of items
  items: Joi.array()
    .items(
      Joi.object({
        id: Joi.string().required(),
        name: Joi.string().required(),
        qty: Joi.number().min(1).required(),
        purchase_price: Joi.number().precision(2).min(0).required(),
      })
    )
    .min(1)
    .required(),
});

const vendor_create = Joi.object({
  zodu_id: Joi.string().max(50).required().messages({
    "string.base": "Zodu ID must be a string",
    "any.required": "Zodu ID is required",
  }),

  branch_id: Joi.string().max(50).required().messages({
    "string.base": "Branch ID must be a string",
    "any.required": "Branch ID is required",
  }),

  vendor_name: Joi.string().max(150).required().messages({
    "string.base": "Vendor name must be a string",
    "any.required": "Vendor name is required",
  }),

  vendor_phone: Joi.string()
    .pattern(/^[0-9]{10}$/)
    .required()
    .messages({
      "string.pattern.base": "Vendor phone must be a valid 10-digit number",
      "any.required": "Vendor phone is required",
    }),

  vendor_email: Joi.string()
    .email({ tlds: { allow: false } })
    .required()
    .messages({
      "string.email": "Vendor email must be a valid email address",
      "any.required": "Vendor email is required",
    }),

  vendor_address: Joi.string().max(255).required().messages({
    "string.base": "Vendor address must be a string",
    "any.required": "Vendor address is required",
  }),

  company_name: Joi.string().max(150).required().messages({
    "string.base": "Company name must be a string",
    "any.required": "Company name is required",
  }),
});

 const reportSchema = Joi.object({
    zodu_id: Joi.string().required(),
    branch_id: Joi.string().required(),
    type: Joi.string()
      .valid("order", "expense", "inventory", "purchase")
      .required(),
    filter: Joi.string()
      .valid("daily", "weekly", "monthly", "yearly", "custom",)
      .default("daily"),
    wiseData: Joi.string().valid("item","category","date").default("normal"),
    start_date: Joi.date().optional(),
    end_date: Joi.date().optional(),
  });

  const Inventory = Joi.object({
    zodu_id: Joi.string().required(),
    branch_id: Joi.string().required(),
      category: Joi.string().max(100).required(),

    item_name: Joi.string().max(50).required(),
    item_unit: Joi.string().required(),
     stock_qty: Joi.number().required(),
        stock_alert: Joi.number().required(),
        purchase_price: Joi.number().required(),
        last_purchase_date: Joi.date().required(),
  })

  const holdSchema = Joi.object({
  zodu_id: Joi.string().max(100).required(),
  branch_id: Joi.string().max(100).required(),
  orderType: Joi.string().max(100).required(),
  table_no: Joi.string().max(20).allow(null, ""),
  customerName: Joi.string().max(150).allow(null, ""),
  customerPhone: Joi.string().max(13).allow(null, ""),
  items: Joi.array()
    .items(
      Joi.object({
        item_name: Joi.string().max(100).required(),
        item_id: Joi.string().max(100).required(),
        item_unit: Joi.string().max(20).allow(null, ""),
        qty: Joi.number().precision(2).min(0).required(),
        price: Joi.number().precision(2).min(0).required(),
        variant_name: Joi.string().max(100).allow(null, ""),
        variant_id: Joi.string().max(100).allow(null, "")
      })
    )
    .min(1)
    .required()
});


module.exports = {
  company_create,
  branch_create,
  menu_item_create,
  update_company,
  order_create,
  purchase_order_create,
  vendor_create,
  expense_data,
  inventorySchema,
  reportSchema,
  Inventory,
  holdSchema
};
