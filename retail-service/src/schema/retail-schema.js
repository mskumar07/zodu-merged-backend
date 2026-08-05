// validators/company.schema.js
const Joi = require("joi");

const company_create = Joi.object({
  zodu_id: Joi.required(),
  restaurant_name: Joi.string().min(2).max(255).required(),
  owner_admin_name: Joi.string().max(100).allow(null, ''),
  mobile_no: Joi.string().pattern(/^[0-9]{10,15}$/).required(),
  mail_id: Joi.string().email().max(100).required(),
  gst_no: Joi.string().max(50).allow(null, ''),
  pincode: Joi.string().pattern(/^[0-9]{5,10}$/).allow(null, ''),
  city: Joi.string().max(50).allow(null, ''),
  district: Joi.string().max(50).allow(null, ''),
  state: Joi.string().max(50).allow(null, ''),
  address_line_1: Joi.string().max(100).allow(null, ''),
  address_line_2: Joi.string().max(100).allow(null, ''),
  bank_name: Joi.string().max(100).allow(null, ''),
  bank_branch: Joi.string().max(100).allow(null, ''),
  holder_name: Joi.string().max(100).allow(null, ''),
  account_number: Joi.string().max(30).allow(null, ''),
  account_type: Joi.string().allow(null, ''),
  ifsc_code: Joi.string().max(20).allow(null, ''),
  can_use_for_branch: Joi.boolean().default(true),
});

const update_company = Joi.object({
  restaurant_name: Joi.string().min(2).max(255),
  owner_admin_name: Joi.string().max(100).allow(null, ''),
  mobile_no: Joi.string().pattern(/^[0-9]{10,15}$/),
  mail_id: Joi.string().email().max(100),
  gst_no: Joi.string().max(50).allow(null, ''),
  type: Joi.string().max(50).allow(null, ''),
  pincode: Joi.string().pattern(/^[0-9]{5,10}$/).allow(null, ''),
  city: Joi.string().max(50).allow(null, ''),
  district: Joi.string().max(50).allow(null, ''),
  state: Joi.string().max(50).allow(null, ''),
  address_line_1: Joi.string().max(100).allow(null, ''),
  address_line_2: Joi.string().max(100).allow(null, ''),
  bank_name: Joi.string().max(100).allow(null, ''),
  bank_branch: Joi.string().max(100).allow(null, ''),
  holder_name: Joi.string().max(100).allow(null, ''),
  account_number: Joi.string().max(30).allow(null, ''),
  account_type: Joi.string().allow(null, ''),
  ifsc_code: Joi.string().max(20).allow(null, ''),
  can_use_for_branch: Joi.boolean(),
}).min(1);

const branch_create = Joi.object({
  zodu_id: Joi.required(),
  branch_name: Joi.string().max(100).required(),
  branch_manager_or_admin: Joi.string().max(100).allow(null, ''),
  branch_mobile_no: Joi.string().pattern(/^[0-9]{10,15}$/).required(),
  branch_mail_id: Joi.string().email().max(100).required(),
  branch_city: Joi.string().max(50).required(),
  branch_pincode: Joi.string().pattern(/^[0-9]{5,10}$/).required(),
  branch_district: Joi.string().max(50).required(),
  branch_state: Joi.string().max(50).required(),
  branch_image: Joi.string().uri().allow(null, ''),
  opening_hours: Joi.array().items(
    Joi.object({
      day: Joi.string().required(),
      open: Joi.string().required(),
      close: Joi.string().required(),
    })
  ).allow(null),
  // Option 1: Reuse company address/bank via IDs
  address_id: Joi.string(),
  bank_details_id: Joi.string(),
  // Option 2: New address for branch
  address_line_1: Joi.string().max(100),
  address_line_2: Joi.string().max(100).allow(null, ''),
  // Option 3: New bank details for branch
  bank_name: Joi.string().max(100).allow(null, ''),
  bank_branch: Joi.string().max(100).allow(null, ''),
  holder_name: Joi.string().max(100).allow(null, ''),
  account_number: Joi.string().max(30),
  account_type: Joi.string().max(20),
  ifsc_code: Joi.string().max(20),
})
  .custom((value, helpers) => {
    if (!value.address_id && !value.address_line_1) {
      return helpers.error('any.required');
    }
    return value;
  }, 'Address validation: Either address_id OR address_line_1 required')
  .custom((value, helpers) => {
    const hasBankId = value.bank_details_id;
    const hasBankFields = value.account_number && value.account_type && value.ifsc_code;
    if (!hasBankId && !hasBankFields) {
      return helpers.error('any.required');
    }
    return value;
  }, 'Bank validation: Either bank_details_id OR (account_number + account_type + ifsc_code) required');

