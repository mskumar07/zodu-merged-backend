const express = require("express");
const router = express.Router();
const RequestValidator = require("../utils/requestValidator");
const schema = require("../schema/restaurant-schema");
const service = require("../services/inventory-service");
const conn = require("../database/connection");


const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


router.post("/api/add/inventory", async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema.Inventory, req.body);
    if (errors) {
      return res.status(400).json({ success: false, error: errors });
    }
    const data = await service.addin_Inventory(input);
    if (!data.success) {
      return res.status(400).json({ message: data.message });
    }
    return res.status(201).json({ data });
  } catch (err) {
    console.error("Inventory Add Failed", err.message);
    return res.status(500).json({ success: false, message: err.message || "Internal server error" });
  }
});

router.put("/api/update/inventory", async (req, res) => {
  try {
    const items = req.body;
    await conn.query("BEGIN");
    const { errors, input } = await RequestValidator(schema.inventorySchema, items);
    if (errors) {
      await conn.query("ROLLBACK");
      return res.status(400).json({ errors });
    }
    const data = await service.update_Inventory(input);
    if (!data.success) {
      await conn.query("ROLLBACK");
      return res.status(400).json({ message: data.message });
    }
    await conn.query("COMMIT");
    return res.status(201).json({ data });
  } catch (error) {
    await conn.query("ROLLBACK");
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.get("/get/inventory-list/:zodu_id/:branch_id", async (req, res) => {
  try {
    const { zodu_id, branch_id } = req.params;
    const { type, page, limit, search } = req.query;
    const category = [].concat(req.query["category[]"] || req.query["category"] || []);
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 10);
    const result = await service.getInventoryListData(zodu_id, branch_id, type, category, search, pageNum, limitNum);
    if (!result.success) return res.status(400).json({ message: result.message });
    return res.status(200).json({
      message: "Data Get Successfully",
      data: result.data,
      total_count: result.pagination.total_count,
      total_pages: result.pagination.total_pages,
      current_page: result.pagination.current_page,
      limit: result.pagination.limit,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.get('/summary', async (req, res) => {
  try {
    const { zodu_id, branch_id } = req.query;
 
    if (!zodu_id || !branch_id) {
      return res.status(400).json({
        success: false,
        error: 'zodu_id and branch_id are required',
      });
    }
 
    const result = await service.getInventorySummary({ zodu_id, branch_id });
 
    if (!result.success) {
      return res.status(400).json({ success: false, message: result.message });
    }
 
    return res.status(200).json({ success: true, data: result.data });
  } catch (error) {
    console.error('[inventory] summary error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/adjust', async (req, res) => {
  try {
    const {
      inventory_uuid,
      adjustment_type,
      adjustment_qty,
      reason,
      notes,
      stock_alert
    } = req.body;
 
    // Basic validation
    if (!inventory_uuid || !UUID_REGEX.test(inventory_uuid)) {
      return res.status(400).json({ success: false, error: 'Valid inventory_uuid is required' });
    }
 
    if (!adjustment_type) {
      return res.status(400).json({ success: false, error: 'adjustment_type is required' });
    }
 
    if (adjustment_qty == null) {
      return res.status(400).json({ success: false, error: 'adjustment_qty is required' });
    }
 
    if (!reason) {
      return res.status(400).json({ success: false, error: 'reason is required' });
    }
    const result = await service.adjustStock({
      inventory_uuid,
      adjustment_type,
      adjustment_qty: Number(adjustment_qty),
      reason,
      notes,
      stock_alert
    });
    if (!result.success) {
      return res.status(400).json({ success: false, message: result.message });
    }
    return res.status(200).json({
      success: true,
      message: result.message,
      data:    result.data,
    });
  } catch (error) {
    console.error('[inventory] adjust error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});


router.get('/stock/history/:item_uuid', async (req, res) => {
  try {
    const { item_uuid } = req.params;
    const { zodu_id, branch_id } = req.query;

    if (!item_uuid || !zodu_id || !branch_id) {
      return res.status(400).json({
        success: false,
        message: "Missing required parameters",
      });
    }

    const result = await service.getStockHistoryService({
      item_uuid,
      zodu_id,
      branch_id,
    });

    return res.json({
      success: true,
      ...result,
    });

  } catch (err) {
    console.error("Stock History Error:", err);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
});



module.exports = router;
