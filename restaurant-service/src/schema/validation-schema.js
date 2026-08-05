const Joi = require("joi");

// ─────────────────────────────────────────────────────────────
// COMMON REUSABLE PIECES
// ─────────────────────────────────────────────────────────────

const zodu_branch = {
  zodu_id:   Joi.string().max(50).required(),
  branch_id: Joi.string().max(50).required(),
};

const pagination = {
  page:  Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
};

const dateRange = {
  start_date: Joi.string().isoDate().optional().allow(null, ""),
  end_date:   Joi.string().isoDate().optional().allow(null, ""),
};

// ─────────────────────────────────────────────────────────────
// CATEGORY
// ─────────────────────────────────────────────────────────────

const category_create = Joi.object({
  ...zodu_branch,
  name: Joi.string().max(100).required(),
  type: Joi.string().max(50).required(),
});

const category_name_check = Joi.object({
  ...zodu_branch,
  name: Joi.string().max(100).required(),
  type: Joi.string().max(50).required(),
});

const category_update = Joi.object({
  name:      Joi.string().max(100).required(),
  type:      Joi.string().max(50).required(),
  zodu_id:   Joi.string().max(50).required(),
  branch_id: Joi.string().max(50).required(),
});

const category_inactivate = Joi.object({
  zodu_id:      Joi.string().max(50).required(),
  branch_id:    Joi.string().max(50).required(),
  active:       Joi.boolean().required(),
  page_expense: Joi.boolean().optional().allow(null),
});

// ─────────────────────────────────────────────────────────────
// EXPENSE CATEGORY
// ─────────────────────────────────────────────────────────────

const expense_category_create = Joi.object({
  ...zodu_branch,
  name: Joi.string().max(100).required(),
});

const expense_category_update = Joi.object({
  name:      Joi.string().max(100).required(),
  branch_id: Joi.string().max(50).required(),
});

// ─────────────────────────────────────────────────────────────
// EXPENSE ITEM (CATALOG)
// ─────────────────────────────────────────────────────────────

const expense_item_update = Joi.object({
  name: Joi.string().max(100).required(),
});

const expense_catalog_create = Joi.object({
  ...zodu_branch,
  item_id:            Joi.string().max(50).required(),
  expense_item_name:  Joi.string().max(255).required(),
  category_id:        Joi.number().integer().optional().allow(null),
  category_name:      Joi.string().max(100).optional().allow(null, ""),
  amount:             Joi.number().min(0).required(),
  qty:                Joi.number().min(0).default(1),
});

const expense_catalog_update = Joi.object({
  item_id:            Joi.string().max(50).required(),
  expense_item_name:  Joi.string().max(255).required(),
  category_id:        Joi.number().integer().optional().allow(null),
  category_name:      Joi.string().max(100).optional().allow(null, ""),
  amount:             Joi.number().min(0).required(),
  qty:                Joi.number().min(0).default(1),
  is_active:          Joi.boolean().optional(),
});

// ─────────────────────────────────────────────────────────────
// UNIT
// ─────────────────────────────────────────────────────────────

const unit_create = Joi.object({
  ...zodu_branch,
  name:       Joi.string().max(50).required(),
  short_name: Joi.string().max(20).required(),
});

const unit_update = Joi.object({
  name:       Joi.string().max(50).optional(),
  short_name: Joi.string().max(20).optional(),
}).min(1);

const unit_replace = Joi.object({
  old_unit_id: Joi.number().integer().required(),
  new_unit_id: Joi.number().integer().required(),
  branch_id:   Joi.string().max(50).required(),
});

// ─────────────────────────────────────────────────────────────
// GST
// ─────────────────────────────────────────────────────────────

const gst_create = Joi.object({
  ...zodu_branch,
  gst_rate: Joi.number().min(0).max(100).precision(2).required(),
});

const gst_update = Joi.object({
  gst_rate: Joi.number().min(0).max(100).precision(2).required(),
});

// ─────────────────────────────────────────────────────────────
// COMPLETE ORDER (DINE-IN CHECKOUT)
// ─────────────────────────────────────────────────────────────

