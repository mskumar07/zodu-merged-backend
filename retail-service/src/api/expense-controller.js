const express = require("express");
const router = express.Router();
const service = require("../services/expense-service");
const owned = require("../security/owned");
const { tenantOf } = require("../security/request");

// /catalog/:id is a catalog item (uuid); the other :id an expense_id, unique per company only.
const catalogItem = owned.inPath("id", "tbl_expense_menu_items", "item_uuid");
const expense = owned.inPath("id", "tbl_expense", "expense_id", { code: true });

// ── EXPENSE ITEM CATALOG ─────────────────────────────────────────

// GET  /api/expense/catalog
router.get("/catalog", async (req, res) => {
  const result = await service.getCatalogItems(req.query);
  return res.status(200).json(result);
});

// POST /api/expense/catalog
router.post("/catalog", async (req, res) => {
  const result = await service.createCatalogItem(req.body);
  return res.status(result.success ? 201 : 400).json(result);
});

// PUT  /api/expense/catalog/:id
router.put("/catalog/:id", catalogItem, async (req, res) => {
  const result = await service.updateCatalogItem(req.params.id, req.body);
  return res.status(result.success ? 200 : 400).json(result);
});

// DELETE /api/expense/catalog/:id
router.delete("/catalog/:id", catalogItem, async (req, res) => {
  const result = await service.deleteCatalogItem(req.params.id);
  return res.status(result.success ? 200 : 400).json(result);
});

// ── EXPENSE ──────────────────────────────────────────────────────

// POST /api/expense
router.post("/", async (req, res) => {
  const result = await service.createExpense(req.body);
  return res.status(result.success ? 201 : 400).json(result);
});

// GET /api/expense
router.get("/", async (req, res) => {
  const result = await service.getExpenses(req.query);
  return res.status(200).json(result);
});

// GET /api/expense/summary
router.get("/summary", async (req, res) => {
  const { zodu_id, branch_id } = req.query;
  if (!zodu_id || !branch_id) {
    return res.status(400).json({ success: false, message: "zodu_id and branch_id are required" });
  }
  const result = await service.getExpenseSummary({ zodu_id, branch_id });
  return res.status(result.success ? 200 : 400).json(result);
});

// GET /api/expense/:id
router.get("/:id", expense, async (req, res) => {
  const result = await service.getExpenseById(req.params.id, { ...req.query, zodu_id: req.tenant.zoduId });
  return res.status(result.success ? 200 : 404).json(result);
});

// PUT /api/expense/:id
router.put("/:id", expense, async (req, res) => {
  const result = await service.updateExpense(req.params.id, req.body, tenantOf(req));
  return res.status(result.success ? 200 : 400).json(result);
});

// DELETE /api/expense/:id
router.delete("/:id", expense, async (req, res) => {
  const result = await service.deleteExpense(req.params.id, tenantOf(req));
  return res.status(result.success ? 200 : 400).json(result);
});

// POST /api/expense/payment/:id
router.post("/payment/:id", expense, async (req, res) => {
  const result = await service.markPayment(req.params.id, req.body, tenantOf(req));
  return res.status(result.success ? 200 : 400).json(result);
});

module.exports = router;
