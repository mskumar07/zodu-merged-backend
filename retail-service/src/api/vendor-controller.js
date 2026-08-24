const express = require("express");
const router = express.Router();
const service = require("../services/vendor-service");

router.post("/", async (req, res) => {
  try {
    const result = await service.createVendor(req.body);
    return res.status(result.success ? 201 : 400).json(result);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/", async (req, res) => {
  try {
    const result = await service.getVendors(req.query);
    return res.status(200).json(result);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const result = await service.getVendorById(req.params.id);
    return res.status(result.success ? 200 : 404).json(result);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const result = await service.updateVendor(req.params.id, req.body);
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const result = await service.deleteVendor(req.params.id);
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
