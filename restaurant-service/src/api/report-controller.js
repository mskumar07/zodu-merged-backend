const express = require("express");
const router  = express.Router();
const service = require("../services/report-service");

function requireParams(res, ...params) {
  const missing = params.filter(([val]) => !val).map(([, name]) => name);
  if (missing.length) {
    res.status(400).json({ success: false, error: `Missing required params: ${missing.join(", ")}` });
    return false;
  }
  return true;
}

// GET /api/report/sales/summary?zodu_id=&branch_id=&year=
// Summary cards: total monthly sales, total yearly sales, growth %, top month
router.get("/sales/summary", async (req, res) => {
  const { zodu_id, branch_id, year } = req.query;
  if (!requireParams(res, [zodu_id, "zodu_id"], [branch_id, "branch_id"])) return;

  try {
    const data = await service.getSalesSummary(zodu_id, branch_id, year);
    res.json({ success: true, data });
  } catch (err) {
    console.error("[report] getSalesSummary:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/report/sales/monthly-breakdown?zodu_id=&branch_id=&year=&page=&limit=
// Monthly Sales Breakdown table with offset pagination
router.get("/sales/monthly-breakdown", async (req, res) => {
  const { zodu_id, branch_id, year, page = 1, limit = 12 } = req.query;
  if (!requireParams(res, [zodu_id, "zodu_id"], [branch_id, "branch_id"])) return;

  try {
    const result = await service.getMonthlyBreakdown(zodu_id, branch_id, year, page, limit);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[report] getMonthlyBreakdown:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/report/sales/historical?zodu_id=&branch_id=
// Historical Performance: yearly net sales, peak revenue, avg growth
router.get("/sales/historical", async (req, res) => {
  const { zodu_id, branch_id } = req.query;
  if (!requireParams(res, [zodu_id, "zodu_id"], [branch_id, "branch_id"])) return;
console.log(zodu_id,branch_id)
  try {
    const data = await service.getHistoricalPerformance(zodu_id, branch_id);
    res.json({ success: true, data });
  } catch (err) {
    console.error("[report] getHistoricalPerformance:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/report/category-item-sales/summary?zodu_id=&branch_id=&from_date=&to_date=
// Summary cards: total sales, growth %, best category, best item, total tax, avg tax rate
router.get("/category-item-sales/summary", async (req, res) => {
  const { zodu_id, branch_id, from_date, to_date } = req.query;
  if (!requireParams(res, [zodu_id, "zodu_id"], [branch_id, "branch_id"])) return;

  try {
    const data = await service.getCategoryItemSalesSummary(zodu_id, branch_id, from_date, to_date);
    res.json({ success: true, data });
  } catch (err) {
    console.error("[report] getCategoryItemSalesSummary:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/report/category-item-sales/category-wise?zodu_id=&branch_id=&from_date=&to_date=&page=&limit=
// Category-wise sales table with pagination and growth vs previous period
router.get("/category-item-sales/category-wise", async (req, res) => {
  const { zodu_id, branch_id, from_date, to_date, page = 1, limit = 10 } = req.query;
  if (!requireParams(res, [zodu_id, "zodu_id"], [branch_id, "branch_id"])) return;

  try {
    const result = await service.getCategoryWiseSales(zodu_id, branch_id, from_date, to_date, page, limit);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[report] getCategoryWiseSales:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/report/category-item-sales/item-wise?zodu_id=&branch_id=&from_date=&to_date=&page=&limit=&category_id=
// Item-wise sales table with pagination; optional category_id filter
router.get("/category-item-sales/item-wise", async (req, res) => {
  const { zodu_id, branch_id, from_date, to_date, page = 1, limit = 10, category_id } = req.query;
  if (!requireParams(res, [zodu_id, "zodu_id"], [branch_id, "branch_id"])) return;

  try {
    const result = await service.getItemWiseSales(zodu_id, branch_id, from_date, to_date, page, limit, category_id);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[report] getItemWiseSales:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/report/category-item-sales/sales-velocity?zodu_id=&branch_id=&from_date=&to_date=
// Daily sales breakdown for chart
router.get("/category-item-sales/sales-velocity", async (req, res) => {
  const { zodu_id, branch_id, from_date, to_date } = req.query;
  if (!requireParams(res, [zodu_id, "zodu_id"], [branch_id, "branch_id"])) return;

  try {
    const result = await service.getSalesVelocity(zodu_id, branch_id, from_date, to_date);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[report] getSalesVelocity:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
