const repo       = require("../repository/report-repo");
const { getPagination, getMeta } = require("../utils/pagination");

async function getSalesSummary(zodu_id, branch_id, year) {
  const currentYear = new Date().getFullYear();
  const targetYear  = parseInt(year) || currentYear;

  const raw = await repo.getSalesSummary(zodu_id, branch_id, targetYear);
  if (!raw) {
    return {
      year:                targetYear,
      total_monthly_sales: 0,
      total_yearly_sales:  0,
      growth_vs_last_year: null,
      top_performing_month: null,
    };
  }

  return {
    year:                 targetYear,
    total_monthly_sales:  parseFloat(raw.total_monthly_sales),
    total_yearly_sales:   parseFloat(raw.total_yearly_sales),
    growth_vs_last_year:  raw.growth_vs_last_year !== null ? parseFloat(raw.growth_vs_last_year) : null,
    top_performing_month: raw.top_performing_month,
  };
}


async function getPurchaseSummary(zodu_id, branch_id, year) {
  const currentYear = new Date().getFullYear();
  const targetYear  = parseInt(year) || currentYear;

  const raw = await repo.getPurchaseSummary(zodu_id, branch_id, targetYear);
  if (!raw) {
    return {
      year:                         targetYear,
      total_yearly_purchase_count:  0,
      total_yearly_purchase:        0,
      total_yearly_paid:            0,
      total_yearly_pending:         0,
    };
  }

  return {
    year:                         targetYear,
    total_yearly_purchase_count:  raw.total_yearly_purchase_count,
    total_yearly_purchase:        parseFloat(raw.total_yearly_purchase),
    total_yearly_paid:            parseFloat(raw.total_yearly_paid),
    total_yearly_pending:         parseFloat(raw.total_yearly_pending),
  };
}

async function getMonthlyBreakdown(zodu_id, branch_id, year, page, limit) {
  const currentYear = new Date().getFullYear();
  const targetYear  = parseInt(year) || currentYear;

  const { page: pg, limit: lmt, offset } = getPagination({ page, limit });
  const { rows, total } = await repo.getMonthlyBreakdown(zodu_id, branch_id, targetYear, lmt, offset);

  const data = rows.map((r) => ({
    month_num:  r.month_num,
    month_name: r.month_name.trim(),
    bill_count: r.bill_count,
    subtotal:   parseFloat(r.subtotal),
    total_tax:  parseFloat(r.total_tax),
    net_sales:  parseFloat(r.net_sales),
  }));

  return {
    year: targetYear,
    data,
    pagination: getMeta({ page: pg, limit: lmt, total }),
  };
}

async function getHistoricalPerformance(zodu_id, branch_id) {
  const rows = await repo.getHistoricalPerformance(zodu_id, branch_id);

  if (!rows.length) {
    return { yearly_data: [], peak_annual_revenue: 0, average_growth: null };
  }

  const yearly_data = rows.map((r) => ({
    year:      r.year,
    net_sales: parseFloat(r.net_sales),
  }));

  const peak_annual_revenue = Math.max(...yearly_data.map((r) => r.net_sales));

  // YoY growth percentages
  let total_growth = 0;
  let growth_count = 0;
  for (let i = 1; i < yearly_data.length; i++) {
    const prev = yearly_data[i - 1].net_sales;
    if (prev > 0) {
      total_growth += ((yearly_data[i].net_sales - prev) / prev) * 100;
      growth_count++;
    }
  }
  const average_growth = growth_count > 0
    ? parseFloat((total_growth / growth_count).toFixed(1))
    : null;


  return { yearly_data, peak_annual_revenue, average_growth };
}

// ── Helpers ───────────────────────────────────────────────────
function getDefaultDateRange() {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const from  = `${year}-${month}-01`;
  const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
  const to    = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

function getPrevPeriod(from_date, to_date) {
  const from    = new Date(from_date);
  const to      = new Date(to_date);
  const diffMs  = to - from;
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  const prevTo   = new Date(from);
  prevTo.setDate(prevTo.getDate() - 1);

  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevFrom.getDate() - diffDays);

  return {
    prev_from: prevFrom.toISOString().split('T')[0],
    prev_to:   prevTo.toISOString().split('T')[0],
  };
}

