const express = require("express");
const router = express.Router();
const service = require("../services/gstStateCode-service");

// GET /api/gst-state-code?search=tamil&include_inactive=true
router.get("/", async (req, res) => {
  try {
    const result = await service.getStateCodes(req.query);
    return res.status(200).json(result);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/gst-state-code/33  or  /api/gst-state-code/33ABCDE1234F1Z5 (GSTIN)
router.get("/:code", async (req, res) => {
  try {
    const result = await service.getByStateCode(req.params.code);
    return res.status(result.success ? 200 : 404).json(result);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
