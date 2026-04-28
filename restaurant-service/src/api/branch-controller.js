const express = require("express");
const router = express.Router();
const service = require("../services/branch-service");
const restaurantService = require("../services/restaurant-service");
const RequestValidator = require("../utils/requestValidator");
const schema = require("../schema/restaurant-schema");
const STATUS_CODES = require("../utils/error/status-codes");

// Internal — called by auth-service during signup to create the default B1 branch
router.post("/signup-default", async (req, res) => {
  try {
    const { zodu_id, branch_name, branch_mobile_no, branch_mail_id } = req.body;
    console.log("REQ BODY:", req.body);
    if (!zodu_id || !branch_name) {
      return res.status(400).json({ success: false, error: 'zodu_id and branch_name are required' });
    }
    const result = await restaurantService.createDefaultBranchService({ zodu_id, branch_name, branch_mobile_no, branch_mail_id });
    if (!result.success) {
      console.log(result)
      return res.status(400).json({ success: false, error: result.message });
    }
          console.log(result)

    return res.status(200).json({ success: true, branch_id: result.branch_id });
  } catch (err) {
    console.log(err)
    console.error('[createDefaultBranch]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

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

router.put("/:zodu_id/:branch_id", async (req, res) => {
  try {
    const { zodu_id, branch_id } = req.params;
    const { errors, input } = await RequestValidator(schema.update_branch, req.body);
console.log("edit",errors)
    if (errors) {

      return res.status(STATUS_CODES.BAD_REQUEST).json({ errors });
    }

    const result = await service.updateBranch(zodu_id, branch_id, input);

    if (!result.success) {
      return res.status(result.message === "Branch not found" ? STATUS_CODES.NOT_FOUND : STATUS_CODES.BAD_REQUEST)
        .json({ message: result.message });
    }

    return res.status(200).json({
      message: "Branch updated successfully",
      data: result.data
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