// ── Category/Item Sales Summary ───────────────────────────────
async function getCategoryItemSalesSummary(zodu_id, branch_id, from_date, to_date) {
  const defaults = getDefaultDateRange();
  const from     = from_date || defaults.from;
  const to       = to_date   || defaults.to;
  const { prev_from, prev_to } = getPrevPeriod(from, to);

  const raw = await repo.getCategoryItemSalesSummary(zodu_id, branch_id, from, to, prev_from, prev_to);

  if (!raw) {
    return {
      from_date: from, to_date: to,
      total_sales: 0, growth_pct: null,
      best_category: null, best_item: null,
      total_tax: 0, avg_tax_rate: 0,
    };
  }

  return {
    from_date:  from,
    to_date:    to,
    total_sales:    parseFloat(raw.total_sales),
    growth_pct:     raw.growth_pct !== null ? parseFloat(raw.growth_pct) : null,
    best_category:  raw.best_category_name
      ? { name: raw.best_category_name, pct_of_total: parseFloat(raw.best_category_pct) }
      : null,
    best_item: raw.best_item_name
      ? { name: raw.best_item_name, units_sold: raw.best_item_units }
      : null,
    total_tax:    parseFloat(raw.total_tax),
    avg_tax_rate: parseFloat(raw.avg_tax_rate),
  };
}

// ── Category-wise Sales ───────────────────────────────────────
async function getCategoryWiseSales(zodu_id, branch_id, from_date, to_date, page, limit) {
  const defaults = getDefaultDateRange();
  const from     = from_date || defaults.from;
  const to       = to_date   || defaults.to;
  const { prev_from, prev_to } = getPrevPeriod(from, to);

  const { page: pg, limit: lmt, offset } = getPagination({ page, limit });
  const { rows, total } = await repo.getCategoryWiseSales(
    zodu_id, branch_id, from, to, prev_from, prev_to, lmt, offset
  );

  const data = rows.map((r) => ({
    category_name: r.category_name,
    total_units:   r.total_units,
    total_sales:   parseFloat(r.total_sales),
    growth:        r.growth !== null ? parseFloat(r.growth) : null,
  }));
console.log(data)
  return {
    from_date: from,
    to_date:   to,
    data,
    pagination: getMeta({ page: pg, limit: lmt, total }),
  };
}

// ── Item-wise Sales ───────────────────────────────────────────
async function getItemWiseSales(zodu_id, branch_id, from_date, to_date, page, limit, category_id) {
  const defaults = getDefaultDateRange();
  const from     = from_date || defaults.from;
  const to       = to_date   || defaults.to;

  const { page: pg, limit: lmt, offset } = getPagination({ page, limit });
  const { rows, total } = await repo.getItemWiseSales(
    zodu_id, branch_id, from, to, lmt, offset,
    category_id != null ? parseInt(category_id) : null
  );

  const data = rows.map((r) => ({
    item_id:       r.item_id,
    item_name:     r.item_name,
    category_name: r.category_name,
    qty:           r.qty,
    price:         parseFloat(r.price),
    total:         parseFloat(r.total),
  }));

  return {
    from_date: from,
    to_date:   to,
    data,
    pagination: getMeta({ page: pg, limit: lmt, total }),
  };
}

// ── Sales Velocity ────────────────────────────────────────────
async function getSalesVelocity(zodu_id, branch_id, from_date, to_date) {
  const defaults = getDefaultDateRange();
  const from     = from_date || defaults.from;
  const to       = to_date   || defaults.to;

  const rows = await repo.getSalesVelocity(zodu_id, branch_id, from, to);

  const data = rows.map((r) => ({
    date:        r.sale_date,
    daily_sales: parseFloat(r.daily_sales),
  }));

  return { from_date: from, to_date: to, data };
}

