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

function validDateRange(res, ...dates) {
  if (dates.every((d) => !d || /^\d{4}-\d{2}-\d{2}$/.test(d))) return true;
  res.status(400).json({ success: false, error: "from_date/to_date must be YYYY-MM-DD" });
  return false;
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

// GET /api/report/sales/datewise/summary?zodu_id=&branch_id=&from_date=&to_date=
// Summary cards: total_sales, total_orders, total_profit for the date range
router.get("/sales/datewise/summary", async (req, res) => {
  const { zodu_id, branch_id, from_date, to_date } = req.query;
  if (!requireParams(res, [zodu_id, "zodu_id"], [branch_id, "branch_id"])) return;

  try {
    const data = await service.getDatewiseSummary(zodu_id, branch_id, from_date, to_date);
    res.json({ success: true, data });
  } catch (err) {
    console.log(err)
    console.error("[report] getDatewiseSummary:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/report/sales/datewise?zodu_id=&branch_id=&from_date=&to_date=&page=&limit=
// Paginated day-by-day breakdown: orders, sales, profit per date
router.get("/sales/datewise", async (req, res) => {
  const { zodu_id, branch_id, from_date, to_date, page = 1, limit = 10 } = req.query;
  if (!requireParams(res, [zodu_id, "zodu_id"], [branch_id, "branch_id"])) return;

  try {
    const result = await service.getDatewiseBreakdown(zodu_id, branch_id, from_date, to_date, page, limit);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[report] getDatewiseBreakdown:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PURCHASE REPORTS ─────────────────────────────────────────

// GET /api/report/purchase/monthly-breakdown?zodu_id=&branch_id=&year=&page=&limit=
// Monthly Purchase Breakdown table with offset pagination
router.get("/purchase/monthly-breakdown", async (req, res) => {
  const { zodu_id, branch_id, year, page = 1, limit = 12 } = req.query;
  if (!requireParams(res, [zodu_id, "zodu_id"], [branch_id, "branch_id"])) return;

  try {
    const result = await service.getPurchaseMonthlyBreakdown(zodu_id, branch_id, year, page, limit);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[report] getPurchaseMonthlyBreakdown:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/report/purchase/datewise/summary?zodu_id=&branch_id=&from_date=&to_date=
// Summary cards: total_purchase, total_paid, total_pending for the date range
router.get("/purchase/datewise/summary", async (req, res) => {
  const { zodu_id, branch_id, from_date, to_date } = req.query;
  if (!requireParams(res, [zodu_id, "zodu_id"], [branch_id, "branch_id"])) return;

  try {
    const data = await service.getPurchaseDatewiseSummary(zodu_id, branch_id, from_date, to_date);
    res.json({ success: true, data });
  } catch (err) {
    console.error("[report] getPurchaseDatewiseSummary:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/report/purchase/datewise?zodu_id=&branch_id=&from_date=&to_date=&page=&limit=
// Paginated day-by-day breakdown: orders, purchase, paid, pending per date
router.get("/purchase/datewise", async (req, res) => {
  const { zodu_id, branch_id, from_date, to_date, page = 1, limit = 10 } = req.query;
  if (!requireParams(res, [zodu_id, "zodu_id"], [branch_id, "branch_id"])) return;

  try {
    const result = await service.getPurchaseDatewiseBreakdown(zodu_id, branch_id, from_date, to_date, page, limit);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[report] getPurchaseDatewiseBreakdown:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/purchase/summary", async (req, res) => {
  const { zodu_id, branch_id, year } = req.query;
  if (!requireParams(res, [zodu_id, "zodu_id"], [branch_id, "branch_id"])) return;

  try {
    const data = await service.getPurchaseSummary(zodu_id, branch_id, year);
    res.json({ success: true, data });
  } catch (err) {
    console.error("[report] getPurchaseSummary:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── EXPENSE REPORTS ──────────────────────────────────────────

// GET /api/report/expense/summary?zodu_id=&branch_id=&year=
// Summary cards: total monthly expense, total yearly expense, growth %, top month
router.get("/expense/summary", async (req, res) => {
  const { zodu_id, branch_id, year } = req.query;
  if (!requireParams(res, [zodu_id, "zodu_id"], [branch_id, "branch_id"])) return;

  try {
    const data = await service.getExpenseSummary(zodu_id, branch_id, year);
    res.json({ success: true, data });
  } catch (err) {
    console.error("[report] getExpenseSummary:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/report/expense/monthly-breakdown?zodu_id=&branch_id=&year=&page=&limit=
// Monthly Expense Breakdown table with offset pagination
router.get("/expense/monthly-breakdown", async (req, res) => {
  const { zodu_id, branch_id, year, page = 1, limit = 12 } = req.query;
  if (!requireParams(res, [zodu_id, "zodu_id"], [branch_id, "branch_id"])) return;

  try {
    const result = await service.getExpenseMonthlyBreakdown(zodu_id, branch_id, year, page, limit);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[report] getExpenseMonthlyBreakdown:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/report/expense/datewise/summary?zodu_id=&branch_id=&from_date=&to_date=
// Summary cards: total_entries, total_expense for the date range
router.get("/expense/datewise/summary", async (req, res) => {
  const { zodu_id, branch_id, from_date, to_date } = req.query;
  if (!requireParams(res, [zodu_id, "zodu_id"], [branch_id, "branch_id"])) return;

  try {
    const data = await service.getExpenseDatewiseSummary(zodu_id, branch_id, from_date, to_date);
    res.json({ success: true, data });
  } catch (err) {
    console.error("[report] getExpenseDatewiseSummary:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/report/expense/datewise?zodu_id=&branch_id=&from_date=&to_date=&page=&limit=
// Paginated day-by-day breakdown: entries, total expense per date
router.get("/expense/datewise", async (req, res) => {
  const { zodu_id, branch_id, from_date, to_date, page = 1, limit = 10 } = req.query;
  if (!requireParams(res, [zodu_id, "zodu_id"], [branch_id, "branch_id"])) return;

  try {
    const result = await service.getExpenseDatewiseBreakdown(zodu_id, branch_id, from_date, to_date, page, limit);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[report] getExpenseDatewiseBreakdown:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/report/expense/category-wise/summary?zodu_id=&branch_id=&from_date=&to_date=
// Summary cards: total_entries, total_expense, total_paid, total_pending for the date range
router.get("/expense/category-wise/summary", async (req, res) => {
  const { zodu_id, branch_id, from_date, to_date } = req.query;
  if (!requireParams(res, [zodu_id, "zodu_id"], [branch_id, "branch_id"])) return;
  if (!validDateRange(res, from_date, to_date)) return;

  try {
    const data = await service.getExpenseCategoryWiseSummary(zodu_id, branch_id, from_date, to_date);
    res.json({ success: true, data });
  } catch (err) {
    console.error("[report] getExpenseCategoryWiseSummary:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/report/expense/category-wise?zodu_id=&branch_id=&from_date=&to_date=&page=&limit=
// Paginated category-wise expense breakdown (category type 'E'), one row per category
router.get("/expense/category-wise", async (req, res) => {
  const { zodu_id, branch_id, from_date, to_date } = req.query;
  if (!requireParams(res, [zodu_id, "zodu_id"], [branch_id, "branch_id"])) return;
  if (!validDateRange(res, from_date, to_date)) return;

  const page  = Math.max(parseInt(req.query.page)  || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);

  try {
    const result = await service.getExpenseCategoryWise(zodu_id, branch_id, from_date, to_date, page, limit);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[report] getExpenseCategoryWise:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PROFIT REPORT ────────────────────────────────────────────

// GET /api/report/profit/yearwise?zodu_id=&branch_id=&page=&limit=
// Year-wise profit summary table with pagination
// Each row = one year's total sales, purchase, expense, profit
router.get("/profit/yearwise", async (req, res) => {
  const { zodu_id, branch_id, page = 1, limit = 10 } = req.query;
  if (!requireParams(res, [zodu_id, "zodu_id"], [branch_id, "branch_id"])) return;

  try {
    const result = await service.getProfitYearwise(zodu_id, branch_id, page, limit);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[report] getProfitYearwise:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/report/profit/active-years?zodu_id=&branch_id=
// Returns only years that have at least one sales/purchase/expense record
// Call once on page load to populate the year dropdown
router.get("/profit/active-years", async (req, res) => {
  const { zodu_id, branch_id } = req.query;
  if (!requireParams(res, [zodu_id, "zodu_id"], [branch_id, "branch_id"])) return;

  try {
    const data = await service.getProfitActiveYears(zodu_id, branch_id);
    res.json({ success: true, data });
  } catch (err) {
    console.error("[report] getProfitActiveYears:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/report/profit?zodu_id=&branch_id=&year=
// Monthly profit breakdown + yearly summary
// Profit = Sales total_amount - Purchase total_amount - Expense total_amount
router.get("/profit", async (req, res) => {
  const { zodu_id, branch_id, year } = req.query;
  if (!requireParams(res, [zodu_id, "zodu_id"], [branch_id, "branch_id"])) return;

  try {
    const data = await service.getProfitByYear(zodu_id, branch_id, year);
    res.json({ success: true, data });
  } catch (err) {
    console.error("[report] getProfitByYear:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/report/gst/gstr1/b2b/gstins?zodu_id=&branch_id=&financial_year=2026-27&month=10
// GSTIN dropdown: distinct customer GSTINs that have B2B invoices in the period
router.get("/gst/gstr1/b2b/gstins", async (req, res) => {
  const { zodu_id, branch_id, financial_year, month } = req.query;
  if (!requireParams(res, [zodu_id, "zodu_id"], [branch_id, "branch_id"], [financial_year, "financial_year"])) return;

  try {
    const data = await service.getGstr1B2BGstins(zodu_id, branch_id, financial_year, month);
    res.json({ success: true, data });
  } catch (err) {
    console.error("[report] getGstr1B2BGstins:", err.message);
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// GET /api/report/gst/gstr1/b2b?zodu_id=&branch_id=&financial_year=2026-27&month=10&gstin=&search=&page=&limit=
// Summary cards (full filtered set) + paginated B2B invoice table in one response
router.get("/gst/gstr1/b2b", async (req, res) => {
  const { zodu_id, branch_id, financial_year, month, gstin, search, page = 1, limit = 50 } = req.query;
  if (!requireParams(res, [zodu_id, "zodu_id"], [branch_id, "branch_id"], [financial_year, "financial_year"])) return;

  try {
    const result = await service.getGstr1B2B(zodu_id, branch_id, { financial_year, month, gstin, search, page, limit });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[report] getGstr1B2B:", err.message);
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// GET /api/report/gst/gstr1/b2c-large?zodu_id=&branch_id=&financial_year=2026-27&month=10&search=&page=&limit=
// Summary cards (full filtered set) + paginated B2C Large invoice table in one response
router.get("/gst/gstr1/b2c-large", async (req, res) => {
  const { zodu_id, branch_id, financial_year, month, search, page = 1, limit = 50 } = req.query;
  if (!requireParams(res, [zodu_id, "zodu_id"], [branch_id, "branch_id"], [financial_year, "financial_year"])) return;

  try {
    const result = await service.getGstr1B2CLarge(zodu_id, branch_id, { financial_year, month, search, page, limit });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[report] getGstr1B2CLarge:", err.message);
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// GET /api/report/gst/gstr1/b2c-small?zodu_id=&branch_id=&financial_year=2026-27&month=10&search=&page=&limit=
// Summary cards (full filtered set) + paginated B2C Small invoice table in one response
router.get("/gst/gstr1/b2c-small", async (req, res) => {
  const { zodu_id, branch_id, financial_year, month, search, page = 1, limit = 50 } = req.query;
  if (!requireParams(res, [zodu_id, "zodu_id"], [branch_id, "branch_id"], [financial_year, "financial_year"])) return;

  try {
    const result = await service.getGstr1B2CSmall(zodu_id, branch_id, { financial_year, month, search, page, limit });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[report] getGstr1B2CSmall:", err.message);
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// GET /api/report/gst/gstr1/nil-rated?zodu_id=&branch_id=&financial_year=2026-27&month=10&search=&page=&limit=
// Returns an empty report until invoice supply types are available in the data model.
router.get("/gst/gstr1/nil-rated", async (req, res) => {
  const { zodu_id, branch_id, financial_year, month, page = 1, limit = 50 } = req.query;
  if (!requireParams(res, [zodu_id, "zodu_id"], [branch_id, "branch_id"], [financial_year, "financial_year"])) return;

  try {
    const result = service.getGstr1NilRated({ financial_year, month, page, limit });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[report] getGstr1NilRated:", err.message);
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// GET /api/report/gst/gstr1/cdnr?zodu_id=&branch_id=&financial_year=2025-26&month=9&gstin=&search=&page=&limit=
// Returns an empty CDNR report until credit/debit note storage is implemented.
router.get("/gst/gstr1/cdnr", async (req, res) => {
  const { zodu_id, branch_id, financial_year, month, gstin, search, page = 1, limit = 50 } = req.query;
  if (!requireParams(res, [zodu_id, "zodu_id"], [branch_id, "branch_id"], [financial_year, "financial_year"])) return;

  try {
    const result = await service.getGstr1CDNR({ financial_year, month, gstin, search, page, limit });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[report] getGstr1CDNR:", err.message);
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

module.exports = router;
