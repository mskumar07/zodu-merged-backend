const express = require("express");
const router  = express.Router();
const service = require("../services/dashboard-service");

function requireParams(res, ...params) {
  const missing = params.filter(([val]) => !val).map(([, name]) => name);
  if (missing.length) {
    res.status(400).json({ error: `Missing required params: ${missing.join(", ")}` });
    return false;
  }
  return true;
}

async function getStats(req, res) {
  const { zodu_id, branch_id } = req.query;
  if (!requireParams(res, [zodu_id, "zodu_id"], [branch_id, "branch_id"])) return;
console.log(zodu_id,branch_id)
  try {
    const data = await service.getStats(zodu_id, branch_id);
    
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getSales(req, res) {
  const { zodu_id, branch_id, cursor, limit } = req.query;
  if (!requireParams(res, [zodu_id, "zodu_id"], [branch_id, "branch_id"])) return;
  console.log(zodu_id,branch_id,cursor,limit)

  try {
    const result = await service.getSales(zodu_id, branch_id, limit, cursor);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getTopItems(req, res) {
  const { zodu_id, branch_id, cursor, limit } = req.query;
  if (!requireParams(res, [zodu_id, "zodu_id"], [branch_id, "branch_id"])) return;

  try {
    const result = await service.getTopItems(zodu_id, branch_id, limit, cursor);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getReminders(req, res) {
  const { zodu_id, branch_id, page, limit } = req.query;
  if (!requireParams(res, [zodu_id, "zodu_id"], [branch_id, "branch_id"])) return;

  try {
    const result = await service.getReminders(zodu_id, branch_id, page, limit);
    res.json({ success: true, ...result });
  } catch (err) {
    console.log(err)
    res.status(500).json({ error: err.message });
  }
}

async function getInventoryAlerts(req, res) {
  const { zodu_id, branch_id, cursor, limit } = req.query;
  if (!requireParams(res, [zodu_id, "zodu_id"], [branch_id, "branch_id"])) return;

  try {
    const result = await service.getInventoryAlerts(zodu_id, branch_id, limit, cursor);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── Routes ────────────────────────────────────────────────────
router.get("/stats",             getStats);
router.get("/sales",             getSales);
router.get("/top-items",         getTopItems);
router.get("/reminders",         getReminders);
router.get("/inventory-alerts",  getInventoryAlerts);

module.exports = router;