// ── Datewise Summary Cards ────────────────────────────────────
async function getDatewiseSummary(zodu_id, branch_id, from_date, to_date) {
  const defaults = getDefaultDateRange();
  const from     = from_date || defaults.from;
  const to       = to_date   || defaults.to;

  const raw = await repo.getDatewiseSaleSummary(zodu_id, branch_id, from, to);

  return {
    from_date:    from,
    to_date:      to,
    total_orders: parseInt(raw?.total_orders   || 0),
    total_sales:  parseFloat(raw?.total_sales  || 0),
    total_tax:    parseFloat(raw?.total_tax    || 0),
    total_profit: parseFloat(raw?.total_profit || 0),
  };
}

// ── Datewise Breakdown (paginated) ───────────────────────────
async function getDatewiseBreakdown(zodu_id, branch_id, from_date, to_date, page, limit) {
  const defaults = getDefaultDateRange();
  const from     = from_date || defaults.from;
  const to       = to_date   || defaults.to;

  const { page: pg, limit: lmt, offset } = getPagination({ page, limit });
  const { rows, total } = await repo.getDatewiseSaleBreakdown(zodu_id, branch_id, from, to, lmt, offset);

  const data = rows.map((r) => ({
    date:         r.sale_date,
    total_orders: r.total_orders,
    total_sales:  parseFloat(r.total_sales),
    total_tax:    parseFloat(r.total_tax),
    total_profit: parseFloat(r.total_profit),
  }));

  return {
    from_date: from,
    to_date:   to,
    data,
    pagination: getMeta({ page: pg, limit: lmt, total }),
  };
}

// ── Purchase Reports ──────────────────────────────────────────
async function getPurchaseMonthlyBreakdown(zodu_id, branch_id, year, page, limit) {
  const currentYear = new Date().getFullYear();
  const targetYear  = parseInt(year) || currentYear;

  const { page: pg, limit: lmt, offset } = getPagination({ page, limit });
  const { rows, total } = await repo.getPurchaseMonthlyBreakdown(zodu_id, branch_id, targetYear, lmt, offset);

  const data = rows.map((r) => ({
    month_num:      r.month_num,
    month_name:     r.month_name.trim(),
    bill_count:     r.bill_count,
    total_amount:   parseFloat(r.total_amount),
    total_paid:     parseFloat(r.total_paid),
    total_pending:  parseFloat(r.total_pending),
  }));

  return {
    year: targetYear,
    data,
    pagination: getMeta({ page: pg, limit: lmt, total }),
  };
}

async function getPurchaseDatewiseSummary(zodu_id, branch_id, from_date, to_date) {
  const defaults = getDefaultDateRange();
  const from     = from_date || defaults.from;
  const to       = to_date   || defaults.to;

  const raw = await repo.getPurchaseDatewiseSummary(zodu_id, branch_id, from, to);

  return {
    from_date:       from,
    to_date:         to,
    total_orders:    parseInt(raw?.total_orders   || 0),
    total_purchase:  parseFloat(raw?.total_purchase || 0),
    total_paid:      parseFloat(raw?.total_paid    || 0),
    total_pending:   parseFloat(raw?.total_pending || 0),
  };
}

async function getPurchaseDatewiseBreakdown(zodu_id, branch_id, from_date, to_date, page, limit) {
  const defaults = getDefaultDateRange();
  const from     = from_date || defaults.from;
  const to       = to_date   || defaults.to;

  const { page: pg, limit: lmt, offset } = getPagination({ page, limit });
  const { rows, total } = await repo.getPurchaseDatewiseBreakdown(zodu_id, branch_id, from, to, lmt, offset);

  const data = rows.map((r) => ({
    date:            r.purchase_date,
    total_orders:    r.total_orders,
    total_purchase:  parseFloat(r.total_purchase),
    total_paid:      parseFloat(r.total_paid),
    total_pending:   parseFloat(r.total_pending),
  }));

  return {
    from_date: from,
    to_date:   to,
    data,
    pagination: getMeta({ page: pg, limit: lmt, total }),
  };
}