const complete_order = Joi.object({
  zodu_id:         Joi.string().max(50).required(),
  branch_id:       Joi.string().max(50).required(),
  api_order_id:    Joi.string().required(),
  payment_type:    Joi.string().required(),
  table_no:        Joi.number().integer().allow(null),
  no_of_items:     Joi.number().integer().min(0).default(0),
  subtotal:        Joi.number().min(0).precision(2).default(0),
  total_tax:       Joi.number().min(0).precision(2).default(0),
  total_amt:       Joi.number().min(0).precision(2).default(0),
  discount_type:   Joi.string().valid("PERCENT", "FLAT", "Percent", "Amount").allow(null, ""),
  discount_value:  Joi.number().min(0).precision(2).allow(null),
  discount_amount: Joi.number().min(0).precision(2).default(0),
  items: Joi.array().items(
    Joi.object({
      menu_id:        Joi.string().required(),
      name:           Joi.string().required(),
      qty:            Joi.number().min(0).required(),
      price:          Joi.number().min(0).required(),
      gst_percentage: Joi.number().min(0).default(0),
      tax_inclusive:  Joi.boolean().default(false),
      tax:            Joi.number().min(0).default(0),
      cgst:           Joi.number().min(0).default(0),
      sgst:           Joi.number().min(0).default(0),
      menu_unit:      Joi.string().allow(null, ""),
      variant_id:     Joi.string().allow(null, ""),
      variant_name:   Joi.string().allow(null, ""),
    })
  ).min(1).required(),
}).options({ abortEarly: false });

// ─────────────────────────────────────────────────────────────
// PAYMENT — /api/payment/pay  (purchase or expense)
// ─────────────────────────────────────────────────────────────

const make_payment = Joi.object({
  zodu_id:      Joi.string().max(50).required(),
  branch_id:    Joi.string().max(50).required(),
  source_type:  Joi.string().valid("purchase", "expense").required(),
  source_id:    Joi.string().required(),
  paid_amount:  Joi.number().min(0.01).required(),
  payment_type: Joi.string().required(),
  total_amount: Joi.number().min(0).required(),
}).options({ abortEarly: false });

// ─────────────────────────────────────────────────────────────
// SALE PAYMENT — /api/payments/add
// ─────────────────────────────────────────────────────────────

const sale_payment_add = Joi.object({
  zodu_id:        Joi.string().max(50).required(),
  branch_id:      Joi.string().max(50).required(),
  sale_id:        Joi.string().required(),
  total_amount:   Joi.number().min(0).required(),
  paid_amount:    Joi.number().min(0.01).required(),
  payment_mode:   Joi.string().required(),
  paid_date:      Joi.string().isoDate().optional().allow(null, ""),
  transaction_id: Joi.string().optional().allow(null, ""),
}).options({ abortEarly: false });

// ─────────────────────────────────────────────────────────────
// PURCHASE (new purchase-controller.js routes)
// ─────────────────────────────────────────────────────────────

const purchase_item_schema = Joi.object({
  item_uuid:      Joi.string().required(),
  item_id:        Joi.string().required(),
  item_name:      Joi.string().required(),
  qty:            Joi.number().min(0.001).required(),
  unit:           Joi.string().max(50).optional().allow(null, ""),
  unit_id:        Joi.number().integer().optional().allow(null),
  purchase_price: Joi.number().min(0).required(),
  selling_price:  Joi.number().min(0).optional(),
  gst_percentage: Joi.number().min(0).max(100).default(0),
  tax_amount:     Joi.number().min(0).optional().allow(null),
  cgst:           Joi.number().min(0).optional().allow(null),
  sgst:           Joi.number().min(0).optional().allow(null),
  category_id:    Joi.number().integer().optional().allow(null),
  hsn_code:       Joi.string().max(20).optional().allow(null, ""),
  total_price:    Joi.number().min(0).optional(),
});

const purchase_create = Joi.object({
  ...zodu_branch,
  vendor_id:       Joi.string().optional().allow(null, ""),
  purchase_date:   Joi.string().isoDate().required(),
  total_amount:    Joi.number().min(0).required(),
  paid_amount:     Joi.number().min(0).default(0),
  payment_status:  Joi.string().valid("pending", "partial", "paid").default("pending"),
  notes:           Joi.string().optional().allow(null, ""),
  attachment_url:  Joi.array().items(Joi.alternatives().try(Joi.string(), Joi.object())).optional(),
  due_date:        Joi.string().isoDate().optional().allow(null, ""),
  transaction_type: Joi.string().optional().allow(null, ""),
  transaction_id:   Joi.string().optional().allow(null, ""),
  payment_date:     Joi.string().isoDate().optional().allow(null, ""),
  invoice_bill_no: Joi.string().max(100).optional().allow(null, ""),
  items: Joi.array().items(purchase_item_schema).min(1).required(),
}).options({ abortEarly: false });

const purchase_update = Joi.object({
  zodu_id:          Joi.string().max(50).optional().allow(null, ""),
  branch_id:        Joi.string().max(50).optional().allow(null, ""),
  vendor_id:        Joi.string().optional().allow(null, ""),
  purchase_date:    Joi.string().isoDate().optional(),
  total_amount:     Joi.number().min(0).optional(),
  paid_amount:      Joi.number().min(0).optional(),
  payment_status:   Joi.string().valid("pending", "partial", "paid").optional(),
  notes:            Joi.string().optional().allow(null, ""),
  attachment_url:   Joi.array().items(Joi.alternatives().try(Joi.string(), Joi.object())).optional(),
  due_date:         Joi.string().isoDate().optional().allow(null, ""),
  transaction_type: Joi.string().optional().allow(null, ""),
  transaction_id:   Joi.string().optional().allow(null, ""),
  payment_date:     Joi.string().isoDate().optional().allow(null, ""),
  items: Joi.array().items(purchase_item_schema).min(1).optional(),
  invoice_bill_no: Joi.string().max(100).optional().allow(null, ""),

}).min(1).options({ abortEarly: false });

