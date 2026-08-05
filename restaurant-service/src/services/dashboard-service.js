const repo = require("../repository/dashboard-repo");

const DEFAULT_LIMIT = 20;
const MAX_LIMIT     = 100;

function decodeCursor(token) {
  if (!token) return null;
  try {
    return JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function encodeCursor(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function paginate(rows, limit, cursorKeysFn) {
  const hasMore = rows.length > limit;
  const data    = hasMore ? rows.slice(0, limit) : rows;
  return {
    data,
    pagination: {
      hasMore,
      nextCursor: hasMore ? encodeCursor(cursorKeysFn(data.at(-1))) : null,
      count: data.length,
    },
  };
}

function parseLimit(raw) {
  return Math.min(parseInt(raw) || DEFAULT_LIMIT, MAX_LIMIT);
}

function parsePage(raw) {
  const page = parseInt(raw);
  return page && page > 0 ? page : 1;
}

async function getStats(zodu_id, branch_id) {
  const raw = await repo.getStats(zodu_id, branch_id);
  return {
    total_sales:        parseFloat(raw.total_sales),
    total_invoices:     parseInt(raw.total_invoices),
    todays_revenue:     parseFloat(raw.todays_revenue),
    total_due:          parseFloat(raw.total_due),
    total_reminders:    parseInt(raw.total_reminders),
    top_item_name:      raw.top_item_name || null,
    top_item_sold:      raw.top_item_sold ? parseInt(raw.top_item_sold) : 0,
    total_sold:         parseInt(raw.total_sold),
    out_of_stock_count: parseInt(raw.out_of_stock_count),
    total_alerts: parseInt(raw.total_alerts),
    total_due_to_payable_amount: parseFloat(raw.total_due_to_payable_amount),
    total_due_to_receivable_amount : parseFloat(raw.total_due_to_receivable_amount),
  };
}

async function getSales(zodu_id, branch_id, rawLimit, cursorToken) {
  const limit  = parseLimit(rawLimit);
  const cursor = decodeCursor(cursorToken);
  const rows   = await repo.getSales(zodu_id, branch_id, limit + 1, cursor);

  return paginate(rows, limit, (r) => ({
    sale_date: r.sale_date,
    sale_time: r.sale_time,
    sale_uuid: r.sale_uuid,
  }));
}



async function getDashboardOrders(zodu_id, branch_id, options) {
  const {
    page = 1,
    limit = 10,
    sortOrder = "desc"
  } = options;

  const result = await repo.getDashboardOrders(zodu_id, branch_id, {
    page: Number(page),
    limit: Number(limit),
    sortOrder
  });

  const totalPages = Math.ceil(result.count / limit);

  return {
    data: result.rows,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      totalRecords: result.count,
      totalPages
    }
  };
}

async function getDashboardTopItems(zodu_id, branch_id, options) {
  const { page = 1, limit = 10 } = options;
  const offset = (page - 1) * limit;

  const result = await repo.getDashboardTopItems(zodu_id, branch_id, { limit: Number(limit), offset });

  return {
    data: result.rows,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      totalRecords: result.count,
      totalPages: Math.ceil(result.count / limit)
    }
  };
}


async function getTopItems(zodu_id, branch_id, rawLimit, cursorToken) {
  const limit  = parseLimit(rawLimit);
  const cursor = decodeCursor(cursorToken);
  const rows   = await repo.getTopItems(zodu_id, branch_id, limit + 1, cursor);

  return paginate(rows, limit, (r) => ({
    total_sold: r.total_sold,
    item_id:    r.item_id,
  }));
}

async function getReminders(zodu_id, branch_id, rawPage, rawLimit) {
  const page   = parsePage(rawPage);
  const limit  = parseLimit(rawLimit);
  const offset = (page - 1) * limit;

  const rows       = await repo.getReminders(zodu_id, branch_id, limit, offset);
  const totalCount = rows.length ? parseInt(rows[0].total_count) : 0;
  const totalPages = totalCount ? Math.ceil(totalCount / limit) : 0;

  return {
    data: rows.map(({ total_count, ...rest }) => rest),
    pagination: {
      page,
      limit,
      totalCount,
      totalPages,
      hasMore: page < totalPages,
    },
  };
}

async function getInventoryAlerts(zodu_id, branch_id, rawLimit, cursorToken) {
  const limit  = parseLimit(rawLimit);
  const cursor = decodeCursor(cursorToken);
  const rows   = await repo.getInventoryAlerts(zodu_id, branch_id, limit + 1, cursor);

  return paginate(rows, limit, (r) => ({
    available_qty: r.available_qty,
    item_uuid:     r.item_uuid,
  }));
}

async function getDashboardSummary(zodu_id, branch_id) {
  return repo.getDashboardSummary(zodu_id, branch_id);
}

module.exports = {
  getStats,
  getSales,
  getTopItems,
  getReminders,
  getInventoryAlerts,
  getDashboardOrders,
  getDashboardTopItems,
  getDashboardSummary,
};