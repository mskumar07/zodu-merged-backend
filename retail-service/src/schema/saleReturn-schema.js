import Joi from 'joi';

const returnItemSchema = Joi.object({
  original_item_id: Joi.number().integer().positive().required(),
  item_id:          Joi.string().trim().max(100).required(),
  item_uuid:        Joi.string().uuid().required(),
  return_qty:       Joi.number().positive().precision(2).required(),
});

// Cash paid out to the customer at the time of the return. Omit it to leave the
// refund pending and pay it later through the refund endpoint.
const refundPaymentSchema = Joi.object({
  amount:       Joi.number().positive().precision(2).optional(),
  payment_mode: Joi.string().trim().max(50).required(),
  reference_no: Joi.string().trim().max(100).optional().allow('', null),
  refund_date:  Joi.date().iso().raw().optional(),
});

export const createSaleReturnSchema = Joi.object({
  original_sale_uuid: Joi.string().uuid().required(),
  zodu_id:            Joi.string().trim().max(50).required(),
  branch_id:          Joi.string().trim().max(50).required(),
  return_type:        Joi.string().valid('SALES_RETURN', 'CREDIT_NOTE').default('SALES_RETURN'),
  return_reason:      Joi.string().trim().max(500).optional().allow('', null),
  refund_type:        Joi.string().trim().max(20).optional().allow('', null),
  refund_payment:     refundPaymentSchema.optional(),
  notes:              Joi.string().trim().max(1000).optional().allow('', null),
  created_by:         Joi.string().trim().max(100).optional().allow('', null),
  // unique() blocks the same sale line being sent twice, which would sidestep
  // the max-returnable check.
  items:              Joi.array().items(returnItemSchema).unique('original_item_id').min(1).required(),
});

// Edit sends the complete new item set; omitted return_type / refund_type keep
// the return's existing values.
export const updateSaleReturnSchema = Joi.object({
  zodu_id:       Joi.string().trim().max(50).required(),
  branch_id:     Joi.string().trim().max(50).required(),
  return_type:   Joi.string().valid('SALES_RETURN', 'CREDIT_NOTE').optional(),
  return_reason: Joi.string().trim().max(500).optional().allow('', null),
  refund_type:   Joi.string().trim().max(20).optional().allow('', null),
  notes:         Joi.string().trim().max(1000).optional().allow('', null),
  items:         Joi.array().items(returnItemSchema).unique('original_item_id').min(1).required(),
});

export const deleteSaleReturnSchema = Joi.object({
  zodu_id:   Joi.string().trim().max(50).required(),
  branch_id: Joi.string().trim().max(50).required(),
});

export const refundSaleReturnSchema = Joi.object({
  zodu_id:       Joi.string().trim().max(50).required(),
  branch_id:     Joi.string().trim().max(50).required(),
  refund_amount: Joi.number().positive().precision(2).required(),
  payment_mode:  Joi.string().trim().max(50).required(),
  reference_no:  Joi.string().trim().max(100).optional().allow('', null),
  refund_date:   Joi.date().iso().raw().optional(),
});