const purchase_payment = Joi.object({
  zodu_id:          Joi.string().max(50).required(),
  branch_id:        Joi.string().max(50).required(),
  paid_amount:      Joi.number().min(0.01).required(),
  payment_date:     Joi.string().isoDate().optional().allow(null, ""),
  transaction_type: Joi.string().optional().allow(null, ""),
  transaction_id:   Joi.string().optional().allow(null, ""),
}).options({ abortEarly: false });

// ─────────────────────────────────────────────────────────────
// VENDOR (new vendor-controller.js routes)
// ─────────────────────────────────────────────────────────────

const vendor_create_v2 = Joi.object({
  ...zodu_branch,
  vendor_name:      Joi.string().max(150).required(),
  company_name:     Joi.string().max(150).required(),
  vendor_phone:     Joi.string().pattern(/^[0-9]{7,15}$/).required(),
  vendor_email:     Joi.string().email({ tlds: { allow: false } }).optional().allow(null, ""),
  gst:              Joi.string().max(20).optional().allow(null, ""),
  vendor_address:   Joi.string().max(255).optional().allow(null, ""),
  vendor_address_1: Joi.string().max(255).optional().allow(null, ""),
  vendor_address_2: Joi.string().max(255).optional().allow(null, ""),
  city:             Joi.string().max(50).optional().allow(null, ""),
  state:            Joi.string().max(50).optional().allow(null, ""),
  pincode:          Joi.string().pattern(/^[0-9]{5,10}$/).optional().allow(null, ""),
  type:             Joi.string().max(50).optional().allow(null, ""),
}).options({ abortEarly: false });

const vendor_update_v2 = Joi.object({
  vendor_name:      Joi.string().max(150).optional(),
  company_name:     Joi.string().max(150).optional(),
  vendor_phone:     Joi.string().pattern(/^[0-9]{7,15}$/).optional(),
  vendor_email:     Joi.string().email({ tlds: { allow: false } }).optional().allow(null, ""),
  gst:              Joi.string().max(20).optional().allow(null, ""),
  vendor_address:   Joi.string().max(255).optional().allow(null, ""),
  vendor_address_1: Joi.string().max(255).optional().allow(null, ""),
  vendor_address_2: Joi.string().max(255).optional().allow(null, ""),
  city:             Joi.string().max(50).optional().allow(null, ""),
  state:            Joi.string().max(50).optional().allow(null, ""),
  pincode:          Joi.string().pattern(/^[0-9]{5,10}$/).optional().allow(null, ""),
}).min(1).options({ abortEarly: false });

// ─────────────────────────────────────────────────────────────
// EXPENSE (new expense-controller.js routes)
// ─────────────────────────────────────────────────────────────

const expense_line_item = Joi.object({
  item_uuid:      Joi.string().optional().allow(null, ""),
  item_id:        Joi.alternatives().try(Joi.string(), Joi.number()).optional().allow(null, ""),
  item_name:      Joi.string().max(150).required(),
  qty:            Joi.number().min(0.001).required(),
  unit:           Joi.string().max(50).optional().allow(null, ""),
  purchase_price: Joi.number().min(0).optional(),
  price:          Joi.number().min(0).optional(),
  total_price:    Joi.number().min(0).optional(),
  gst_percentage: Joi.number().min(0).optional().allow(null),
  tax_amount:     Joi.number().min(0).optional().allow(null),
  cgst:           Joi.number().min(0).optional().allow(null),
  sgst:           Joi.number().min(0).optional().allow(null),
  category_id:    Joi.number().integer().optional().allow(null),
});

const expense_create_v2 = Joi.object({
  ...zodu_branch,
  expense_date:     Joi.string().isoDate().required(),
  category_id:      Joi.number().integer().optional().allow(null),
  total_amount:     Joi.number().min(0).required(),
  paid_amount:      Joi.number().min(0).default(0),
  balance_amount:   Joi.number().min(0).optional().allow(null),
  payment_status:   Joi.string().valid("pending", "partial", "paid").default("pending"),
  notes:            Joi.string().optional().allow(null, ""),
  attachment_url:   Joi.array().items(Joi.alternatives().try(Joi.string(), Joi.object())).optional(),
  due_date:         Joi.string().isoDate().optional().allow(null, ""),
  transaction_type: Joi.string().optional().allow(null, ""),
  transaction_id:   Joi.string().optional().allow(null, ""),
  payment_date:     Joi.string().isoDate().optional().allow(null, ""),
  vendor_id:        Joi.alternatives().try(Joi.string(), Joi.number()).optional().allow(null, ""),
  items:            Joi.array().items(expense_line_item).optional(),
}).options({ abortEarly: false });

