const Joi = require("joi");

const tenant = {
  zodu_id: Joi.string().max(50).required(),
  branch_id: Joi.string().max(50).required(),
};

const nullableId = Joi.number().integer().positive().allow(null);

const printer = Joi.object({
  ...tenant,
  printer_name: Joi.string().trim().max(60).required(),
  connection_type: Joi.string().valid("LAN", "USB", "BLUETOOTH").required(),
  ip_address: Joi.when("connection_type", {
    is: "LAN",
    then: Joi.string().trim().ip({ version: ["ipv4", "ipv6"] }).required(),
    otherwise: Joi.string().allow(null, "").optional(),
  }),
  port: Joi.number().integer().min(1).max(65535).default(9100),
  device_name: Joi.when("connection_type", {
    is: "LAN",
    then: Joi.string().allow(null, "").optional(),
    otherwise: Joi.string().trim().max(120).required(),
  }),
  paper_size: Joi.string().valid("2", "3").default("3"),
  cut_mode: Joi.string().valid("partial", "full", "none").default("partial"),
  role: Joi.string().valid("kot_counter", "billing", "both").default("kot_counter"),
  active: Joi.boolean().default(true),
}).options({ abortEarly: false });

// `counter_name` is the only thing the bulk-assign modal sends when it adds a
// counter, so everything else defaults.
const counterCreate = Joi.object({
  ...tenant,
  counter_name: Joi.string().trim().max(40).required(),
  printer_id: nullableId.default(null),
  print_billing_copy: Joi.boolean().default(false),
  is_default: Joi.boolean().default(false),
  active: Joi.boolean().default(true),
}).options({ abortEarly: false });

const counterUpdate = Joi.object({
  ...tenant,
  counter_name: Joi.string().trim().max(40).required(),
  printer_id: nullableId.default(null),
  print_billing_copy: Joi.boolean().required(),
  is_default: Joi.boolean().optional(),
  active: Joi.boolean().required(),
}).options({ abortEarly: false });

const assignItems = Joi.object({
  ...tenant,
  kot_counter_id: Joi.number().integer().positive().required(),
  menu_item_ids: Joi.array().items(Joi.string().max(100)).required(),
}).options({ abortEarly: false });

const itemRouting = Joi.object({
  ...tenant,
  menu_id: Joi.string().max(100).required(),
  kot_counter_id: nullableId.required(),
  fallback_counter_id: nullableId.default(null),
}).options({ abortEarly: false });

const settings = Joi.object({
  ...tenant,
  kot_printing_enabled: Joi.boolean().required(),
  default_counter_id: nullableId.default(null),
  billing_printer_id: nullableId.default(null),
  print_all_at_billing: Joi.boolean().required(),
  billing_copy_mode: Joi.string().valid("consolidated", "per_counter").required(),
  max_retries: Joi.number().integer().min(0).max(5).default(1),
}).options({ abortEarly: false });

const printLog = Joi.object({
  ...tenant,
  entries: Joi.array().min(1).max(200).items(Joi.object({
    ticket_id: Joi.number().integer().positive().required(),
    printer_id: nullableId.default(null),
    printer_name: Joi.string().max(60).allow(null, ""),
    target: Joi.string().valid("counter", "fallback", "billing").required(),
    status: Joi.string().valid("success", "failed", "reprinted").required(),
    attempts: Joi.number().integer().min(1).max(20).default(1),
    error: Joi.string().max(500).allow(null, ""),
  })).required(),
}).options({ abortEarly: false });

module.exports = { printer, counterCreate, counterUpdate, assignItems, itemRouting, settings, printLog };
