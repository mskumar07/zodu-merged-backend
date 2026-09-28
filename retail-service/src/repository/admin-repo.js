const conn = require('../database/connection');

// Cross-tenant reads for zodu_admin_panel — every other repository file in
// this service scopes queries to one (zodu_id, branch_id); these
// deliberately don't, so they live separately rather than being mixed into
// retail-repo.js/dashboard-repo.js's per-branch query set.
//
// Called by admin-service only (see /internal/admin/* in internal-controller.js).

// this-month vs last-month count of `column`, used identically by all three
// stats functions below.
async function countStat(table, dateColumn, extraWhere = '') {
  const { rows } = await conn.query(
    `SELECT
       COUNT(*) FILTER (
         WHERE ${dateColumn} >= date_trunc('month', now())
       )::int AS this_month,
       COUNT(*) FILTER (
         WHERE ${dateColumn} >= date_trunc('month', now() - interval '1 month')
           AND ${dateColumn} <  date_trunc('month', now())
       )::int AS last_month,
       COUNT(*)::int AS total
     FROM ${table}
     ${extraWhere}`
  );
  return rows[0];
}

function toStatShape({ total, this_month, last_month }) {
  const changePct = last_month > 0
    ? Math.round(((this_month - last_month) / last_month) * 100)
    : (this_month > 0 ? 100 : 0);
  return { total, changePct };
}

exports.getInvoiceStats = async () => {
  const row = await countStat('tbl_sales', 'sale_date', `WHERE sale_type != 'Q' AND cancelled_inv = false`);
  return toStatShape(row);
};

exports.getPurchaseStats = async () => {
  const row = await countStat('tbl_purchase', 'purchase_date', `WHERE cancelled_purchase = false`);
  return toStatShape(row);
};

exports.getExpenseStats = async () => {
  const row = await countStat('tbl_expense', 'expense_date');
  return toStatShape(row);
};

// Top N companies by invoice count, with their purchase/expense counts
// alongside — one row per zodu_id across ALL its branches combined. Used by
// the dashboard summary card, which only needs a "top movers" snapshot, not
// every company — see getStatsForCompanies below for the full, zero-filled
// list the Companies page needs.
exports.getCompanyWiseStats = async (limit = 10) => {
  const { rows } = await conn.query(
    `WITH invoice_counts AS (
       SELECT zodu_id, COUNT(*)::int AS invoice_count
       FROM tbl_sales
       WHERE sale_type != 'Q' AND cancelled_inv = false
       GROUP BY zodu_id
     ),
     purchase_counts AS (
       SELECT zodu_id, COUNT(*)::int AS purchase_count
       FROM tbl_purchase
       WHERE cancelled_purchase = false
       GROUP BY zodu_id
     ),
     expense_counts AS (
       SELECT zodu_id, COUNT(*)::int AS expense_count
       FROM tbl_expense
       GROUP BY zodu_id
     )
     SELECT
       COALESCE(i.zodu_id, p.zodu_id, e.zodu_id)   AS zodu_id,
       COALESCE(i.invoice_count, 0)                AS invoice_count,
       COALESCE(p.purchase_count, 0)                AS purchase_count,
       COALESCE(e.expense_count, 0)                 AS expense_count
     FROM invoice_counts i
     FULL OUTER JOIN purchase_counts p ON p.zodu_id = i.zodu_id
     FULL OUTER JOIN expense_counts  e ON e.zodu_id = COALESCE(i.zodu_id, p.zodu_id)
     ORDER BY invoice_count DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
};

// Stats for an EXACT, caller-supplied list of zodu_ids — zero-filled for any
// id with no invoices/purchases/expenses at all, one row per id, in no
// particular order (the caller already decided the page/order from
// auth-service's company list, which is the only place that knows about a
// company with zero activity in this database — it never shows up in a
// GROUP BY here). Used by the Companies page's full, paginated list, as
// opposed to getCompanyWiseStats' "top N with activity" dashboard snapshot.
exports.getStatsForCompanies = async (zoduIds) => {
  if (!zoduIds.length) return [];

  const { rows } = await conn.query(
    `WITH ids AS (
       SELECT unnest($1::varchar[]) AS zodu_id
     ),
     invoice_counts AS (
       SELECT zodu_id, COUNT(*)::int AS invoice_count
       FROM tbl_sales
       WHERE sale_type != 'Q' AND cancelled_inv = false AND zodu_id = ANY($1)
       GROUP BY zodu_id
     ),
     purchase_counts AS (
       SELECT zodu_id, COUNT(*)::int AS purchase_count
       FROM tbl_purchase
       WHERE cancelled_purchase = false AND zodu_id = ANY($1)
       GROUP BY zodu_id
     ),
     expense_counts AS (
       SELECT zodu_id, COUNT(*)::int AS expense_count
       FROM tbl_expense
       WHERE zodu_id = ANY($1)
       GROUP BY zodu_id
     )
     SELECT
       ids.zodu_id,
       COALESCE(i.invoice_count, 0)  AS invoice_count,
       COALESCE(p.purchase_count, 0) AS purchase_count,
       COALESCE(e.expense_count, 0)  AS expense_count
     FROM ids
     LEFT JOIN invoice_counts  i ON i.zodu_id = ids.zodu_id
     LEFT JOIN purchase_counts p ON p.zodu_id = ids.zodu_id
     LEFT JOIN expense_counts  e ON e.zodu_id = ids.zodu_id`,
    [zoduIds]
  );
  return rows;
};
