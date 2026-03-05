const repository = require("../repository/dashboard-repo");
const { getPagination, getMeta } = require("../utils/pagination");

const normalizeBranchIds = (branchIds) => {
  const normalized = Array.isArray(branchIds)
    ? branchIds
      .flatMap((value) => String(value).split(","))
      .map((value) => value.trim())
      .filter(Boolean)
    : String(branchIds ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

  if (normalized.some((value) => value.toLowerCase() === "all")) {
    return [];
  }

  return normalized;
};

async function getDashboardSummary(zodu_id, branchIds, options) {
  try {
    const { dateType = "today", fromDate, toDate } = options;
    const normalizedBranchIds = normalizeBranchIds(branchIds);

    const result = await repository.getDashboardSummary(
      zodu_id,
      normalizedBranchIds,
      { dateType, fromDate, toDate }
    );

    return {
      success: true,
      data: result
    };
  } catch (err) {
    console.error("Dashboard Summary Error:", err);
    return { success: false, message: err.message };
  }
}

async function getDashboardOrders(zodu_id, branchIds, options) {
  try {
    const {
      page = 1,
      limit = 10,
      sortOrder = "desc",
      dateType = "today",
      fromDate,
      toDate
    } = options;

    const normalizedBranchIds = normalizeBranchIds(branchIds);
    const pagination = getPagination({ page, limit });

    const result = await repository.getDashboardOrders(
      zodu_id,
      normalizedBranchIds,
      pagination,
      sortOrder,
      { dateType, fromDate, toDate }
    );

    return {
      success: true,
      data: result.rows,
      pagination: getMeta({ ...pagination, total: result.count })
    };
  } catch (err) {
    console.error("Dashboard Orders Error:", err);
    return { success: false, message: err.message };
  }
}

async function getDashboardExpenses(zodu_id, branchIds, options) {
  try {
    const {
      page = 1,
      limit = 10,
      sortOrder = "desc",
      dateType = "today",
      fromDate,
      toDate
    } = options;

    const normalizedBranchIds = normalizeBranchIds(branchIds);
    const pagination = getPagination({ page, limit });

    const result = await repository.getDashboardExpenses(
      zodu_id,
      normalizedBranchIds,
      pagination,
      sortOrder,
      { dateType, fromDate, toDate }
    );

    return {
      success: true,
      data: result.rows,
      pagination: getMeta({ ...pagination, total: result.count })
    };
  } catch (err) {
    console.error("Dashboard Expenses Error:", err);
    return { success: false, message: err.message };
  }
}

async function getDashboardTopItems(zodu_id, branchIds, options) {
  try {
    const {
      page = 1,
      limit = 5,
      dateType = "today",
      fromDate,
      toDate
    } = options;

    const normalizedBranchIds = normalizeBranchIds(branchIds);
    const pagination = getPagination({ page, limit });

    const result = await repository.getDashboardTopItems(
      zodu_id,
      normalizedBranchIds,
      pagination,
      { dateType, fromDate, toDate }
    );

    return {
      success: true,
      data: result.rows,
      pagination: getMeta({ ...pagination, total: result.count })
    };
  } catch (err) {
    console.error("Dashboard Top Items Error:", err);
    return { success: false, message: err.message };
  }
}

async function getDashboardDatewise(zodu_id, branchIds, options) {
  try {
    const {
      page = 1,
      limit = 7
    } = options;

    const normalizedBranchIds = normalizeBranchIds(branchIds);
    const pagination = getPagination({ page, limit });

    const result = await repository.getDashboardDatewiseSales(
      zodu_id,
      normalizedBranchIds,
      pagination
    );

    return {
      success: true,
      data: result.rows,
      pagination: getMeta({ ...pagination, total: result.count })
    };
  } catch (err) {
    console.error("Dashboard Datewise Error:", err);
    return { success: false, message: err.message };
  }
}

module.exports = {
  getDashboardSummary,
  getDashboardOrders,
  getDashboardExpenses,
  getDashboardTopItems,
  getDashboardDatewise
};
