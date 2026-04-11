const express = require("express");
const router = express.Router();
const service = require("../services/purchase.service");

// CREATE PURCHASE
router.post("/", async (req, res) => {
  const result = await service.createPurchase(req.body);
  return res.status(result.success ? 201 : 400).json(result);
});

// GET ALL
router.get("/", async (req, res) => {
  const result = await service.getPurchases(req.query);
  return res.status(200).json(result);
});

router.get("/summary", async (req, res) => {
  const { zodu_id, branch_id } = req.query;
  if (!zodu_id || !branch_id) {
    return res.status(400).json({ success: false, message: "zodu_id and branch_id are required" });
  }
  const result = await service.getPurchaseSummary({ zodu_id, branch_id });
  return res.status(result.success ? 200 : 400).json(result);
});

// GET ONE
router.get("/:id", async (req, res) => {
  const result = await service.getPurchaseById(req.params.id, req.query);
  return res.status(result.success ? 200 : 404).json(result);
});

// UPDATE
router.put("/:id", async (req, res) => {
  const result = await service.updatePurchase(req.params.id, req.body);
  return res.status(result.success ? 200 : 400).json(result);
});

// DELETE (WITH STOCK REVERSAL)
router.delete("/:id", async (req, res) => {
  const result = await service.deletePurchase(req.params.id);
  console.log(result)
  return res.status(result.success ? 200 : 400).json(result);
});

// MARK PAYMENT
router.post("/payment/:id/", async (req, res) => {
  const result = await service.markPayment(req.params.id, req.body);
  return res.status(result.success ? 200 : 400).json(result);
});

module.exports = router;