const expense_update_v2 = Joi.object({
  zodu_id:          Joi.string().max(50).optional(),
  branch_id:        Joi.string().max(50).optional(),
  expense_date:     Joi.string().isoDate().optional(),
  category_id:      Joi.number().integer().optional().allow(null),
  total_amount:     Joi.number().min(0).optional(),
  paid_amount:      Joi.number().min(0).optional(),
  balance_amount:   Joi.number().min(0).optional().allow(null),
  payment_status:   Joi.string().valid("pending", "partial", "paid").optional(),
  notes:            Joi.string().optional().allow(null, ""),
  attachment_url:   Joi.array().items(Joi.alternatives().try(Joi.string(), Joi.object())).optional(),
  due_date:         Joi.string().isoDate().optional().allow(null, ""),
  transaction_type: Joi.string().optional().allow(null, ""),
  transaction_id:   Joi.string().optional().allow(null, ""),
  payment_date:     Joi.string().isoDate().optional().allow(null, ""),
  vendor_id:        Joi.alternatives().try(Joi.string(), Joi.number()).optional().allow(null, ""),
  items:            Joi.array().items(expense_line_item).optional(),
}).min(1).options({ abortEarly: false });

const expense_payment = Joi.object({
  zodu_id:          Joi.string().max(50).required(),
  branch_id:        Joi.string().max(50).required(),
  paid_amount:      Joi.number().min(0.01).required(),
  payment_date:     Joi.string().isoDate().optional().allow(null, ""),
  transaction_type: Joi.string().optional().allow(null, ""),
  transaction_id:   Joi.string().optional().allow(null, ""),
}).options({ abortEarly: false });

// ─────────────────────────────────────────────────────────────
// QUERY SCHEMAS (GET with required query params)
// ─────────────────────────────────────────────────────────────

const branch_id_query = Joi.object({
  branch_id: Joi.string().required(),
});

const zodu_branch_query = Joi.object({
  zodu_id:   Joi.string().required(),
  branch_id: Joi.string().required(),
});

const inventory_list_query = Joi.object({
  branch_id: Joi.string().required(),
  type:      Joi.string().optional().allow(null, ""),
  category:  Joi.alternatives().try(Joi.number(), Joi.string()).optional().allow(null, ""),
});

const purchase_list_query = Joi.object({
  branch_id:   Joi.string().required(),
  ...pagination,
  search:      Joi.string().optional().allow(""),
  status:      Joi.string().optional().allow(""),
  ...dateRange,
  category_id: Joi.alternatives().try(Joi.number(), Joi.string()).optional().allow(""),
});

const expense_list_query = Joi.object({
  branch_id:   Joi.string().required(),
  ...pagination,
  search:      Joi.string().optional().allow(""),
  filter:      Joi.string().valid("All", "Paid", "Unpaid").default("All"),
  ...dateRange,
  category_id: Joi.alternatives().try(Joi.number(), Joi.string()).optional().allow(""),
});

const order_report_query = Joi.object({
  zodu_id:       Joi.string().required(),
  branch_id:     Joi.string().required(),
  filtered_type: Joi.string().valid("all_orders", "date_wise", "month_year_wise").default("all_orders"),
  ...pagination,
  ...dateRange,
  year:          Joi.alternatives().try(Joi.number(), Joi.string()).optional().allow(null, ""),
  search:        Joi.string().optional().allow(null, ""),
});

const order_category_report_query = Joi.object({
  zodu_id:   Joi.string().required(),
  branch_id: Joi.string().required(),
  ...pagination,
  search:    Joi.string().optional().allow(""),
});

module.exports = {
  // Category
  category_create,
  category_name_check,
  category_update,
  category_inactivate,

  // Expense Category
  expense_category_create,
  expense_category_update,

  // Expense Item / Catalog
  expense_item_update,
  expense_catalog_create,
  expense_catalog_update,

  // Unit
  unit_create,
  unit_update,
  unit_replace,

  // GST
  gst_create,
  gst_update,

  // Orders
  complete_order,
  make_payment,
  sale_payment_add,

  // Purchase
  purchase_create,
  purchase_update,
  purchase_payment,

  // Vendor
  vendor_create_v2,
  vendor_update_v2,

  // Expense
  expense_create_v2,
  expense_update_v2,
  expense_payment,

  // Query schemas
  branch_id_query,
  zodu_branch_query,
  inventory_list_query,
  purchase_list_query,
  expense_list_query,
  order_report_query,
  order_category_report_query,
};
