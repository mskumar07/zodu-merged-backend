const express = require("express");
const { createSaleReturnSchema } = require("../schema/saleReturn-schema");
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

module.exports = router;
