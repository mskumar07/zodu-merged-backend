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

async function getStats(zodu_id, branch_id) {
  const raw = await repo.getStats(zodu_id, branch_id);
  return {
    total_sales:     parseFloat(raw.total_sales),
    total_invoices:  parseInt(raw.total_invoices),
    todays_revenue:  parseFloat(raw.todays_revenue),
    low_stock_items: parseInt(raw.low_stock_items),
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

async function getTopItems(zodu_id, branch_id, rawLimit, cursorToken) {
  const limit  = parseLimit(rawLimit);
  const cursor = decodeCursor(cursorToken);
  const rows   = await repo.getTopItems(zodu_id, branch_id, limit + 1, cursor);

  return paginate(rows, limit, (r) => ({
    total_sold: r.total_sold,
    item_id:    r.item_id,
  }));
}

async function getReminders(zodu_id, branch_id, rawLimit, cursorToken) {
  const limit  = parseLimit(rawLimit);
  const cursor = decodeCursor(cursorToken);
  const rows   = await repo.getReminders(zodu_id, branch_id, limit + 1, cursor);

  return paginate(rows, limit, (r) => ({
    due_date: r.due_date,
    ref_id:   r.ref_id,
    ref_type: r.ref_type,
    ref_uuid: r.ref_uuid,
  }));
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

module.exports = {
  getStats,
  getSales,
  getTopItems,
  getReminders,
  getInventoryAlerts,
};