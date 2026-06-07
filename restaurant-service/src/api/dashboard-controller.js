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

router.get("/orders/:zodu_id", async (req, res) => {
  try {
    const { zodu_id } = req.params;
    const {
      branch_id,
      page = 1,
      limit = 10,
      sortOrder = "desc"
    } = req.query;

    if (!branch_id) {
      return res.status(400).json({ error: "Missing required param: branch_id" });
    }

    const result = await service.getDashboardOrders(zodu_id, branch_id, {
      page: +page,
      limit: +limit,
      sortOrder
    });

    return res.status(200).json({
      success: true,
      message: "Orders fetched successfully",
      data: result.data,
      pagination: result.pagination
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

async function getTopItems(req, res) {
  const { zodu_id, branch_id, page = 1, limit = 10 } = req.query;
  if (!requireParams(res, [zodu_id, "zodu_id"], [branch_id, "branch_id"])) return;

  try {
    const result = await service.getDashboardTopItems(zodu_id, branch_id, {
      page: +page,
      limit: +limit,
    });
    return res.status(200).json({
      success: true,
      message: "Top items fetched successfully",
      data: result.data,
      pagination: result.pagination,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getReminders(req, res) {
  const { zodu_id, branch_id, cursor, limit } = req.query;
  if (!requireParams(res, [zodu_id, "zodu_id"], [branch_id, "branch_id"])) return;

  try {
    const result = await service.getReminders(zodu_id, branch_id, limit, cursor);
    res.json({ success: true, ...result });
  } catch (err) {
    console.log(err)
    res.status(500).json({ error: err.message });
  }
}

router.get("/summary/:zodu_id/:branch_id", async (req, res) => {
  try {
    const { zodu_id, branch_id } = req.params;

    // const today = new Date().toISOString().split("T")[0];
    // const fromDate = today;
    // const toDate = today;

    const result = await service.getDashboardSummary(
      zodu_id,
      branch_id,
      // { fromDate, toDate }
    );

    return res.status(200).json({
      message: "Summary fetched successfully",
      data: result
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

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