const express = require("express");
const router = express.Router();
const service = require("../services/dashboard-service");

router.get("/summary/:zodu_id/:branch_id", async (req, res) => {
  try {
    const { zodu_id, branch_id } = req.params;
    const { dateType = "today", fromDate, toDate } = req.query;

    const result = await service.getDashboardSummary(
      zodu_id,
      branch_id,
      { dateType, fromDate, toDate }
    );

    return res.status(200).json({
      message: "Summary fetched successfully",
      data: result.data
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});


router.get("/orders/:zodu_id/:branch_id", async (req, res) => {
  try {
    const { zodu_id, branch_id } = req.params;
    const {
      page = 1,
      limit = 10,
      sortOrder = "desc",
      dateType = "today",
      fromDate,
      toDate
    } = req.query;

    const result = await service.getDashboardOrders(
      zodu_id,
      branch_id,
      {
        page: +page,
        limit: +limit,
        sortOrder,
        dateType,
        fromDate,
        toDate
      }
    );

    console.log(result)

    return res.status(200).json({
      message: "Orders fetched successfully",
      data: result.data,
      pagination: result.pagination
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.get("/expenses/:zodu_id/:branch_id", async (req, res) => {
  try {
    const { zodu_id, branch_id } = req.params;
    const {
      page = 1,
      limit = 10,
      sortOrder = "desc",
      dateType = "today",
      fromDate,
      toDate
    } = req.query;

    const result = await service.getDashboardExpenses(
      zodu_id,
      branch_id,
      {
        page: +page,
        limit: +limit,
        sortOrder,
        dateType,
        fromDate,
        toDate
      }
    );

    return res.status(200).json({
      message: "Expenses fetched successfully",
      data: result.data,
      pagination: result.pagination
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.get("/top-items/:zodu_id/:branch_id", async (req, res) => {
  try {
    const { zodu_id, branch_id } = req.params;
    const {
      page = 1,
      limit = 5,
      dateType = "today",
      fromDate,
      toDate
    } = req.query;

    console.log("test",req.query)

    const result = await service.getDashboardTopItems(
      zodu_id,
      branch_id,
      {
        page: +page,
        limit: +limit,
        dateType,
        fromDate,
        toDate
      }
    );

    return res.status(200).json({
      message: "Top items fetched successfully",
      data: result.data,
      pagination: result.pagination
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});


router.get("/datewise/:zodu_id/:branch_id/", async (req, res) => {
  try {
    const { zodu_id, branch_id } = req.params;
    const {
      page = 1,
      limit = 7
    } = req.query;

    const result = await service.getDashboardDatewise(
      zodu_id,
      branch_id,
      {
        page: +page,
        limit: +limit
      }
    );

    return res.status(200).json({
      message: "Datewise sales fetched successfully",
      data: result.data,
      pagination: result.pagination
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});


module.exports = router;
