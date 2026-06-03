const express = require("express");
const router = express.Router();
const RequestValidator = require("../utils/requestValidator");
const schema = require("../schema/restaurant-schema");
const service = require("../services/inventory-service");
const conn = require("../database/connection");

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

router.get("/get/inventory-list/:branch_id", async (req, res) => {
  try {
    const { branch_id } = req.params;
    const { type, category } = req.query;
    const getInventoryListData = await service.getInventoryListData(branch_id, type, category);
    if (!getInventoryListData.success) return res.status(400).json({ message: getInventoryListData.message });
    return res.status(200).json({ message: "Data Get Successfully", data: getInventoryListData.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
