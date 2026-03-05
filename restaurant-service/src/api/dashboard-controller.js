const express = require("express");
const router = express.Router();
const service = require("../services/dashboard-service");

const parseBranchIds = (rawBranchIds) => {
  const parsed = Array.isArray(rawBranchIds)
    ? rawBranchIds
      .flatMap((value) => String(value).split(","))
      .map((value) => value.trim())
      .filter(Boolean)
    : String(rawBranchIds ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

  if (parsed.some((value) => value.toLowerCase() === "all")) {
    return [];
  }

  return parsed;
};

const getRequestedBranchIds = (req) => {
  const branchIdsFromQuery = req.query.branch_ids ?? req.query.branchIds;
  const rawBranchIds = branchIdsFromQuery ?? req.params.branch_id;

  return parseBranchIds(rawBranchIds);
};

const getSummaryBranchIds = (req) => {
  const branchIdsFromQuery = req.query.branch_ids ?? req.query.branchIds;
  return parseBranchIds(branchIdsFromQuery);
};

router.get("/summary/:zodu_id", async (req, res) => {
  try {
    const { zodu_id } = req.params;
    const branchIds = getSummaryBranchIds(req);
    console.log(branchIds)
    const { dateType = "today", fromDate, toDate } = req.query;

    const result = await service.getDashboardSummary(
      zodu_id,
      branchIds,
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

router.get("/orders/:zodu_id", async (req, res) => {
  try {
    const { zodu_id } = req.params;
    const branchIds = getRequestedBranchIds(req);
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
      branchIds,
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
      message: "Orders fetched successfully",
      data: result.data,
      pagination: result.pagination
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.get("/expenses/:zodu_id", async (req, res) => {
  try {
    const { zodu_id } = req.params;
    const branchIds = getRequestedBranchIds(req);
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
      branchIds,
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

router.get("/top-items/:zodu_id", async (req, res) => {
  try {
    const { zodu_id } = req.params;
    const branchIds = getRequestedBranchIds(req);
    const {
      page = 1,
      limit = 5,
      dateType = "today",
      fromDate,
      toDate
    } = req.query;

    const result = await service.getDashboardTopItems(
      zodu_id,
      branchIds,
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

router.get("/datewise/:zodu_id", async (req, res) => {
  try {
    const { zodu_id } = req.params;
    const branchIds = getRequestedBranchIds(req);
    const {
      page = 1,
      limit = 10
    } = req.query;

    const result = await service.getDashboardDatewise(
      zodu_id,
      branchIds,
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
