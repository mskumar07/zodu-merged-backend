const express = require("express");
const { createSaleReturnSchema, getSaleReturnSchema, updateSaleReturnSchema, refundSaleReturnSchema, deleteSaleReturnSchema } = require("../schema/saleReturn-schema");
const router = express.Router();
const sale = require("../services/sale-service");
const { successResponse } = require("../utils/responseFormatter/successResponse");


router.post("/", async (req, res, next) => {
  try {
    const { error, value } = createSaleReturnSchema.validate(req.body, {
      abortEarly: false,
    });

    if (error) {
      return res.status(400).json({ errors: error.details.map((d) => d.message) });
    }

    const result = await sale.createSaleReturn(value);

    return res
      .status(201)
      .json(successResponse("Sale return created successfully", result));
  } catch (err) {
    next(err);
  }
});

// One return with its items (tax split), customer, summary and refund payments.
router.get("/:return_uuid", async (req, res, next) => {
  try {
    const { error, value } = getSaleReturnSchema.validate(req.query, {
      abortEarly: false,
    });

    if (error) {
      return res.status(400).json({ errors: error.details.map((d) => d.message) });
    }

    const result = await sale.getSaleReturnDetail({
      ...value,
      return_uuid: req.params.return_uuid,
    });

    return res
      .status(200)
      .json(successResponse("Sale return fetched successfully", result));
  } catch (err) {
    next(err);
  }
});

// Replaces the items of an existing return (add / change qty / remove).
router.put("/:return_uuid", async (req, res, next) => {
  try {
    const { error, value } = updateSaleReturnSchema.validate(req.body, {
      abortEarly: false,
    });

    if (error) {
      return res.status(400).json({ errors: error.details.map((d) => d.message) });
    }

    const result = await sale.updateSaleReturn({
      ...value,
      return_uuid: req.params.return_uuid,
    });

    return res
      .status(200)
      .json(successResponse("Sale return updated successfully", result));
  } catch (err) {
    next(err);
  }
});

// Pays out (part of) the refund still pending on a return.
router.post("/:return_uuid/refund", async (req, res, next) => {
  try {
    const { error, value } = refundSaleReturnSchema.validate(req.body, {
      abortEarly: false,
    });

    if (error) {
      return res.status(400).json({ errors: error.details.map((d) => d.message) });
    }

    const result = await sale.recordRefund({
      ...value,
      return_uuid: req.params.return_uuid,
    });

    return res
      .status(201)
      .json(successResponse("Refund recorded successfully", result));
  } catch (err) {
    next(err);
  }
});

// Deletes a return and fully reverses it: stock, refund payments and invoice status.
router.delete("/:return_uuid", async (req, res, next) => {
  try {
    const { error, value } = deleteSaleReturnSchema.validate(req.query, {
      abortEarly: false,
    });

    if (error) {
      return res.status(400).json({ errors: error.details.map((d) => d.message) });
    }

    const result = await sale.deleteSaleReturn({
      ...value,
      return_uuid: req.params.return_uuid,
    });

    return res
      .status(200)
      .json(successResponse("Sale return deleted successfully", result));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
