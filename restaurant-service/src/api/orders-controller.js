const express = require("express");
const router = express.Router();
const RequestValidator = require("../utils/requestValidator");
const schema = require("../schema/orders-schema");
const service = require("../services/orders-service");

router.post("/add/orders", async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema.order_create, req.body);
    if (errors) {
      return res.status(400).json({ errors });
    }
    const data = await service.createOrder(input);
    if (!data.success) {
      return res.status(400).json({ message: data.message });
    }
    return res.status(201).json(data);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.get("/get/orders/:branch_id", async (req, res) => {
  try {
    const { branch_id } = req.params;
    const getMenuItemData = await service.get_ordered_data(branch_id);
    if (!getMenuItemData.success) return res.status(400).json({ message: getMenuItemData.message });
    return res.status(200).json({ message: "Data Get Successfully", data: getMenuItemData.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.get("/api/order/:zodu_id/:branch_id/:api_order_id", async (req, res) => {
  try {
    const { zodu_id, branch_id, api_order_id } = req.params;
    const result = await service.getSingleOrder(zodu_id, branch_id, api_order_id);
    return res.status(200).json({ message: "Order fetched successfully", data: result });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.get("/api/report/orders", async (req, res) => {
  try {
    const {
      filtered_type = "all_orders",
      zodu_id,
      branch_id,
      page = 1,
      limit = 10,
      start_date,
      end_date,
      year,
      search
    } = req.query;

    if (!zodu_id || !branch_id) {
      return res.status(400).json({ success: false, message: "zodu_id and branch_id are required" });
    }

    const pageNum = Number(page);
    const limitNum = Number(limit);
    const result = await service.getReportServices(zodu_id, branch_id, pageNum, limitNum, filtered_type, start_date, end_date, year, search);

    if (!result.success) {
      return res.status(400).json({ success: false, message: result.message });
    }

    let response;
    if (filtered_type === "date_wise") {
      response = {
        success: true,
        datewise_summary: result.datewise_summary,
        totalAmount: result.totalAmount,
        totalItems: result.totalItems,
        pagination: result.pagination,
      };
    } else if (filtered_type === "month_year_wise") {
      response = {
        success: true,
        monthly_summary: result.monthly_summary,
        totalAmount: result.totalAmount,
        totalItems: result.totalItems,
      };
    } else {
      response = {
        success: true,
        all_orders: result.data,
        totalAmount: result.totalAmount,
        totalItems: result.totalItems,
        pagination: result.pagination,
      };
    }

    return res.status(200).json(response);
  } catch (err) {
    console.error("REPORT ERROR:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/get/report/order-category", async (req, res) => {
  try {
    const { zodu_id, branch_id, page = 1, limit = 10, search = "" } = req.query;
    const data = await service.getReportCategory(zodu_id, branch_id, Number(page), Number(limit), search);
    if (!data.success) return res.status(400).json({ message: data.message });
    return res.status(200).json({
      message: "Data Get Successfully",
      summary: data.summary,
      pagination: data.pagination,
      data: data.data
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
