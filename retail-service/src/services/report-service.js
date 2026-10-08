const repo       = require("../repository/report-repo");
const authClient = require("../utils/authClient");
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

async function getExpenseCategoryWiseSummary(zodu_id, branch_id, from_date, to_date) {
  const defaults = getDefaultDateRange();
  const from     = from_date || defaults.from;
  const to       = to_date   || defaults.to;

  const raw = await repo.getExpenseCategoryWiseSummary(zodu_id, branch_id, from, to);

  return {
    from_date:     from,
    to_date:       to,
    total_entries: parseInt(raw?.total_entries  || 0),
    total_expense: parseFloat(raw?.total_expense || 0),
    total_paid:    parseFloat(raw?.total_paid    || 0),
    total_pending: parseFloat(raw?.total_pending || 0),
  };
}

async function getExpenseCategoryWise(zodu_id, branch_id, from_date, to_date, page, limit) {
  const defaults = getDefaultDateRange();
  const from     = from_date || defaults.from;
  const to       = to_date   || defaults.to;

  const { page: pg, limit: lmt, offset } = getPagination({ page, limit });
  const { rows, total } = await repo.getExpenseCategoryWise(zodu_id, branch_id, from, to, lmt, offset);

  const data = rows.map((r) => ({
    category_id:    r.category_id,
    category_name:  r.category_name,
    total_entries:  r.total_entries,
    total_expense:  parseFloat(r.total_expense),
    total_paid:     parseFloat(r.total_paid),
    total_pending:  parseFloat(r.total_pending),
  }));

  return {
    from_date: from,
    to_date:   to,
    data,
    pagination: getMeta({ page: pg, limit: lmt, total }),
  };
}

// ── Profit Calculation ────────────────────────────────────────
async function getProfitByYear(zodu_id, branch_id, year) {
  const currentYear = new Date().getFullYear();
  const targetYear  = parseInt(year) || currentYear;

  const rows = await repo.getProfitByYear(zodu_id, branch_id, targetYear);

  // Build monthly breakdown
  const monthly_data = rows.map((r) => ({
    month_num:      r.month_num,
    month_name:     r.month_name.trim(),
    total_sales:    parseFloat(r.total_sales),
    total_purchase: parseFloat(r.total_purchase),
    total_expense:  parseFloat(r.total_expense),
    profit:         parseFloat(r.profit),
  }));

  // Yearly totals (sum across all 12 months)
  const yearly_sales    = monthly_data.reduce((s, r) => s + r.total_sales,    0);
  const yearly_purchase = monthly_data.reduce((s, r) => s + r.total_purchase, 0);
  const yearly_expense  = monthly_data.reduce((s, r) => s + r.total_expense,  0);
  const yearly_profit   = yearly_sales - yearly_purchase - yearly_expense;

  return {
    year: targetYear,
    yearly_summary: {
      total_sales:    parseFloat(yearly_sales.toFixed(2)),
      total_purchase: parseFloat(yearly_purchase.toFixed(2)),
      total_expense:  parseFloat(yearly_expense.toFixed(2)),
      profit:         parseFloat(yearly_profit.toFixed(2)),
    },
    monthly_data,
  };
}

// ── Profit Year-wise Summary (paginated) ──────────────────────
async function getProfitYearwise(zodu_id, branch_id, page, limit) {
  const { page: pg, limit: lmt, offset } = getPagination({ page, limit });
  const { rows, total, overall_summary } = await repo.getProfitYearwise(zodu_id, branch_id, lmt, offset);

  const data = rows.map((r) => ({
    year:           r.year,
    total_sales:    parseFloat(r.total_sales),
    total_purchase: parseFloat(r.total_purchase),
    total_expense:  parseFloat(r.total_expense),
    profit:         parseFloat(r.profit),
  }));

  return {
    overall_summary: {
      total_sales:    parseFloat(overall_summary.total_sales.toFixed(2)),
      total_purchase: parseFloat(overall_summary.total_purchase.toFixed(2)),
      total_expense:  parseFloat(overall_summary.total_expense.toFixed(2)),
      profit:         parseFloat(overall_summary.profit.toFixed(2)),
    },
    data,
    pagination: getMeta({ page: pg, limit: lmt, total }),
  };
}

// ── Active Years for Profit Dropdown ─────────────────────────
async function getProfitActiveYears(zodu_id, branch_id) {
  const years = await repo.getProfitActiveYears(zodu_id, branch_id);
  return { active_years: years };
}

// ── GSTR-1 B2B ───────────────────────────────────────────────
// Indian FY: "2026-27" = 01-Apr-2026 .. 31-Mar-2027. month (1-12) optional → whole FY.
function resolveGstPeriod(financial_year, month) {
  const m = /^(\d{4})-(\d{2})$/.exec(financial_year || "");
  if (!m) {
    const err = new Error("financial_year must be like 2026-27");
    err.status = 400;
    throw err;
  }
  const startYear = parseInt(m[1]);
  const mon = month ? parseInt(month) : null;
  if (mon !== null && !(mon >= 1 && mon <= 12)) {
    const err = new Error("month must be between 1 and 12");
    err.status = 400;
    throw err;
  }

  const pad = (n) => String(n).padStart(2, "0");
  if (mon === null) {
    return { from_date: `${startYear}-04-01`, to_date: `${startYear + 1}-03-31` };
  }
  const year = mon >= 4 ? startYear : startYear + 1;
  const lastDay = new Date(year, mon, 0).getDate();
  return { from_date: `${year}-${pad(mon)}-01`, to_date: `${year}-${pad(mon)}-${lastDay}` };
}