const update_branch = Joi.object({
  branch_name: Joi.string().max(100),
  branch_manager_or_admin: Joi.string().max(100).allow(null, ''),
  branch_mobile_no: Joi.string().pattern(/^[0-9]{10,15}$/),
  branch_mail_id: Joi.string().email().max(100),
  branch_city: Joi.string().max(50),
  branch_pincode: Joi.string().pattern(/^[0-9]{5,10}$/),
  branch_district: Joi.string().max(50),
  branch_state: Joi.string().max(50),
  branch_image: Joi.string().uri().allow(null, ''),
  opening_hours: Joi.array().items(
    Joi.object({
      day: Joi.string().required(),
      open: Joi.string().required(),
      close: Joi.string().required(),
    })
  ).allow(null),
  // Option 1: Switch to company address/bank via IDs
  address_id: Joi.string(),
  bank_details_id: Joi.string(),
  // Option 2: Update branch address
  address_line_1: Joi.string().max(100),
  address_line_2: Joi.string().max(100).allow(null, ''),
  // Option 3: Update branch bank details
  bank_name: Joi.string().max(100).allow(null, ''),
  bank_branch: Joi.string().max(100).allow(null, ''),
  holder_name: Joi.string().max(100).allow(null, ''),
  account_number: Joi.string().max(30),
  account_type: Joi.string().max(20),
  ifsc_code: Joi.string().max(20),
  use_same_address_as_company: Joi.boolean(),
  use_same_bank_as_company: Joi.boolean(),
}).min(1);

