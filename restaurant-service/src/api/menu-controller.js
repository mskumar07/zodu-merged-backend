const express = require("express");
const RequestValidator = require("../utils/requestValidator");
const router = express.Router();
const schema = require("../schema/restaurant-schema");
const service = require("../services/menu-service");


const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 
// ─────────────────────────────────────────────────────────────
//  POST /restaurant/api/add/menu_item
//  Create a new menu item
// ─────────────────────────────────────────────────────────────
router.post("/add/menu_item", async (req, res) => {
  try {
    console.log("[menu] create request:", req.body);
 
    const { errors, input } = await RequestValidator(schema.createSchema, req.body);
    if (errors) {
      return res.status(400).json({ success: false, errors });
    }
 
    const result = await service.createMenuItem(input);
 
    if (!result.success) {
      return res.status(400).json({ success: false, message: result.message });
    }
 
    return res.status(201).json({
      success: true,
      message: result.message,
      data:    result.data,
    });
  } catch (error) {
    console.log(err)
    console.error("[menu] create error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});
 
// ─────────────────────────────────────────────────────────────
//  PUT /restaurant/api/edit/menu_item/:item_uuid
//  Partially update an existing menu item
// ─────────────────────────────────────────────────────────────
router.put("/edit/menu_item/:item_uuid", async (req, res) => {
  try {
    const { item_uuid } = req.params;


 
    if (!UUID_REGEX.test(item_uuid)) {
      return res.status(400).json({ success: false, error: "Invalid item_uuid format" });
    }
 
    console.log("[menu] edit request:", item_uuid, req.body);
 
    const { errors, input } = await RequestValidator(schema.editSchema, req.body);
    if (errors) {
      console.log(errors)
      return res.status(400).json({ success: false, errors });
    }
 
    const result = await service.editMenuItem(item_uuid, input);
 
    if (!result.success) {
      // Surface 404 clearly if item not found
      const status = result.message === "Menu item not found" ? 404 : 400;
      return res.status(status).json({ success: false, message: result.message });
    }
 
    return res.status(200).json({
      success: true,
      message: result.message,
      data:    result.data,
    });
  } catch (error) {
    console.log(error)
    console.error("[menu] edit error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});


router.get("/menu_items", async (req, res) => {
  try {
    const {
      zodu_id,
      branch_id,
      search,
      category_id,
      item_type,
      status,
      page  = "1",
      limit = "20",
    } = req.query;
 
    if (!zodu_id || !branch_id) {
      return res.status(400).json({
        success: false,
        error: "zodu_id and branch_id are required query parameters",
      });
    }
 
    const parsedPage  = Math.max(1, parseInt(page,  10) || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
 
    const result = await service.getMenuItems({
      zodu_id,
      branch_id,
      search:      search      || null,
      category_id: category_id ? Number(category_id) : null,
      item_type:   item_type   || null,
      status:      status      || null,
      page:        parsedPage,
      limit:       parsedLimit,
    });
 
    if (!result.success) {
      return res.status(400).json({ success: false, message: result.message });
    }
 
    return res.status(200).json({
      success:     true,
      total:       result.total,
      page:        result.page,
      limit:       result.limit,
      total_pages: result.total_pages,
      data:        result.data,
    });
  } catch (error) {
    console.error("[menu] getMenuItems error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});
 
// ─────────────────────────────────────────────────────────────
//  DELETE /restaurant/api/delete/menu_item/:item_uuid
//  Soft-delete a menu item (sets status = 'inactive')
// ─────────────────────────────────────────────────────────────
router.delete("/api/delete/menu_item/:item_uuid", async (req, res) => {
  try {
    const { item_uuid } = req.params;
 
    if (!UUID_REGEX.test(item_uuid)) {
      return res.status(400).json({ success: false, error: "Invalid item_uuid format" });
    }
 
    const result = await service.deleteMenuItem(item_uuid);
 
    if (!result.success) {
      const status = result.message === "Menu item not found" ? 404 : 400;
      return res.status(status).json({ success: false, message: result.message });
    }
 
    return res.status(200).json({
      success: true,
      message: result.message,
      data:    result.data,
    });
  } catch (error) {
    console.error("[menu] deleteMenuItem error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/menu_item/:item_uuid", async (req, res) => {
  try {
    const { item_uuid } = req.params;
 
    if (!UUID_REGEX.test(item_uuid)) {
      return res.status(400).json({ success: false, error: "Invalid item_uuid format" });
    }
 
    const result = await service.getMenuItemById(item_uuid);
 
    if (!result.success) {
      const status = result.message === "Menu item not found" ? 404 : 400;
      return res.status(status).json({ success: false, message: result.message });
    }
 
    return res.status(200).json({ success: true, data: result.data });
  } catch (error) {
    console.error("[menu] getMenuItemById error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/inventory/summary', async (req, res) => {
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

router.get('/inventory/list', async (req, res) => {
  try {
    const {
      zodu_id,
      branch_id,
      search,
      category_id,
      stock_status,
      page  = '1',
      limit = '20',
    } = req.query;
 
    if (!zodu_id || !branch_id) {
      return res.status(400).json({
        success: false,
        error: 'zodu_id and branch_id are required',
      });
    }
 
    const VALID_STATUSES = ['in_stock', 'low_stock', 'out_of_stock'];
    if (stock_status && !VALID_STATUSES.includes(stock_status)) {
      return res.status(400).json({
        success: false,
        error: `stock_status must be one of: ${VALID_STATUSES.join(', ')}`,
      });
    }
 
    const result = await service.getInventoryList({
      zodu_id,
      branch_id,
      search:       search       || null,
      category_id:  category_id  ? Number(category_id) : null,
      stock_status: stock_status || null,
      page:         Math.max(1, parseInt(page,  10) || 1),
      limit:        Math.min(100, parseInt(limit, 10) || 20),
    });
 
    if (!result.success) {
      return res.status(400).json({ success: false, message: result.message });
    }
 
    return res.status(200).json({
      success:     true,
      total:       result.total,
      page:        result.page,
      limit:       result.limit,
      total_pages: result.total_pages,
      data:        result.data,
    });
  } catch (error) {
    console.error('[inventory] list error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/inventory/:inventory_uuid', async (req, res) => {
  try {
    const { inventory_uuid } = req.params;
 
    if (!UUID_REGEX.test(inventory_uuid)) {
      return res.status(400).json({ success: false, error: 'Invalid inventory_uuid format' });
    }
 
    const result = await service.getInventoryDetail(inventory_uuid);
 
    if (!result.success) {
      const status = result.message === 'Inventory record not found' ? 404 : 400;
      return res.status(status).json({ success: false, message: result.message });
    }
 
    return res.status(200).json({ success: true, data: result.data });
  } catch (error) {
    console.error('[inventory] detail error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/inventory/adjust', async (req, res) => {
  try {
    const {
      inventory_uuid,
      adjustment_type,
      adjustment_qty,
      reason,
      notes,
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
