const express = require("express");
const router = express.Router();
const multer = require("multer");
const RequestValidator = require("../utils/requestValidator");
const schema = require("../schema/restaurant-schema");
const service = require("../services/menu-service");
const security = require("../security");
const owned = require("../security/owned");

// The menu image is uploaded beforehand (POST /upload) and arrives here as a URL;
// a file sent in menu_image is ignored. Keep the in-memory part small.
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } });

// zodu_id / branch_id in a path: the caller's company, a branch they may use.
security.protectParams(router);
// Menu item ids (menu_id, unique across companies): the caller's company only.
const menuItem = owned.param("tbl_menu_items", "menu_id");
router.param("menu_id", menuItem);
router.param("menuId", menuItem);
router.param("id", menuItem);

router.post(
  "/api/add/menu_item",
  upload.single("menu_image"),
  async (req, res) => {
    try {
      const menuData = req.body;
      const { errors, input } = await RequestValidator(schema.menu_item_create, menuData);
      if (errors) {
        return res.status(400).json({ errors });
      }
      const data = await service.createMenuItem(input);
      if (!data.success) {
        return res.status(400).json({ message: data.message });
      }
      return res.status(201).json({ data });
    } catch (error) {
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
      const { errors, input } = await RequestValidator(schema.menu_item_update, menuData);
      if (errors) {
        return res.status(400).json({ errors });
      }
      const result = await service.editMenuItem(menuId, input);
      if (!result.success) {
        return res.status(400).json({ message: result.message });
      }
      return res.status(200).json({ data: result.data });
    } catch (error) {
      console.error("Edit Menu Error:", error);
      return res.status(500).json({ error: error.message });
    }
  }
);

router.put("/update/menustatus/:menu_status/:menuId", async (req, res) => {
  try {
    const { menuId, menu_status } = req.params;
    const data = await service.updateMenustaus(menuId, menu_status);
    if (!data.success) {
      return res.status(400).json({ message: data.message });
    }
    return res.status(200).json({ data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.put("/update/menusfav/:fav/:menuId", async (req, res) => {
  try {
    const { menuId, fav } = req.params;
    const data = await service.updateMenusFav(menuId, fav);
    if (!data.success) {
      return res.status(400).json({ message: data.message });
    }
    return res.status(200).json({ data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

const handleGetMenuItems = async (req, res) => {
  try {
    const { zodu_id, branch_id, type: typeParam } = req.params;
    const { page = 1, limit = 10, search = "", type: typeQuery } = req.query;
    const type = typeParam || typeQuery || "";

    const rawCategoryIds = req.query.category_ids ?? req.query["category_ids[]"];
    const category_ids = rawCategoryIds
      ? (Array.isArray(rawCategoryIds) ? rawCategoryIds : String(rawCategoryIds).split(","))
          .map((id) => parseInt(id, 10))
          .filter((id) => !isNaN(id))
      : [];

    const result = await service.get_menuItem_data(zodu_id,branch_id, type, page, limit, search, category_ids);
    if (!result.success) return res.status(400).json({ message: result.message });
    return res.status(200).json({ message: "Data Get Successfully", pagination: result.pagination, data: result.data });
  } catch (error) {
    console.error("Get Menu API Error =>", error);
    return res.status(500).json({ error: error.message });
  }
};

router.get("/get/menu_item/:zodu_id/:branch_id/:type", handleGetMenuItems);
router.get("/get/menu_item/:zodu_id/:branch_id", handleGetMenuItems);

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


//  GET /restaurant/api/check/item_id
//  Check if item_id already exists for a given zodu_id + branch_id
//  Query params: zodu_id, branch_id, item_id
// ─────────────────────────────────────────────────────────────
router.get('/check/item_id', async (req, res) => {
  try {
    const { zodu_id, branch_id, item_id } = req.query;
    if (!zodu_id || !branch_id || !item_id) {
      return res.status(400).json({
        success: false,
        error: 'zodu_id, branch_id, and item_id are required',
      });
    }
    const result = await service.checkItemIdExists({ item_id, zodu_id, branch_id });
    return res.status(200).json({
      success: true,
      exists: result.exists,
      ...(result.exists && { data: result.data }),
    });
  } catch (error) {
    console.error('[menu] checkItemId error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.put("/update/menu_item/:id", upload.single("menu_image"), async (req, res) => {
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
