import Joi from 'joi';

const returnItemSchema = Joi.object({
  original_item_id: Joi.number().integer().positive().required(),
  item_id:          Joi.string().trim().max(100).required(),
  item_uuid:        Joi.string().uuid().required(),
  return_qty:       Joi.number().positive().precision(2).required(),
});

export const createSaleReturnSchema = Joi.object({
  original_sale_uuid: Joi.string().uuid().required(),
  zodu_id:            Joi.string().trim().max(50).required(),
  branch_id:          Joi.string().trim().max(50).required(),
  return_reason:      Joi.string().trim().max(500).optional().allow('', null),
  refund_type:        Joi.string().required(),
  notes:              Joi.string().trim().max(1000).optional().allow('', null),
  created_by:         Joi.string().trim().max(100).optional().allow('', null),
  items:              Joi.array().items(returnItemSchema).min(1).required(),
});