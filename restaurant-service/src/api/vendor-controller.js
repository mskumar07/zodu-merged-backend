const express = require("express");
const router = express.Router();
const service = require("../services/vendor-service");

router.post("/", async (req, res) => {
  const result = await service.createVendor(req.body);
  return res.status(result.success ? 201 : 400).json(result);
});

router.get("/", async (req, res) => {
  const result = await service.getVendors(req.query);
  return res.status(200).json(result);
});

router.put("/:id", async (req, res) => {
  const result = await service.updateVendor(req.params.id, req.body);
  return res.status(result.success ? 200 : 400).json(result);
});

router.delete("/:id", async (req, res) => {
  const result = await service.deleteVendor(req.params.id);
  return res.status(result.success ? 200 : 400).json(result);
});

module.exports = router;