const product_create = Joi.object({
  zodu_id: Joi.string().required(),
  branch_id: Joi.string().required(),

  item_type: Joi.string().required(),
  item_name: Joi.string().required(),

  category_id: Joi.string().allow(null),

  sku: Joi.string().allow(null),
  barcode: Joi.string().allow(null),

  hsn_code: Joi.string().allow(null),
  unit: Joi.string().allow(null),

  mrp: Joi.number().allow(null),
  sell_price: Joi.number().allow(null),
  cost_price: Joi.number().allow(null),

  gst_percentage: Joi.number().allow(null),

  status: Joi.string().default("active")
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
  qty: Joi.number().precision(2).required(),
  price: Joi.number().precision(2).min(0).required(),
  image: Joi.string().allow(null, ''),
  tax: Joi.number().precision(2).min(0).required(),
  tax_inclusive: Joi.boolean().required(),
  menu_unit: Joi.string().max(50).optional(),
  variant_name: Joi.string().max(100).optional().allow(null, ''),
  variant_id: Joi.string().max(100).optional().allow(null, ''),
});
// order schema
const order_create = Joi.object({
  zodu_id: Joi.string().required(),

  branch_id: Joi.string().required(),

  sale_type: Joi.string().optional().allow(null, ""),

  customer_id: Joi.string().uuid().optional().allow(null, ""),

  customer_name: Joi.string().optional().allow(null, ""),

  customer_phone: Joi.string()
    .pattern(/^[0-9]{10}$/)
    .optional()
    .allow(null, ""),

  sale_date: Joi.date().iso().optional(),

sale_time: Joi.string()
  .pattern(/^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/) // HH:mm:ss
  .optional()
  .allow(null, ""),

  discount_type: Joi.string()
    .valid("percentage", "flat")
    .optional()
    .allow(null, ""),

  discount_value: Joi.number().min(0).default(0),

  paid_amount: Joi.number().min(0).optional().allow(null),

  payment_mode: Joi.string().optional().allow(null, ""),

  transaction_id: Joi.string().optional().allow(null, ""),

  notes: Joi.string().optional().allow(null, ""),

  discount_gst_mode: Joi.string().optional().allow(null, ""),

  round_off: Joi.number().precision(2).optional().allow(null),

  due_date: Joi.date().iso().optional().allow(null, ""),

  items: Joi.array()
    .items(
      Joi.object({
        // 🔥 FIXED 
        item_uuid: Joi.string().required(),
        item_id: Joi.string().required(),

        item_name: Joi.string().optional().allow(null, ""),

        variant_id: Joi.string().optional().allow(null, ""),

        variant_name: Joi.string().optional().allow(null, ""),

        unit: Joi.string().optional().allow(null, ""),

        quantity: Joi.number().positive().required(),

        price: Joi.number().min(0).required(),

        discount: Joi.number().min(0).default(0),
        discount_percentage: Joi.number().min(0).max(100).optional().allow(null),

        gst_percentage: Joi.number().min(0).max(100).default(0),
        hsn_code: Joi.string().optional().allow(null, ""),
        mrp: Joi.number().optional().allow(null, ""),

        tax_inclusive: Joi.boolean().default(false),
      })
    )
    .min(1)
    .required(),
})
  // 🔥 CONDITIONAL VALIDATION
  .custom((value, helpers) => {
    if (value.discount_type === "percentage" && value.discount_value > 100) {
      return helpers.error("any.invalid");
    }
    return value;
  }, "Discount validation");

  const order_update = Joi.object({

  // ✅ REQUIRED (for update)
  sale_uuid: Joi.string()
    .required(),

  zodu_id: Joi.string().max(50).required(),
  branch_id: Joi.string().max(50).required(),

  sale_type: Joi.string()
    .valid("retail", "credit",'quotation')
    .required(),

  sale_date: Joi.date().required(),

  sale_time: Joi.string()
    .pattern(/^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/) // HH:mm:ss
    .optional()
    .allow(null, ""),

  customer_id: Joi.string()
    .guid({ version: ["uuidv4", "uuidv5"] })
    .allow(null),

  discount_type: Joi.string()
    .valid("percentage", "flat", null)
    .allow(null),

  discount_value: Joi.number()
    .min(0)
    .default(0),

  paid_amount: Joi.number()
    .min(0)
    .default(0),

  payment_mode: Joi.string().optional().allow(null, ""),


    discount_gst_mode: Joi.string().optional().allow(null, ""),

  roundoff: Joi.number().precision(2).optional().allow(null),

  transaction_id: Joi.string()
    .allow(null, ""),

  notes: Joi.string()
    .allow(null, ""),
  due_date: Joi.date().iso().optional().allow(null, ""),

  // ✅ ITEMS (VERY IMPORTANT)
  items: Joi.array()
    .items(
      Joi.object({
        item_uuid: Joi.string()
          .required(),

        item_id: Joi.string().required(),
        item_name: Joi.string().required(),

        unit: Joi.string().default("NOS"),

        quantity: Joi.number()
          .integer()
          .min(1)
          .required(),

        price: Joi.number()
          .min(0)
          .required(),

        discount: Joi.number()
          .min(0)
          .default(0),

        discount_percentage: Joi.number()
          .min(0)
          .max(100)
          .optional()
          .allow(null),

        gst_percentage: Joi.number()
          .min(0)
          .required(),

        hsn_code: Joi.string()
          .allow(null, ""),

        mrp: Joi.number()
          .min(0)
          .default(0),

        tax_inclusive: Joi.boolean()
          .default(false),
      })
    )
    .min(1)
    .required(),
});

