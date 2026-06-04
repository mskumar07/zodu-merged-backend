const express = require("express");
const router = express.Router();
const multer = require("multer");
const RequestValidator = require("../utils/requestValidator");
const schema = require("../schema/restaurant-schema");
const service = require("../services/menu-service");
const conn = require("../database/connection");

const upload = multer({ limits: { fileSize: 500 * 1024 * 1024 } });

router.post(
  "/api/add/menu_item",
  upload.single("menu_image"),
  async (req, res) => {
    try {
      const menuData = req.body;
      await conn.query("BEGIN");
      const { errors, input } = await RequestValidator(schema.menu_item_create, menuData);
      if (errors) {
        await conn.query("ROLLBACK");
        return res.status(400).json({ errors });
      }
      const data = await service.createMenuItem(input);
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
  }
);

router.put(
  "/api/edit/menu_item/:menu_id",
  upload.single("menu_image"),
  async (req, res) => {
    const menuId = req.params.menu_id;
    const menuData = req.body;
    try {
      await conn.query("BEGIN");
      const { errors, input } = await RequestValidator(schema.menu_item_update, menuData);
      if (errors) {
        await conn.query("ROLLBACK");
        return res.status(400).json({ errors });
      }
      const result = await service.editMenuItem(menuId, input);
      if (!result.success) {
        await conn.query("ROLLBACK");
        return res.status(400).json({ message: result.message });
      }
      await conn.query("COMMIT");
      return res.status(200).json({ data: result.data });
    } catch (error) {
      await conn.query("ROLLBACK");
      console.error("Edit Menu Error:", error);
      return res.status(500).json({ error: error.message });
    }
  }
);

router.put("/update/menustatus/:menu_status/:menuId", async (req, res) => {
  try {
    const { menuId, menu_status } = req.params;
    await conn.query("BEGIN");
    const data = await service.updateMenustaus(menuId, menu_status);
    if (!data.success) {
      await conn.query("ROLLBACK");
      return res.status(400).json({ message: data.message });
    }
    await conn.query("COMMIT");
    return res.status(200).json({ data });
  } catch (error) {
    await conn.query("ROLLBACK");
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

const handleGetMenuItems = async (req, res) => {
  try {
    const { branch_id, type } = req.params;
    const { page = 1, limit = 10, search = "" } = req.query;

    const rawCategoryIds = req.query.category_ids ?? req.query["category_ids[]"];
    const category_ids = rawCategoryIds
      ? (Array.isArray(rawCategoryIds) ? rawCategoryIds : String(rawCategoryIds).split(","))
          .map((id) => parseInt(id, 10))
          .filter((id) => !isNaN(id))
      : [];

    const result = await service.get_menuItem_data(branch_id, type, page, limit, search, category_ids);
    if (!result.success) return res.status(400).json({ message: result.message });
    return res.status(200).json({ message: "Data Get Successfully", pagination: result.pagination, data: result.data });
  } catch (error) {
    console.error("Get Menu API Error =>", error);
    return res.status(500).json({ error: error.message });
  }
};

router.get("/get/menu_item/:branch_id/:type", handleGetMenuItems);
router.get("/get/menu_item/:branch_id", handleGetMenuItems);

router.delete("/delete/menu_item/:id", async (req, res) => {
  try {
    const data = await service.deleteMenuItem(req.params.id);
    if (!data.success) return res.status(400).json({ message: data.message });
    return res.status(200).json({ message: "Menu item deleted successfully", data: data.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.put("/update/menu_item/:id", async (req, res) => {
  try {
    const data = await service.updateMenuItem(req.params.id, req.body);
    if (!data.success) return res.status(400).json({ message: data.message });
    return res.status(200).json({ message: "Menu item updated successfully", data: data.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
