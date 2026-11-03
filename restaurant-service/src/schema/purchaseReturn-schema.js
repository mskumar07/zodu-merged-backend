import Joi from 'joi';

// Only the purchase line and the quantity are needed: name, unit, price and tax
// come from the purchase itself, never from the request.
const returnItemSchema = Joi.object({
  original_item_id: Joi.number().integer().positive().required(),   // tbl_purchase_items.purchase_item_id
  return_qty:       Joi.number().positive().precision(2).required(),
}).unknown(true);

// Refund received from the vendor. Omit it to leave the refund pending and record
// it later through the refund endpoint.
const refundPaymentSchema = Joi.object({
  amount:       Joi.number().positive().precision(2).optional(),
  payment_mode: Joi.string().trim().max(50).required(),
  reference_no: Joi.string().trim().max(100).optional().allow('', null),
  refund_date:  Joi.date().iso().raw().optional(),
});

const items = Joi.array().items(returnItemSchema).unique('original_item_id').min(1).required();

export const createPurchaseReturnSchema = Joi.object({
  original_purchase_id: Joi.string().trim().max(50).required(),
  zodu_id:              Joi.string().trim().max(50).required(),
  branch_id:            Joi.string().trim().max(50).required(),
  return_type:          Joi.string().valid('PURCHASE_RETURN', 'DEBIT_NOTE').default('PURCHASE_RETURN'),
  return_reason:        Joi.string().trim().max(500).optional().allow('', null),
  refund_type: Joi.string().trim().max(50).optional().allow('', null),
  return_date: Joi.date().iso().raw().required(),
  refund_payment:       refundPaymentSchema.optional(),
  notes:                Joi.string().trim().max(1000).optional().allow('', null),
  created_by:           Joi.string().trim().max(100).optional().allow('', null),
  items,
});

// Edit sends the complete new item set; an omitted return_type / refund_type keeps
// the return's existing value.
export const updatePurchaseReturnSchema = Joi.object({
  zodu_id:       Joi.string().trim().max(50).required(),
  branch_id:     Joi.string().trim().max(50).required(),
  return_type:   Joi.string().valid('PURCHASE_RETURN', 'DEBIT_NOTE').optional(),
  return_reason: Joi.string().trim().max(500).optional().allow('', null),
  refund_type: Joi.string().trim().max(50).optional().allow('', null),
  return_date: Joi.date().iso().raw().required(),
  notes:         Joi.string().trim().max(1000).optional().allow('', null),
  items,
});

// Reads and deletes address a return the same way: id in the path, tenant in the query.
export const purchaseReturnScopeSchema = Joi.object({
  zodu_id:   Joi.string().trim().max(50).required(),
  branch_id: Joi.string().trim().max(50).required(),
});

export const refundPurchaseReturnSchema = Joi.object({
  zodu_id:       Joi.string().trim().max(50).required(),
  branch_id:     Joi.string().trim().max(50).required(),
  refund_amount: Joi.number().positive().precision(2).required(),
  payment_mode:  Joi.string().trim().max(50).required(),
  reference_no:  Joi.string().trim().max(100).optional().allow('', null),
  refund_date:   Joi.date().iso().raw().optional(),
});
