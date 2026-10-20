const express = require("express");
const router  = express.Router();
const service = require("../services/accounting-service");

// GET /api/accounting?zodu_id=&branch_id=&from_date=&to_date=&type=&search=&page=&limit=
// Accounting day book: sales, receipts, purchases, payments, expenses, returns and credit / debit
// notes in one newest-first list with a running balance, plus the summary cards for the period.
// `type` is one ledger type or a comma list, e.g. "Sales,Receipt".
router.get("/", async (req, res) => {
  const { zodu_id, branch_id, from_date, to_date, type, search, page = 1, limit = 20 } = req.query;
  const missing = [["zodu_id", zodu_id], ["branch_id", branch_id]].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    return res.status(400).json({ success: false, error: `Missing required params: ${missing.join(", ")}` });
  }

  try {
    const result = await service.getAccounting(zodu_id, branch_id, { from_date, to_date, type, search, page, limit });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[accounting] getAccounting:", err.message);
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

module.exports = router;
