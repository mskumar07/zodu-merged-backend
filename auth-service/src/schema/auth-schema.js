const joi = require("@hapi/joi");

const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,30}$/;

// Payment types offered at POS checkout. Same vocabulary as the CHECK
// constraint on tbl_invoice_settings.payment_types — keep the two in step.
const PAYMENT_TYPES = ['Cash', 'UPI', 'UPI + Cash', 'Cheque', 'Bank Transfer', 'Others'];

// Which copy labels a branch prints per sale. Same vocabulary as the CHECK
// constraint on tbl_invoice_settings.invoice_copy_types — keep the two in step.
const INVOICE_COPY_TYPES = ['Original', 'Duplicate', 'Transport'];

// Sale types the POS screen can offer. Same vocabulary as the CHECK
// constraints on tbl_pos_settings — keep the two in step.
const POS_TYPES = ['Invoice', 'Quotation', 'Proforma'];

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
    // Normally set by the logo upload endpoint (or by sending the file with
    // this request as multipart). Allowed here so the client can also point at
    // an already-uploaded image, or clear it with null.
    company_logo_url: joi.string().uri().allow(null, ''),
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
    // Normally set by the logo upload endpoint (or by sending the file with
    // this request as multipart). Allowed here so the client can also point at
    // an already-uploaded image, or clear it with null.
    company_logo_url: joi.string().uri().allow(null, ''),
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

    // Invoice numbering
    invoice_prefix: joi.string().max(20).allow(null, ''),
    // Lets a branch save a prefix without applying it (toggle off = no
    // prefix on generated sale IDs / order numbers).
    invoice_prefix_enabled: joi.boolean(),
    invoice_start_number: joi.number().integer().min(0),

    // Tax / payment
    default_tax_label: joi.string().max(50).allow(null, ''),
    invoice_due_days: joi.number().integer().min(0),
    default_payment_method: joi.string().max(30).allow(null, ''),
    // Which types the POS offers. insensitive() lets the client send 'cash'
    // and still store the canonical 'Cash'. At least one — a branch with no
    // payment type cannot take money.
    payment_types: joi
      .array()
      .items(joi.string().valid(...PAYMENT_TYPES).insensitive())
      .min(1)
      .unique((a, b) => String(a).toLowerCase() === String(b).toLowerCase()),
    // Which copy labels to print per sale — Original (customer), Duplicate
    // (business's own copy), Transport Copy (delivery vehicle).
    invoice_copy_types: joi
      .array()
      .items(joi.string().valid(...INVOICE_COPY_TYPES).insensitive())
      .min(1)
      .unique((a, b) => String(a).toLowerCase() === String(b).toLowerCase()),

    // Print layout
    // Which invoice layout to render. Free text on purpose: the template set
    // lives in the frontend, so the API does not gate on a fixed list.
    invoice_template: joi.string().allow(null, ''),
    printer_inch: joi.string().max(10).allow(null, ''),
    // Theme colour as '#RRGGBB' — normalised to uppercase; no null/'' so a bad
    // value fails validation here instead of the column's CHECK constraint.
    invoice_theme_color: joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).uppercase(),
    show_company_logo: joi.boolean(),
    print_thank_you_message: joi.boolean(),
    show_item_id: joi.boolean(),
    show_description: joi.boolean(),
    show_customer_details: joi.boolean(),
    show_tax_details: joi.boolean(),
    show_payment_details: joi.boolean(),
    show_bank_details: joi.boolean(),
    show_signature: joi.boolean(),
    show_shipping_address: joi.boolean(),
    show_serial_no: joi.boolean(),
    // Normally set by the signature upload endpoint; allowed here so the
    // client can clear it (null) without a separate call.
    signature_url: joi.string().uri().allow(null, ''),

    // Free-text blocks (shown only when their toggle is on)
    show_terms_conditions: joi.boolean(),
    terms_conditions: joi.string().max(2000).allow(null, ''),
    show_notes: joi.boolean(),
    notes: joi.string().max(2000).allow(null, ''),

    // POS settings — Additional Settings
    stock_check_enabled: joi.boolean(),
    customer_mandatory: joi.boolean(),
  })
    .min(1)
    // A default the checkout no longer offers would leave the POS preselecting
    // a type the cashier cannot pick. Only checked when one request changes both.
    .custom((value, helpers) => {
      const { payment_types, default_payment_method } = value;
      if (!payment_types || !default_payment_method) return value;
      const offered = payment_types.some(
        (t) => String(t).toLowerCase() === String(default_payment_method).toLowerCase()
      );
      return offered
        ? value
        : helpers.message(
            `"default_payment_method" (${default_payment_method}) must be one of the selected payment_types`
          );
    }, 'default payment method is offered')
    // RequestValidator calls validateAsync with stripUnknown: true globally,
    // which would otherwise delete an unrecognized field (typo, deprecated
    // field like the old invoice_digit_count, or a field that actually
    // belongs on edit_pos_settings) before .min(3) ever runs — surfacing a
    // confusing "must have at least 3 keys" instead of naming the bad field.
    // This override makes Joi reject unknown keys by name instead.
    .prefs({ stripUnknown: false }),

  edit_pos_settings: joi.object({
    zodu_id: joi.string().required(),
    branch_id: joi.string().required(),

    // Which sale types the POS screen offers. insensitive() lets the client
    // send 'invoice' and still store the canonical 'Invoice'. At least one —
    // a POS with no sale type has nothing to open.
    pos_types: joi
      .array()
      .items(joi.string().valid(...POS_TYPES).insensitive())
      .min(1)
      .unique((a, b) => String(a).toLowerCase() === String(b).toLowerCase()),

    // Which of the enabled types the POS screen opens on by default.
    default_pos_type: joi.string().valid(...POS_TYPES).insensitive(),

    // Trailing text on the invoice ID, e.g. a fiscal year ("26-27").
    // _enabled lets a branch save a suffix without applying it yet.
    invoice_suffix: joi.string().max(20).allow(null, ''),
    invoice_suffix_enabled: joi.boolean(),

    // Per-type ID prefixes — Invoice uses tbl_invoice_settings.invoice_prefix
    // instead (see edit_invoice_settings); these two make Quotation/Proforma
    // numbering settings-driven too, instead of hard-coded "QUO"/"...P".
    quotation_prefix: joi.string().max(20).allow(null, ''),
    proforma_prefix: joi.string().max(20).allow(null, ''),
    // Mirrors invoice_prefix_enabled — lets a branch save a Quotation/
    // Proforma prefix without applying it.
    quotation_prefix_enabled: joi.boolean(),
    proforma_prefix_enabled: joi.boolean(),
    // Mirrors invoice_suffix/invoice_suffix_enabled.
    quotation_suffix: joi.string().max(20).allow(null, ''),
    quotation_suffix_enabled: joi.boolean(),
    proforma_suffix: joi.string().max(20).allow(null, ''),
    proforma_suffix_enabled: joi.boolean(),

    // Shows/hides the Purchase Order No/Date fields (tbl_sales.purchase_order_no/
    // purchase_order_date) on the POS screen.
    purchase_order_enabled: joi.boolean(),

    // Shows/hides the Hold Order/Bill feature on the POS screen.
    hold_enabled: joi.boolean(),
  })
    .min(1)
    // A default the POS no longer offers would leave the screen preselecting
    // a type the cashier cannot pick. Only checked when one request changes both.
    .custom((value, helpers) => {
      const { pos_types, default_pos_type } = value;
      if (!pos_types || !default_pos_type) return value;
      const offered = pos_types.some(
        (t) => String(t).toLowerCase() === String(default_pos_type).toLowerCase()
      );
      return offered
        ? value
        : helpers.message(
            `"default_pos_type" (${default_pos_type}) must be one of the selected pos_types`
          );
    }, 'default pos type is offered')
    // See edit_invoice_settings' identical override — without this, an
    // unrecognized field (e.g. sent to the wrong settings endpoint) gets
    // silently stripped before .min(3) runs, giving a confusing "must have
    // at least 3 keys" instead of naming the actual bad field.
    .prefs({ stripUnknown: false }),
};

module.exports = schema;