// ── Expense Reports ───────────────────────────────────────────
async function getExpenseSummary(zodu_id, branch_id, year) {
  const currentYear = new Date().getFullYear();
  const targetYear  = parseInt(year) || currentYear;

  const raw = await repo.getExpenseSummary(zodu_id, branch_id, targetYear);
  if (!raw) {
    return {
      year:                        targetYear,
      total_yearly_expense_count:  0,
      total_yearly_expense:        0,
      total_yearly_paid:           0,
      total_yearly_pending:        0,
    };
  }

  return {
    year:                        targetYear,
    total_yearly_expense_count:  raw.total_yearly_expense_count,
    total_yearly_expense:        parseFloat(raw.total_yearly_expense),
    total_yearly_paid:           parseFloat(raw.total_yearly_paid),
    total_yearly_pending:        parseFloat(raw.total_yearly_pending),
  };
}

async function getExpenseMonthlyBreakdown(zodu_id, branch_id, year, page, limit) {
  const currentYear = new Date().getFullYear();
  const targetYear  = parseInt(year) || currentYear;

  const { page: pg, limit: lmt, offset } = getPagination({ page, limit });
  const { rows, total } = await repo.getExpenseMonthlyBreakdown(zodu_id, branch_id, targetYear, lmt, offset);

  const data = rows.map((r) => ({
    month_num:     r.month_num,
    month_name:    r.month_name.trim(),
    bill_count:    r.bill_count,
    total_amount:  parseFloat(r.total_amount),
    total_paid:    parseFloat(r.total_paid),
    total_pending: parseFloat(r.total_pending),
  }));

  return {
    year: targetYear,
    data,
    pagination: getMeta({ page: pg, limit: lmt, total }),
  };
}

async function getExpenseDatewiseSummary(zodu_id, branch_id, from_date, to_date) {
  const defaults = getDefaultDateRange();
  const from     = from_date || defaults.from;
  const to       = to_date   || defaults.to;

  const raw = await repo.getExpenseDatewiseSummary(zodu_id, branch_id, from, to);

  return {
    from_date:     from,
    to_date:       to,
    total_entries: parseInt(raw?.total_entries  || 0),
    total_expense: parseFloat(raw?.total_expense || 0),
    total_paid:    parseFloat(raw?.total_paid    || 0),
    total_pending: parseFloat(raw?.total_pending || 0),
  };
}

async function getExpenseDatewiseBreakdown(zodu_id, branch_id, from_date, to_date, page, limit) {
  const defaults = getDefaultDateRange();
  const from     = from_date || defaults.from;
  const to       = to_date   || defaults.to;

  const { page: pg, limit: lmt, offset } = getPagination({ page, limit });
  const { rows, total } = await repo.getExpenseDatewiseBreakdown(zodu_id, branch_id, from, to, lmt, offset);

  const data = rows.map((r) => ({
    date:          r.expense_date,
    total_entries: r.total_entries,
    total_expense: parseFloat(r.total_expense),
    total_paid:    parseFloat(r.total_paid),
    total_pending: parseFloat(r.total_pending),
  }));

  return {
    from_date: from,
    to_date:   to,
    data,
    pagination: getMeta({ page: pg, limit: lmt, total }),
  };
}

module.exports = {
  getSalesSummary,
  getMonthlyBreakdown,
  getHistoricalPerformance,
  getCategoryItemSalesSummary,
  getCategoryWiseSales,
  getItemWiseSales,
  getSalesVelocity,
  getDatewiseSummary,
  getDatewiseBreakdown,
  getPurchaseSummary,
  getPurchaseMonthlyBreakdown,
  getPurchaseDatewiseSummary,
  getPurchaseDatewiseBreakdown,
  getExpenseSummary,
  getExpenseMonthlyBreakdown,
  getExpenseDatewiseSummary,
  getExpenseDatewiseBreakdown,
};
