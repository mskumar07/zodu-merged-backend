const express = require("express");
const router = express.Router();
const RequestValidator = require("../utils/requestValidator");
const schema = require("../schema/restaurant-schema");
const service = require("../services/hold-item-service");

router.post("/add/hold_menu", async (req, res) => {
  console.log(req.body)
  try {
    const { errors, input } = await RequestValidator(
      schema.holdSchema,
      req.body
    );
    if (errors) {
      return res.status(400).json({ success: false, error: errors });
    }
    const data = await service.addHoldMenu(input);

    if (!data.success) {
      return res.status(400).json({ message: data.message });
    }

    return res.status(201).json({ data });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error adding hold:", error);
    res.status(500).json({ error: "Failed to save hold" });
  }
});

router.delete("/delete/hold-menu/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const data = await service.deleteHoldMenu(id);
    if (!data.success) {
      return res.status(400).json({ message: data.message });
    }
    return res.status(201).json({ data });
  } catch (error) {
    console.error("Error deleting hold:", error);
    res.status(500).json({ error: "Failed to delete hold" });
  }
});

router.get("/get/hold-orders/:branch_id", async (req, res) => {

  try {
    const { branch_id } = req.params;
    const getHoldData = await service.getHoldData(branch_id);
    if (!getHoldData.success) return res.status(400).json({ message: getHoldData.message });
    return res.status(201).json({ message: "Holds fetched successfully", Data: getHoldData.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