async function getGstr1B2BGstins(zodu_id, branch_id, financial_year, month) {
  const { from_date, to_date } = resolveGstPeriod(financial_year, month);
  const rows = await repo.getGstr1B2BGstins(zodu_id, branch_id, from_date, to_date);
  return rows.map((r) => ({ gstin: r.gstin, customer_name: r.customer_name }));
}

async function getGstr1B2B(zodu_id, branch_id, { financial_year, month, gstin, search, page, limit }) {
  const { from_date, to_date } = resolveGstPeriod(financial_year, month);
  const { page: pg, limit: lmt, offset } = getPagination({ page, limit });

  const gstinFilter  = gstin && gstin !== "All" ? gstin.trim().toUpperCase() : null;
  const searchFilter = search && search.trim() ? `%${search.trim()}%` : null;

  const { summary, rows } = await repo.getGstr1B2B(
    zodu_id, branch_id, from_date, to_date, gstinFilter, searchFilter, lmt, offset
  );

  const n = (v) => parseFloat(v) || 0;
  const total = summary.total_invoices;

  return {
    period: { financial_year, month: month ? parseInt(month) : null, from_date, to_date },
    summary: {
      total_invoices:      total,
      total_taxable_value: n(summary.total_taxable_value),
      total_igst:          0,
      total_cgst:          n(summary.total_cgst),
      total_sgst:          n(summary.total_sgst),
      total_cess:          0,
      total_value:         n(summary.total_value),
    },
    data: rows.map((r, i) => ({
      s_no:          offset + i + 1,
      invoice_no:    r.invoice_no,
      invoice_date:  r.invoice_date,
      customer_name: r.customer_name,
      gstin:         r.gstin,
      taxable_value: n(r.taxable_value),
      igst:          0,
      cgst:          n(r.cgst),
      sgst:          n(r.sgst),
      cess:          0,
      total_value:   n(r.total_value),
    })),
    meta: getMeta({ page: pg, limit: lmt, total }),
  };
}

// Branch state lives in auth-service. Falls back to the company state when the branch has none.
async function getBranchState(zodu_id, branch_id) {
  let state = null;
  try {
    const branch = await authClient.getBranch(zodu_id, branch_id);
    state = branch?.data?.state;
    console.log(`Branch state for zodu_id=${zodu_id}, branch_id=${branch_id}: ${state}`);
    if (!state) {
      const company = await authClient.getCompany(zodu_id);
      state = company?.data?.state;
    }
  } catch (err) {
    const e = new Error(`Unable to fetch branch details: ${err.message}`);
    e.status = 502;
    throw e;
  }

  if (!state || !state.trim()) {
    const e = new Error("Branch state is not configured; set it in branch settings to run this report");
    e.status = 422;
    throw e;
  }
  return state.trim().toLowerCase();
}

// B2C Large threshold: inter-state invoice value above ₹1,00,000 (GSTR-1 rule from Aug 2024)
const B2CL_THRESHOLD = 100000;

async function getGstr1B2CLarge(zodu_id, branch_id, { financial_year, month, search, page, limit }) {
  const { from_date, to_date } = resolveGstPeriod(financial_year, month);
  const pg     = Math.max(parseInt(page) || 1, 1);
  const lmt    = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
  const offset = (pg - 1) * lmt;

  const searchFilter = search && search.trim() ? `%${search.trim()}%` : null;

  const branchState = await getBranchState(zodu_id, branch_id);

  const { summary, rows } = await repo.getGstr1B2CLarge(
    zodu_id, branch_id, from_date, to_date, branchState, B2CL_THRESHOLD, searchFilter, lmt, offset
  );

  const n = (v) => parseFloat(v) || 0;
  const total = summary.total_invoices;

  return {
    period: { financial_year, month: month ? parseInt(month) : null, from_date, to_date },
    summary: {
      total_invoices:      total,
      total_taxable_value: n(summary.total_taxable_value),
      total_igst:          0,
      total_cgst:          n(summary.total_cgst),
      total_sgst:          n(summary.total_sgst),
      total_cess:          0,
      total_value:         n(summary.total_value),
    },
    data: rows.map((r, i) => ({
      s_no:            offset + i + 1,
      invoice_no:      r.invoice_no,
      invoice_date:    r.invoice_date,
      customer_name:   r.customer_name,
      place_of_supply: r.place_of_supply,
      invoice_value:   n(r.total_value),
      taxable_value:   n(r.taxable_value),
      igst:            0,
      cgst:            n(r.cgst),
      sgst:            n(r.sgst),
      cess:            0,
      total_value:     n(r.total_value),
    })),
    meta: getMeta({ page: pg, limit: lmt, total }),
  };
}

module.exports = {
  getGstr1B2CLarge,
  getGstr1B2BGstins,
  getGstr1B2B,
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
  getExpenseCategoryWiseSummary,
  getExpenseCategoryWise,
  getProfitByYear,
  getProfitYearwise,
  getProfitActiveYears,
};