const add_customer = Joi.object({
  zodu_id:   Joi.string().required(),
  branch_id: Joi.string().required(),
 
  // at least one of cust_name or cpy_name is required
  cust_name: Joi.string().optional().allow(null, ""),
  cpy_name:  Joi.string().optional().allow(null, ""),
 
  // jsonb arrays — accept array of strings or single string
  mobile_no: Joi.alternatives()
    .try(
      Joi.array().items(Joi.string().pattern(/^[0-9]{10}$/)).min(1),
      Joi.string().pattern(/^[0-9]{10}$/)
    )
    .optional(),
 
  email_id: Joi.alternatives()
    .try(
      Joi.array().items(Joi.string().email({ tlds: false })),
      Joi.string().email({ tlds: false })
    )
    .optional(),
 
  gst:          Joi.string().optional().allow(null, ""),
  address_line1: Joi.string().optional().allow(null, ""),
  address_line2: Joi.string().optional().allow(null, ""),
  city:         Joi.string().optional().allow(null, ""),
  state:        Joi.string().optional().allow(null, ""),
  pincode: Joi.string().pattern(/^[0-9]{6}$/).optional().allow(null, ""),
  same_as_billing_address: Joi.boolean().required().default(false),
  shipping_address: Joi.string().optional().allow(null, ""),
})
.custom((value, helpers) => {
  if (!value.cust_name && !value.cpy_name) {
    return helpers.error("any.invalid", { message: "Either cust_name or cpy_name is required" });
  }
  return value;
}, "Name validation");

 
// ── Mark Payment ─────────────────────────────────────────────
const mark_payment = Joi.object({
  zodu_id:          Joi.string().required(),
  branch_id:        Joi.string().required(),
  sale_id:          Joi.string().required(),
  paid_amount:      Joi.number().positive().required(),
  transaction_type: Joi.string().valid("Cash", "Card", "UPI", "Credit").required(),
  transaction_id:   Joi.string().optional().allow(null, ""),
  payment_date:    Joi.date().iso().optional().allow(null, ""),
});

// ── Mark Payment — multiple bills, one payment (customer ledger modal) ──
const mark_customer_payment = Joi.object({
  zodu_id:      Joi.string().required(),
  branch_id:    Joi.string().required(),
  cust_uuid:    Joi.string().required(),
  payment_date: Joi.date().iso().required(),
  payment_mode: Joi.string().valid("Cash", "Card", "UPI", "Bank Transfer", "Cheque", "Credit").required(),
  reference_no: Joi.string().optional().allow(null, ""),
  total_payment: Joi.number().positive().required(),
  bills: Joi.array()
    .items(
      Joi.object({
        sale_id: Joi.string().required(),
      })
    )
    .min(1)
    .required(),
});

// Rejects any string containing < or > so HTML/script tags can never be
// stored (e.g. purchase notes rendered unescaped elsewhere would otherwise
// be a stored-XSS vector). Plain punctuation, numbers, and text pass through.
const NO_HTML_PATTERN = /^[^<>]*$/;
const notesField = Joi.string()
  .max(1000)
  .pattern(NO_HTML_PATTERN)
  .messages({ "string.pattern.base": "Notes cannot contain HTML tags (< or >)" })
  .allow("", null);

const purchaseItemSchema = Joi.object({
  item_id: Joi.string().max(100).required(),
  item_uuid: Joi.string().allow(null, ""),
  item_name: Joi.string().max(200).allow(null, ""),
  qty: Joi.number().positive().required(),
  unit: Joi.string().max(50).allow(null, ""),
  unit_id: Joi.number().allow(null),
  purchase_price: Joi.number().precision(2).min(0).required(),
  gst_percentage: Joi.number().min(0).max(100).allow(null),
  tax_amount: Joi.number().min(0).allow(null),
  cgst: Joi.number().min(0).allow(null),
  sgst: Joi.number().min(0).allow(null),
  category_id: Joi.number().allow(null),
});

const purchase_order_create = Joi.object({
  zodu_id: Joi.string().max(50).required(),
  branch_id: Joi.string().max(50).required(),
  vendor_id: Joi.string().max(50).allow(null, ""),
  purchase_date: Joi.date().required(),
  due_date: Joi.date().allow(null, ""),
  total_amount: Joi.number().precision(2).min(0).required(),
  paid_amount: Joi.number().precision(2).min(0).default(0),
  payment_status: Joi.string().valid("pending", "partial", "paid").optional(),
  payment_date: Joi.date().allow(null, ""),
  transaction_type: Joi.string().max(50).allow(null, ""),
  transaction_id: Joi.string().max(100).allow(null, ""),
  attachment_url: Joi.array().items(Joi.object()).optional(),
  notes: notesField,
  invoice_bill_no: Joi.string().max(100).optional().allow(null, ""),
  items: Joi.array().items(purchaseItemSchema).min(1).required(),
});

