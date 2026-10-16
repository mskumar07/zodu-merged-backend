const express = require("express");
const {
  createPurchaseReturnSchema,
  updatePurchaseReturnSchema,
  purchaseReturnScopeSchema,
  refundPurchaseReturnSchema,
} = require("../schema/purchaseReturn-schema");
const router = express.Router();
const service = require("../services/purchaseReturn-service");
const { successResponse } = require("../utils/responseFormatter/successResponse");

// Validates `source` (body or query) and hands the cleaned value to `handler`.
// A validation failure is a 400 with every message; anything thrown by the
// service (404 / 400 business errors, 500) goes to the shared error handler.
const route = (schema, source, status, message, handler) => async (req, res, next) => {
  try {
    const { error, value } = schema.validate(req[source], { abortEarly: false });
    if (error) {
      return res.status(400).json({ errors: error.details.map((d) => d.message) });
    }

    const result = await handler({ ...value, return_uuid: req.params.return_uuid });
    return res.status(status).json(successResponse(message, result));
  } catch (err) {
    next(err);
  }
};

router.post(
  "/",
  route(createPurchaseReturnSchema, "body", 201, "Purchase return created successfully", service.createPurchaseReturn)
);

// One return with its items, vendor, summary and refunds received.
router.get(
  "/:return_uuid",
  route(purchaseReturnScopeSchema, "query", 200, "Purchase return fetched successfully", service.getPurchaseReturnDetail)
);

// Replaces the items of an existing return (add / change qty / remove).
router.put(
  "/:return_uuid",
  route(updatePurchaseReturnSchema, "body", 200, "Purchase return updated successfully", service.updatePurchaseReturn)
);

// Records (part of) the refund the vendor still owes.
router.post(
  "/:return_uuid/refund",
  route(refundPurchaseReturnSchema, "body", 201, "Refund recorded successfully", service.recordRefund)
);

// Deletes a return and fully reverses it: stock, refunds received and purchase status.
router.delete(
  "/:return_uuid",
  route(purchaseReturnScopeSchema, "query", 200, "Purchase return deleted successfully", service.deletePurchaseReturn)
);

module.exports = router;
