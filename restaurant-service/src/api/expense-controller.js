const express = require("express");
const router = express.Router();
const service = require("../services/expense-service");
const RequestValidator = require("../utils/requestValidator");
const vSchema = require("../schema/validation-schema");

// ── EXPENSE ITEM CATALOG ─────────────────────────────────────────

router.get("/catalog", async (req, res) => {
  const result = await service.getCatalogItems(req.query);
  return res.status(200).json(result);
});

router.post("/catalog", async (req, res) => {
  const { errors, input } = await RequestValidator(vSchema.expense_catalog_create, req.body);
  if (errors) return res.status(400).json({ errors });
  const result = await service.createCatalogItem(input);
  return res.status(result.success ? 201 : 400).json(result);
});

router.put("/catalog/:id", async (req, res) => {
  const { errors, input } = await RequestValidator(vSchema.expense_catalog_update, req.body);
  if (errors) return res.status(400).json({ errors });
  const result = await service.updateCatalogItem(req.params.id, input);
  return res.status(result.success ? 200 : 400).json(result);
});

router.delete("/catalog/:id", async (req, res) => {
  const result = await service.deleteCatalogItem(req.params.id);
  return res.status(result.success ? 200 : 400).json(result);
});

// ── EXPENSE ──────────────────────────────────────────────────────

router.post("/", async (req, res) => {
  const { errors, input } = await RequestValidator(vSchema.expense_create_v2, req.body);
  if (errors) return res.status(400).json({ errors });
  const result = await service.createExpense(input);
  return res.status(result.success ? 201 : 400).json(result);
});

router.get("/", async (req, res) => {
  const result = await service.getExpenses(req.query);
  return res.status(200).json(result);
});

router.get("/summary", async (req, res) => {
  const { zodu_id, branch_id } = req.query;
  if (!zodu_id || !branch_id) {
    return res.status(400).json({ success: false, message: "zodu_id and branch_id are required" });
  }
  const result = await service.getExpenseSummary({ zodu_id, branch_id });
  return res.status(result.success ? 200 : 400).json(result);
});

router.get("/:id", async (req, res) => {
  const result = await service.getExpenseById(req.params.id, req.query);
  return res.status(result.success ? 200 : 404).json(result);
});

router.put("/:id", async (req, res) => {
  const { errors, input } = await RequestValidator(vSchema.expense_update_v2, req.body);
  if (errors) return res.status(400).json({ errors });
  const result = await service.updateExpense(req.params.id, input);
  return res.status(result.success ? 200 : 400).json(result);
});

router.delete("/:id", async (req, res) => {
  const result = await service.deleteExpense(req.params.id);
  return res.status(result.success ? 200 : 400).json(result);
});

router.post("/payment/:id", async (req, res) => {
  const { errors, input } = await RequestValidator(vSchema.expense_payment, req.body);
  if (errors) return res.status(400).json({ errors });
  const result = await service.markPayment(req.params.id, input);
  return res.status(result.success ? 200 : 400).json(result);
});

module.exports = router;