const purchase_order_update = Joi.object({
  zodu_id: Joi.string().max(50).optional(),
  branch_id: Joi.string().max(50).optional(),
  vendor_id: Joi.string().max(50).allow(null, ""),
  purchase_date: Joi.date().optional(),
  due_date: Joi.date().allow(null, ""),
  total_amount: Joi.number().precision(2).min(0).optional(),
  paid_amount: Joi.number().precision(2).min(0).optional(),
  payment_status: Joi.string().valid("pending", "partial", "paid").optional(),
  payment_date: Joi.date().allow(null, ""),
  transaction_type: Joi.string().max(50).allow(null, ""),
  transaction_id: Joi.string().max(100).allow(null, ""),
  attachment_url: Joi.array().items(Joi.object()).optional(),
  notes: notesField,
  invoice_bill_no: Joi.string().max(100).optional().allow(null, ""),
  items: Joi.array().items(purchaseItemSchema).min(1).optional(),
});

const expense_data = Joi.object({
  zodu_id: Joi.string().max(50).required(),
  branch_id: Joi.string().max(50).required(),
  category: Joi.number().required(),
  expense_date: Joi.date().required(),
  total_amount: Joi.number().precision(2).min(0).required(),
  paid_amount: Joi.number().precision(2).min(0).required(),
  attachment_url: Joi.array().optional().allow(null),
  payment_type: Joi.string().allow(null, ""),
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

const expense_data_update = Joi.object({
  zodu_id: Joi.string().max(50).optional(),
  branch_id: Joi.string().max(50).optional(),
  expense_id: Joi.string().max(100).required(),
  category: Joi.number().optional(),
  expense_date: Joi.date().optional(),
  total_amount: Joi.number().precision(2).min(0).optional(),
  paid_amount: Joi.number().precision(2).min(0).optional(),
  attachment_url: Joi.array().optional().allow(null),
  payment_type: Joi.string().optional(),
  description: Joi.string().allow("", null).optional(),

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
    .optional(),
});

const expense_item = Joi.object({
  name:Joi.string().max(100).required(),
  branch_id:Joi.string().max(100).required(),
  zodu_id:Joi.string().max(100).required(),
})

const vendor_create = Joi.object({
  zodu_id: Joi.string().max(50).required(),
  branch_id: Joi.string().max(50).required(),
  vendor_name: Joi.string().max(150).required(),
  vendor_phone: Joi.string()
    .pattern(/^[0-9]{10}$/)
    .required(),
  vendor_email: Joi.string()
    .email({ tlds: { allow: false } })
    .required(),
  vendor_address: Joi.string().max(255).required(),
  company_name: Joi.string().max(150).required(),
});

const edit_vendor_create = Joi.object({
 
  vendor_id: Joi.string().max(50).required(),
  vendor_name: Joi.string().max(150).optional(),
  vendor_phone: Joi.string()
    .pattern(/^[0-9]{10}$/)
    .optional(),
  vendor_email: Joi.string()
    .email({ tlds: { allow: false } })
    .optional(),
  vendor_address: Joi.string().max(255).optional(),
  company_name: Joi.string().max(150).optional(),
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
  wiseData: Joi.string().valid("item", "category", "date").default("normal"),
  start_date: Joi.date().optional(),
  end_date: Joi.date().optional(),
});

const Inventory = Joi.object({
  zodu_id: Joi.string().required(),
  branch_id: Joi.string().required(),
  category_id: Joi.number().required(),
  inventory_type:Joi.string().required(),
  item_name: Joi.string().max(50).required(),
  item_unit: Joi.number().required(),
  stock_qty: Joi.number().optional(),
  stock_alert: Joi.number().optional(),
  purchase_price: Joi.number().required(),
  // last_purchase_date: Joi.date().required(),
})

const holdSchema = Joi.object({
  zodu_id:         Joi.string().max(50).required(),
  branch_id:       Joi.string().max(50).required(),
  order_type:      Joi.string().valid("SALE", "QUOTATION").required(),
  table_no:        Joi.string().max(20).allow(null, ""),
  notes:           Joi.string().allow(null, ""),

  // customer
  customer_uuid:   Joi.string().uuid().allow(null),
  customer_name:   Joi.string().max(150).allow(null, ""),
  customer_phone:  Joi.string().max(15).allow(null, ""),

  // financials
  total_items:     Joi.number().integer().min(0).required(),
  subtotal:        Joi.number().precision(2).min(0).required(),
  total_tax:       Joi.number().precision(2).min(0).default(0),
  discount_type:   Joi.string().valid("percentage", "flat").allow(null, ""),
  discount_value:  Joi.number().precision(2).min(0).default(0),
  discount_amount: Joi.number().precision(2).min(0).default(0),
  round_off:       Joi.number().precision(2).default(0),
  total_amount:    Joi.number().precision(2).min(0).required(),

  items: Joi.array().items(
    Joi.object({
      item_uuid:      Joi.string().allow(null, ""),
      item_id:        Joi.string().max(100).required(),
      item_name:      Joi.string().max(255).required(),
      variant_id:     Joi.string().max(100).allow(null, ""),
      variant_name:   Joi.string().max(100).allow(null, ""),
      unit:           Joi.string().max(20).allow(null, ""),
      quantity:       Joi.number().precision(2).min(0).required(),
      price:          Joi.number().precision(2).min(0).required(),
      mrp:            Joi.number().precision(2).min(0).allow(null),
      discount:       Joi.number().precision(2).min(0).default(0),
      hsn_code:       Joi.string().max(20).allow(null, ""),
      gst_percentage: Joi.number().precision(2).min(0).default(0),
      tax_amount:     Joi.number().precision(2).min(0).default(0),
      cgst:           Joi.number().precision(2).min(0).default(0),
      sgst:           Joi.number().precision(2).min(0).default(0),
      tax_inclusive:  Joi.boolean().default(false),
    })
  ).min(1).required(),
});


const sales_history_query = Joi.object({
  zodu_id:         Joi.string().required(),
  branch_id:       Joi.string().required(),
  from_date:       Joi.string().isoDate().optional(),
  to_date:         Joi.string().isoDate().optional(),
  payment_status:  Joi.string().valid("fully_paid", "partially_paid", "unpaid").optional(),
  sale_type:       Joi.string().optional(),
  customer_phone:  Joi.string().optional(),
  invoice_no:      Joi.string().optional(),
  search: Joi.string().optional(),
  cancelled_order:       Joi.boolean().required(),
  page:            Joi.number().integer().min(1).optional().default(1),
  limit:           Joi.number().integer().min(1).max(100).optional().default(20),
});
 
const sales_history_summary_query = Joi.object({
  zodu_id:        Joi.string().required(),
  branch_id:      Joi.string().required(),
  from_date:      Joi.string().isoDate().optional(),
  to_date: Joi.string().isoDate().optional(),
  cancelled_order: Joi.boolean().required(),
  payment_status: Joi.string().valid("fully_paid", "partially_paid", "unpaid").optional(),
  search:         Joi.string().optional(),
});

const sale_by_id_params = Joi.object({
  sale_id:   Joi.string().required(),
  zodu_id:   Joi.string().required(),
  branch_id: Joi.string().required(),
});

const get_customers = Joi.object({
  zodu_id:   Joi.string().required(),
  branch_id: Joi.string().required(),
  search:    Joi.string().optional().allow("", null),
  page:      Joi.number().integer().min(1).default(1),
  limit:     Joi.number().integer().min(1).max(100).default(20),
});
 
const get_customer_by_id = Joi.object({
  cust_uuid: Joi.string().uuid().required(),
});

const update_customer = Joi.object({
  cust_uuid: Joi.string().uuid().required(),
  cust_name: Joi.string().optional().allow(null, ""),
  cpy_name:  Joi.string().optional().allow(null, ""),
  zodu_id:   Joi.string().optional(),
    branch_id: Joi.string().optional(),
  mobile_no: Joi.alternatives()
    .try(
      Joi.array().items(Joi.string().pattern(/^[0-9]{10}$/)).min(1),
      Joi.string().pattern(/^[0-9]{10}$/)
    )
    .optional(),
  email_id: Joi.alternatives()
    .try(
      Joi.array().items(Joi.string().email({ tlds: false })),
      Joi.string().email({ tlds: false })
    )
    .optional(),
  gst:          Joi.string().optional().allow(null, ""),
  address_line1: Joi.string().optional().allow(null, ""),
  address_line2: Joi.string().optional().allow(null, ""),
  city:         Joi.string().optional().allow(null, ""),
  state:        Joi.string().optional().allow(null, ""),
  shipping_address: Joi.string().optional().allow(null, ""),
  same_as_billing_address: Joi.boolean().required().default(false),
  pincode: Joi.string().pattern(/^[0-9]{6}$/).optional().allow(null, ""),
});

const check_category_name = Joi.object({
  zodu_id:       Joi.string().required(),
  branch_id:     Joi.string().required(),
  category_name: Joi.string().trim().min(1).max(255).required(),
});

const createSchema = Joi.object({
  zodu_id:        Joi.string().required(),
  branch_id:      Joi.string().required(),
  item_id:        Joi.string().max(100).required(),
  item_type:      Joi.string().valid("product", "service", "S", "P").required(),
  item_name:      Joi.string().trim().max(255).required(),
  category_id:    Joi.number().integer().allow(null).default(null),
  unit:           Joi.number().integer().allow(null).default(null),
  mrp:            Joi.number().min(0).allow(null).default(null),
  sell_price:     Joi.number().min(0).allow(null).default(null),
  purchase_price: Joi.number().min(0).allow(null).default(null),
  gst_type:       Joi.number().integer().allow(null).default(null),
  tax_incl_type:  Joi.boolean().default(false),
  sku:            Joi.string().max(100).allow(null, "").default(null),
  barcode:        Joi.string().max(100).allow(null, "").default(null),
  hsn_code:       Joi.string().max(20).allow(null, "").default(null),
  item_img:       Joi.string().allow(null, "").default(null),
  status:         Joi.string().valid("active", "inactive").default("active"),
    opening_stock:  Joi.number().min(0).allow(null).default(0),
  reorder_level:  Joi.number().min(0).allow(null).default(0),
});
 
const editSchema = Joi.object({
  item_id: Joi.string().max(100),
  item_name:      Joi.string().trim().max(255),
  item_type:      Joi.string().valid("product", "service", "S", "P"),
  category_id:    Joi.number().integer().allow(null),
  unit:           Joi.number().integer().allow(null),
  mrp:            Joi.number().min(0).allow(null),
  sell_price:     Joi.number().min(0).allow(null),
  purchase_price: Joi.number().min(0).allow(null),
  gst_type:       Joi.number().integer().allow(null),
  tax_incl_type:  Joi.boolean(),
  sku:            Joi.string().max(100).allow(null, ""),
  barcode:        Joi.string().max(100).allow(null, ""),
  hsn_code:       Joi.string().max(20).allow(null, ""),
  item_img:       Joi.string().allow(null, ""),
  status:         Joi.string().valid("active", "inactive"),
    opening_stock:  Joi.number().min(0).allow(null),reorder_level:  Joi.number().min(0).allow(null),
}).min(1); // at least one field required for edit
 
const ledgerSchema = Joi.object({
  // Path param
  custUuid: Joi.string().uuid({ version: 'uuidv4' }).required(),
 
  // Query params
  fromDate: Joi.string().isoDate().optional(),
  toDate:   Joi.string().isoDate().optional(),
  method:   Joi.string()
               .valid('cash', 'upi', 'card', 'bank transfer', 'store credit', 'all')
               .default('all'),
  page:     Joi.number().integer().min(1).default(1),
  limit:    Joi.number().integer().min(1).max(100).default(20),
}).options({ allowUnknown: true });

module.exports = {
  check_category_name,
  company_create,
  branch_create,
  update_branch,
  product_create,
  update_company,
  order_create,
  purchase_order_create,
  purchase_order_update,
  vendor_create,
  expense_data,
  expense_data_update,
  inventorySchema,
  reportSchema,
  Inventory,
  holdSchema,
  expense_item,
  edit_vendor_create,
  sales_history_query,
  sales_history_summary_query,
  sale_by_id_params,
  get_customers,
  get_customer_by_id,
  add_customer,
  update_customer,
  mark_payment,
  mark_customer_payment,
  createSchema,
  editSchema,
  order_update,
  ledgerSchema
};
