const Joi = require("joi");

const itemSchema = Joi.object({
  menu_id: Joi.string().max(100).required(),
  name: Joi.string().max(200).required(),
  qty: Joi.number().precision(2).min(0).required(),
  price: Joi.number().precision(2).min(0).required(),
  tax: Joi.number().precision(2).min(0).default(0),
  cgst: Joi.number().precision(2).min(0).default(0),
  sgst: Joi.number().precision(2).min(0).default(0),
  tax_inclusive: Joi.boolean().default(false),
  menu_unit: Joi.string().max(50).optional().allow(null, ""),
  variant_name: Joi.string().max(100).optional().allow(null, ""),
  variant_id: Joi.string().max(100).optional().allow(null, ""),
  gst_percentage: Joi.number().precision(2).min(0).default(0),
});

const order_create = Joi.object({
  zodu_id: Joi.string().max(50).required(),
  branch_id: Joi.string().max(50).required(),
  table_no: Joi.number().integer().allow(null, ""),
  kot_no: Joi.string().allow(null, ""),
  no_of_items: Joi.number().integer().required(),
  order_type: Joi.string().valid("Dine-In", "Takeaway", "Delivery").required(),
  payment_type: Joi.string().allow(null, ""),
  customer_name: Joi.string().max(100).allow(null, ""),
  customer_phone: Joi.string().pattern(/^[0-9]{7,15}$/).allow(null, ""),
  subtotal: Joi.number().precision(2).min(0).default(0),
  tax_amount: Joi.number().precision(2).min(0).default(0),
  total_amt: Joi.number().precision(2).min(0).required(),
  discount_type: Joi.string().valid("PERCENT", "FLAT", "Percent", "Amount").allow(null, ""),
  discount_value: Joi.number().precision(2).min(0).allow(null),
  discount_amount: Joi.number().precision(2).min(0).default(0),
  items: Joi.array().items(itemSchema).min(1).required(),
  final_payment: Joi.boolean().required(),
  order_date: Joi.alternatives().try(
    Joi.date().iso(),
    Joi.string().pattern(/^\d{2}-\d{2}-\d{4}$/)
  ).required(),
  order_time: Joi.alternatives().try(
    Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/),
    Joi.string().pattern(/^(0?[1-9]|1[0-2]):[0-5][0-9]\s?(AM|PM|am|pm)$/)
  ).required(),
}).options({ abortEarly: false });

const order_update = Joi.object({
  zodu_id: Joi.string().max(50).required(),
  branch_id: Joi.string().max(50).required(),
  api_order_id: Joi.string().max(100).required(),
  table_no: Joi.number().integer().allow(null, ""),
  kot_no: Joi.string().allow(null, ""),
  no_of_items: Joi.number().integer().required(),
  order_type: Joi.string().valid("Dine-In").required(),
  payment_type: Joi.string().allow(null, ""),
  customer_name: Joi.string().max(100).allow(null, ""),
  customer_phone: Joi.string().pattern(/^[0-9]{7,15}$/).allow(null, ""),
  subtotal: Joi.number().precision(2).min(0).default(0),
  tax_amount: Joi.number().precision(2).min(0).default(0),
  total_amt: Joi.number().precision(2).min(0).required(),
  discount_type: Joi.string().valid("PERCENT", "FLAT", "Percent", "Amount").allow(null, ""),
  discount_value: Joi.number().precision(2).min(0).allow(null),
  discount_amount: Joi.number().precision(2).min(0).default(0),
  items: Joi.array().items(itemSchema).min(1).required(),
  final_payment: Joi.boolean().required(),
  order_date: Joi.alternatives().try(
    Joi.date().iso(),
    Joi.string().pattern(/^\d{2}-\d{2}-\d{4}$/)
  ).required(),
  order_time: Joi.alternatives().try(
    Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/),
    Joi.string().pattern(/^(0?[1-9]|1[0-2]):[0-5][0-9]\s?(AM|PM|am|pm)$/)
  ).required(),
}).options({ abortEarly: false });

module.exports = { order_create, order_update, itemSchema };
