const express = require("express");
const router = express.Router();
const service = require("../services/branch-service");

router.get("/:zodu_id", async (req, res) => {
  try {
    const { zodu_id } = req.params;
    const result = await service.getBranches(zodu_id);

    if (!result.success) {
      return res.status(400).json({ message: result.message });
    }

    return res.status(200).json({
      message: "Branches fetched successfully",
      data: result.data
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.get("/:zodu_id/:branch_id", async (req, res) => {
  try {
    const { zodu_id, branch_id } = req.params;
    const result = await service.getBranches(zodu_id, branch_id);

    if (!result.success) {
      return res.status(400).json({ message: result.message });
    }

    return res.status(200).json({
      message: "Branch fetched successfully",
      data: result.data
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
