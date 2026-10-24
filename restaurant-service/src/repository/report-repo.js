const conn = require("../database/connection");

// ── Purchase returns are netted into the purchase / profit reports ─────────────────────────
// A purchase return / debit note counts as a NEGATIVE purchase on the date of the ORIGINAL purchase
// (not the day it was returned), so a return always reduces the day / month of the bill it came from. purchase_moves stacks the bills and the returns into one list with the same
// columns, so a report only has to SUM it and amount and paid come out net. `bills` is 1 for a
// bill and 0 for a return, so bill counts are unchanged. Returns against a cancelled purchase are
// ignored. A return lowers the bought value by return_amount and the money paid by what the vendor
// has refunded so far, so pending (amt - paid) comes out right: the part set off against the bill
// drops the pending, the part already paid is a refund due from the vendor until it is received.
// Both CTEs expect $1 = zodu_id, $2 = branch_id. They are NOT MATERIALIZED on purpose, so Postgres
// pushes each report's date filter down into the scans instead of building the whole history first.
const PURCHASE_MOVES = `purchase_moves AS NOT MATERIALIZED (
    SELECT p.purchase_date AS d, CASE WHEN p.total_amount > 0 AND COALESCE((SELECT SUM(r2.return_amount) FROM tbl_purchase_returns r2
                      WHERE r2.zodu_id = $1 AND r2.branch_id = $2 AND r2.original_purchase_id = p.purchase_id), 0) >= p.total_amount - 0.01
                THEN 0 ELSE 1 END AS bills, p.total_amount AS amt, p.paid_amount AS paid
    FROM tbl_purchase p
    WHERE p.zodu_id = $1 AND p.branch_id = $2 AND p.cancelled_purchase = false
    UNION ALL
    SELECT p.purchase_date, 0, -r.return_amount, -r.refunded_amount
    FROM tbl_purchase_returns r
    JOIN tbl_purchase p
      ON p.zodu_id = r.zodu_id AND p.branch_id = r.branch_id AND p.purchase_id = r.original_purchase_id
    WHERE r.zodu_id = $1 AND r.branch_id = $2 AND p.cancelled_purchase = false
  )`;

// Restaurant sales are the finalized orders (there is no sale return against an order yet), exposed
// under the same name and columns the profit queries read.
const SALE_MOVES = `sale_moves AS NOT MATERIALIZED (
    SELECT o.order_date AS d, o.total_amt AS amt
    FROM tbl_orders o
    WHERE o.zodu_id = $1 AND o.branch_id = $2 AND o.cancelled_order = false
  )`;

// Per-year sales / purchase / expense for the profit reports (purchases net of returns).
const PROFIT_YEARS = `${SALE_MOVES}, ${PURCHASE_MOVES},
  sales_y AS (SELECT EXTRACT(YEAR FROM d)::int AS year, SUM(amt) AS total_sales FROM sale_moves GROUP BY 1),
  purchase_y AS (SELECT EXTRACT(YEAR FROM d)::int AS year, SUM(amt) AS total_purchase FROM purchase_moves GROUP BY 1),
  expense_y AS (
    SELECT EXTRACT(YEAR FROM expense_date)::int AS year, SUM(total_amount) AS total_expense
    FROM tbl_expense WHERE zodu_id = $1 AND branch_id = $2 GROUP BY 1
  ),
  years AS (
    SELECT year FROM sales_y UNION SELECT year FROM purchase_y UNION SELECT year FROM expense_y
  )`;

// ── Summary Cards ─────────────────────────────────────────────
async function getSalesSummary(zodu_id, branch_id, year) {
  const { rows } = await conn.query(
    `WITH yearly AS (
      SELECT
        TRUNC(COALESCE(SUM(total_amount), 0)) AS total_yearly_sales
      FROM tbl_sales
      WHERE zodu_id = $1 AND branch_id = $2
        AND EXTRACT(YEAR FROM sale_date) = $3
        AND sale_type != 'Q'
    ),
    monthly AS (
      SELECT
        TRUNC(COALESCE(SUM(total_amount), 0)) AS total_monthly_sales
      FROM tbl_sales
      WHERE zodu_id = $1 AND branch_id = $2
        AND EXTRACT(YEAR FROM sale_date)  = $3
        AND EXTRACT(MONTH FROM sale_date) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND sale_type != 'Q'
    ),
    last_year AS (
      SELECT
        TRUNC(COALESCE(SUM(total_amount), 0)) AS total_last_year
      FROM tbl_sales
      WHERE zodu_id = $1 AND branch_id = $2
        AND EXTRACT(YEAR FROM sale_date) = $3 - 1
        AND sale_type != 'Q'
    ),
    top_month AS (
      SELECT
        TO_CHAR(TO_DATE(EXTRACT(MONTH FROM sale_date)::text, 'MM'), 'Month') AS top_month_name,
        SUM(total_amount) AS month_total
      FROM tbl_sales
      WHERE zodu_id = $1 AND branch_id = $2
        AND EXTRACT(YEAR FROM sale_date) = $3 AND sale_type != 'Q'
      GROUP BY EXTRACT(MONTH FROM sale_date)
      ORDER BY month_total DESC
      LIMIT 1
    )
    SELECT
      y.total_yearly_sales,
      m.total_monthly_sales,
      l.total_last_year,
      CASE
        WHEN l.total_last_year = 0 THEN NULL
        ELSE ROUND(((y.total_yearly_sales - l.total_last_year) / l.total_last_year) * 100, 1)
      END AS growth_vs_last_year,
      TRIM(t.top_month_name) AS top_performing_month
    FROM yearly y, monthly m, last_year l
    LEFT JOIN top_month t ON true`,
    [zodu_id, branch_id, year]
  );
  return rows[0] || null;
}

async function getPurchaseSummary(zodu_id, branch_id, year) {
  const { rows } = await conn.query(
    `WITH ${PURCHASE_MOVES}
    SELECT
      COALESCE(SUM(bills), 0)::int                        AS total_yearly_purchase_count,
      TRUNC(COALESCE(SUM(amt), 0))                        AS total_yearly_purchase,
      TRUNC(COALESCE(SUM(paid), 0))                       AS total_yearly_paid,
      TRUNC(COALESCE(SUM(amt - paid), 0))                 AS total_yearly_pending
    FROM purchase_moves
    WHERE EXTRACT(YEAR FROM d) = $3`,
    [zodu_id, branch_id, year]
  );
  return rows[0] || null;
}

async function getExpenseSummary(zodu_id, branch_id, year) {
  const { rows } = await conn.query(
    `SELECT
      COUNT(*)::int                                AS total_yearly_expense_count,
      TRUNC(COALESCE(SUM(total_amount), 0))               AS total_yearly_expense,
      TRUNC(COALESCE(SUM(paid_amount), 0))                AS total_yearly_paid,
      TRUNC(COALESCE(SUM(total_amount - paid_amount), 0)) AS total_yearly_pending
    FROM tbl_expense
    WHERE zodu_id = $1 AND branch_id = $2
      AND EXTRACT(YEAR FROM expense_date) = $3`,
    [zodu_id, branch_id, year]
  );
  return rows[0] || null;
}

// ── Monthly Breakdown (offset pagination) ────────────────────
async function getMonthlyBreakdown(zodu_id, branch_id, year, limit, offset) {
  const countResult = await conn.query(
    `SELECT COUNT(*) AS total
     FROM (
       SELECT EXTRACT(MONTH FROM sale_date)
       FROM tbl_sales
       WHERE zodu_id = $1 AND branch_id = $2
         AND EXTRACT(YEAR FROM sale_date) = $3 AND sale_type != 'Q'
       GROUP BY EXTRACT(MONTH FROM sale_date)
     ) months`,
    [zodu_id, branch_id, year]
  );

  const { rows } = await conn.query(
    `SELECT
      EXTRACT(MONTH FROM sale_date)::int                                   AS month_num,
      TO_CHAR(TO_DATE(EXTRACT(MONTH FROM sale_date)::text, 'MM'), 'Month') AS month_name,
      COUNT(*)::int                                                         AS bill_count,
      COALESCE(SUM(subtotal),     0)                                        AS subtotal,
      COALESCE(SUM(total_tax),    0)                                        AS total_tax,
      COALESCE(SUM(total_amount), 0)                                        AS net_sales
    FROM tbl_sales
    WHERE zodu_id = $1 AND branch_id = $2
      AND EXTRACT(YEAR FROM sale_date) = $3 AND sale_type != 'Q'
    GROUP BY EXTRACT(MONTH FROM sale_date)
    ORDER BY month_num ASC
    LIMIT $4 OFFSET $5`,
    [zodu_id, branch_id, year, limit, offset]
  );
  return { rows, total: parseInt(countResult.rows[0]?.total || 0) };
}

// ── Historical Performance (yearly) ───────────────────────────
async function getHistoricalPerformance(zodu_id, branch_id) {
  const { rows } = await conn.query(
    `WITH years AS (
      SELECT generate_series(
        EXTRACT(YEAR FROM CURRENT_DATE)::int - 4,
        EXTRACT(YEAR FROM CURRENT_DATE)::int
      ) AS year
    ),
    sales_by_year AS (
      SELECT
        EXTRACT(YEAR FROM sale_date)::int AS year,
        COALESCE(SUM(total_amount), 0)    AS net_sales
      FROM tbl_sales
      WHERE zodu_id = $1 AND branch_id = $2
      GROUP BY EXTRACT(YEAR FROM sale_date)
    )
    SELECT
      y.year,
      COALESCE(s.net_sales, 0) AS net_sales
    FROM years y
    LEFT JOIN sales_by_year s ON s.year = y.year
    ORDER BY y.year ASC`,
    [zodu_id, branch_id]
  );
  return rows;
}

// ── Category/Item Sales Summary Cards ────────────────────────
async function getCategoryItemSalesSummary(zodu_id, branch_id, from_date, to_date, prev_from, prev_to) {
  const { rows } = await conn.query(
    `WITH period_sales AS (
      SELECT
        TRUNC(COALESCE(SUM(total_amount), 0)) AS total_sales,
        TRUNC(COALESCE(SUM(total_tax), 0)) AS total_tax,
        TRUNC(COALESCE(SUM(subtotal), 0)) AS total_subtotal
      FROM tbl_sales
      WHERE zodu_id = $1 AND branch_id = $2
        AND sale_date BETWEEN $3 AND $4
    ),
    prev_period AS (
      SELECT TRUNC(COALESCE(SUM(total_amount), 0)) AS prev_total
      FROM tbl_sales
      WHERE zodu_id = $1 AND branch_id = $2
        AND sale_date BETWEEN $5 AND $6
    ),
    best_cat AS (
      SELECT c.name AS cat_name, SUM(si.total_amount) AS cat_sales
      FROM tbl_sale_items si
      JOIN tbl_sales s ON s.sale_uuid = si.sale_uuid
      JOIN tbl_menu_items m
        ON m.item_id = si.item_id AND m.zodu_id = $1 AND m.branch_id = $2
      JOIN tbl_category c
        ON c.id = m.category_id AND c.zodu_id = $1
      WHERE s.zodu_id = $1 AND s.branch_id = $2
        AND s.sale_date BETWEEN $3 AND $4
      GROUP BY c.id, c.name
      ORDER BY cat_sales DESC
      LIMIT 1
    ),
    best_item AS (
      SELECT si.item_name, SUM(si.quantity)::float8 AS units_sold
      FROM tbl_sale_items si
      JOIN tbl_sales s ON s.sale_uuid = si.sale_uuid
      WHERE s.zodu_id = $1 AND s.branch_id = $2
        AND s.sale_date BETWEEN $3 AND $4
      GROUP BY si.item_name
      ORDER BY units_sold DESC
      LIMIT 1
    )
    SELECT
      ps.total_sales,
      ps.total_tax,
      ps.total_subtotal,
      pv.prev_total,
      CASE
        WHEN pv.prev_total = 0 THEN NULL
        ELSE ROUND(((ps.total_sales - pv.prev_total) / pv.prev_total) * 100, 1)
      END AS growth_pct,
      COALESCE(bc.cat_name, NULL)  AS best_category_name,
      CASE
        WHEN ps.total_sales = 0 THEN 0
        ELSE ROUND((COALESCE(bc.cat_sales, 0) / ps.total_sales) * 100, 1)
      END AS best_category_pct,
      COALESCE(bi.item_name, NULL) AS best_item_name,
      COALESCE(bi.units_sold, 0)   AS best_item_units,
      CASE
        WHEN ps.total_subtotal = 0 THEN 0
        ELSE ROUND((ps.total_tax / ps.total_subtotal) * 100, 1)
      END AS avg_tax_rate
    FROM period_sales ps
    CROSS JOIN prev_period pv
    LEFT JOIN best_cat  bc ON true
    LEFT JOIN best_item bi ON true`,
    [zodu_id, branch_id, from_date, to_date, prev_from, prev_to]
  );
  return rows[0] || null;
}

// ── Category-wise Sales (paginated) ──────────────────────────
async function getCategoryWiseSales(zodu_id, branch_id, from_date, to_date, prev_from, prev_to, limit, offset) {
  const countResult = await conn.query(
    `SELECT COUNT(DISTINCT COALESCE(m.category_id::text, 'uncategorized')) AS total
     FROM tbl_sale_items si
     JOIN tbl_sales s ON s.sale_uuid = si.sale_uuid
     LEFT JOIN tbl_menu_items m
       ON m.item_id = si.item_id AND m.zodu_id = $1 AND m.branch_id = $2
     WHERE s.zodu_id = $1 AND s.branch_id = $2
       AND s.sale_date BETWEEN $3 AND $4`,
    [zodu_id, branch_id, from_date, to_date]
  );

  const { rows } = await conn.query(
    `WITH current_cat AS (
      SELECT
        COALESCE(m.category_id::text, 'uncategorized') AS cat_key,
        COALESCE(c.name, 'Uncategorized')              AS category_name,
        SUM(si.quantity)::float8                          AS total_units,
        SUM(si.total_amount)                           AS total_sales
      FROM tbl_sale_items si
      JOIN tbl_sales s ON s.sale_uuid = si.sale_uuid
      LEFT JOIN tbl_menu_items m
        ON m.item_id = si.item_id AND m.zodu_id = $1 AND m.branch_id = $2
      LEFT JOIN tbl_category c
        ON c.id = m.category_id AND c.zodu_id = $1
      WHERE s.zodu_id = $1 AND s.branch_id = $2
        AND s.sale_date BETWEEN $3 AND $4
      GROUP BY m.category_id, c.name
    ),
    prev_cat AS (
      SELECT
        COALESCE(m.category_id::text, 'uncategorized') AS cat_key,
        SUM(si.total_amount) AS prev_sales
      FROM tbl_sale_items si
      JOIN tbl_sales s ON s.sale_uuid = si.sale_uuid
      LEFT JOIN tbl_menu_items m
        ON m.item_id = si.item_id AND m.zodu_id = $1 AND m.branch_id = $2
      WHERE s.zodu_id = $1 AND s.branch_id = $2
        AND s.sale_date BETWEEN $5 AND $6
      GROUP BY m.category_id
    )
    SELECT
      cc.category_name,
      cc.total_units,
      cc.total_sales,
      CASE
        WHEN pc.prev_sales IS NULL OR pc.prev_sales = 0 THEN NULL
        ELSE ROUND(((cc.total_sales - pc.prev_sales) / pc.prev_sales) * 100, 1)
      END AS growth
    FROM current_cat cc
    LEFT JOIN prev_cat pc ON pc.cat_key = cc.cat_key
    ORDER BY cc.total_sales DESC
    LIMIT $7 OFFSET $8`,
    [zodu_id, branch_id, from_date, to_date, prev_from, prev_to, limit, offset]
  );

  return { rows, total: parseInt(countResult.rows[0]?.total || 0) };
}

// ── Item-wise Sales (paginated) ───────────────────────────────
async function getItemWiseSales(zodu_id, branch_id, from_date, to_date, limit, offset, category_id) {
  const conditions = ['s.zodu_id = $1', 's.branch_id = $2', 's.sale_date BETWEEN $3 AND $4'];
  const values     = [zodu_id, branch_id, from_date, to_date];
  let   idx        = 5;

  if (category_id != null) {
    conditions.push(`m.category_id = $${idx++}`);
    values.push(category_id);
  }

  const where = conditions.join(' AND ');

  const countResult = await conn.query(
    `SELECT COUNT(DISTINCT si.item_id) AS total
     FROM tbl_sale_items si
     JOIN tbl_sales s ON s.sale_uuid = si.sale_uuid
     LEFT JOIN tbl_menu_items m
       ON m.item_id = si.item_id AND m.zodu_id = $1 AND m.branch_id = $2
     WHERE ${where}`,
    values
  );

  const { rows } = await conn.query(
    `SELECT
       si.item_id,
       si.item_name,
       COALESCE(c.name, 'Uncategorized')                               AS category_name,
       SUM(si.quantity)::float8                                           AS qty,
       ROUND(SUM(si.total_amount) / NULLIF(SUM(si.quantity), 0), 2)   AS price,
       SUM(si.total_amount)                                            AS total
     FROM tbl_sale_items si
     JOIN tbl_sales s ON s.sale_uuid = si.sale_uuid
     LEFT JOIN tbl_menu_items m
       ON m.item_id = si.item_id AND m.zodu_id = $1 AND m.branch_id = $2
     LEFT JOIN tbl_category c
       ON c.id = m.category_id AND c.zodu_id = $1
     WHERE ${where}
     GROUP BY si.item_id, si.item_name, c.name
     ORDER BY total DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...values, limit, offset]
  );

  return { rows, total: parseInt(countResult.rows[0]?.total || 0) };
}

// ── Daily Sales Velocity ──────────────────────────────────────
async function getSalesVelocity(zodu_id, branch_id, from_date, to_date) {
  const { rows } = await conn.query(
    `SELECT
       sale_date,
       COALESCE(SUM(total_amount), 0) AS daily_sales
     FROM tbl_sales
     WHERE zodu_id = $1 AND branch_id = $2
       AND sale_date BETWEEN $3 AND $4
     GROUP BY sale_date
     ORDER BY sale_date ASC`,
    [zodu_id, branch_id, from_date, to_date]
  );
  return rows;
}

// ── Datewise Sale Report ──────────────────────────────────────
async function getDatewiseSaleSummary(zodu_id, branch_id, from_date, to_date) {
  const { rows } = await conn.query(
    `WITH profit_per_sale AS (
       SELECT
         si.sale_uuid,
         SUM(si.quantity * (si.price - COALESCE(m.purchase_price, 0))) AS sale_profit
       FROM tbl_sale_items si
       LEFT JOIN tbl_menu_items m
         ON m.item_id = si.item_id AND m.zodu_id = $1 AND m.branch_id = $2
       GROUP BY si.sale_uuid
     )
     SELECT
       COUNT(DISTINCT s.sale_uuid)          AS total_orders,
       TRUNC(COALESCE(SUM(s.total_amount), 0))     AS total_sales,
       TRUNC(COALESCE(SUM(s.total_tax), 0))        AS total_tax,
       TRUNC(COALESCE(SUM(p.sale_profit), 0))      AS total_profit
     FROM tbl_sales s
     LEFT JOIN profit_per_sale p ON p.sale_uuid = s.sale_uuid
     WHERE s.zodu_id = $1 AND s.branch_id = $2
       AND s.sale_date BETWEEN $3 AND $4
       AND s.sale_type != 'Q'`,
    [zodu_id, branch_id, from_date, to_date]
  );
  return rows[0] || null;
}

async function getDatewiseSaleBreakdown(zodu_id, branch_id, from_date, to_date, limit, offset) {
  const countResult = await conn.query(
    `SELECT COUNT(DISTINCT sale_date) AS total
     FROM tbl_sales
     WHERE zodu_id = $1 AND branch_id = $2
       AND sale_date BETWEEN $3 AND $4
       AND sale_type != 'Q'`,
    [zodu_id, branch_id, from_date, to_date]
  );

  const { rows } = await conn.query(
    `WITH profit_per_sale AS (
       SELECT
         si.sale_uuid,
         SUM(si.quantity * (si.price - COALESCE(m.purchase_price, 0))) AS sale_profit
       FROM tbl_sale_items si
       LEFT JOIN tbl_menu_items m
         ON m.item_id = si.item_id AND m.zodu_id = $1 AND m.branch_id = $2
       GROUP BY si.sale_uuid
     )
     SELECT
       s.sale_date,
       COUNT(DISTINCT s.sale_uuid)::int     AS total_orders,
       COALESCE(SUM(s.total_amount), 0)     AS total_sales,
       COALESCE(SUM(s.total_tax), 0)        AS total_tax,
       COALESCE(SUM(p.sale_profit), 0)      AS total_profit
     FROM tbl_sales s
     LEFT JOIN profit_per_sale p ON p.sale_uuid = s.sale_uuid
     WHERE s.zodu_id = $1 AND s.branch_id = $2
       AND s.sale_date BETWEEN $3 AND $4
       AND s.sale_type != 'Q'
     GROUP BY s.sale_date
     ORDER BY s.sale_date DESC
     LIMIT $5 OFFSET $6`,
    [zodu_id, branch_id, from_date, to_date, limit, offset]
  );

  return { rows, total: parseInt(countResult.rows[0]?.total || 0) };
}

// ── Purchase Reports ──────────────────────────────────────────
async function getPurchaseMonthlyBreakdown(zodu_id, branch_id, year, limit, offset) {
  const countResult = await conn.query(
    `WITH ${PURCHASE_MOVES}
     SELECT COUNT(DISTINCT EXTRACT(MONTH FROM d)) AS total
     FROM purchase_moves
     WHERE EXTRACT(YEAR FROM d) = $3`,
    [zodu_id, branch_id, year]
  );

  const { rows } = await conn.query(
    `WITH ${PURCHASE_MOVES}
    SELECT
      EXTRACT(MONTH FROM d)::int                                   AS month_num,
      TO_CHAR(TO_DATE(EXTRACT(MONTH FROM d)::text, 'MM'), 'Month') AS month_name,
      COALESCE(SUM(bills), 0)::int                                 AS bill_count,
      COALESCE(SUM(amt), 0)                                        AS total_amount,
      COALESCE(SUM(paid), 0)                                       AS total_paid,
      COALESCE(SUM(amt - paid), 0)                                 AS total_pending
    FROM purchase_moves
    WHERE EXTRACT(YEAR FROM d) = $3
    GROUP BY EXTRACT(MONTH FROM d)
    ORDER BY month_num ASC
    LIMIT $4 OFFSET $5`,
    [zodu_id, branch_id, year, limit, offset]
  );
  return { rows, total: parseInt(countResult.rows[0]?.total || 0) };
}

async function getPurchaseDatewiseSummary(zodu_id, branch_id, from_date, to_date) {
  const { rows } = await conn.query(
    `WITH ${PURCHASE_MOVES}
     SELECT
       COALESCE(SUM(bills), 0)                          AS total_orders,
       TRUNC(COALESCE(SUM(amt), 0))                     AS total_purchase,
       TRUNC(COALESCE(SUM(paid), 0))                    AS total_paid,
       TRUNC(COALESCE(SUM(amt - paid), 0))              AS total_pending
     FROM purchase_moves
     WHERE d BETWEEN $3 AND $4`,
    [zodu_id, branch_id, from_date, to_date]
  );
  return rows[0] || null;
}

async function getPurchaseDatewiseBreakdown(zodu_id, branch_id, from_date, to_date, limit, offset) {
  const countResult = await conn.query(
    `WITH ${PURCHASE_MOVES}
     SELECT COUNT(DISTINCT d) AS total
     FROM purchase_moves
     WHERE d BETWEEN $3 AND $4`,
    [zodu_id, branch_id, from_date, to_date]
  );

  const { rows } = await conn.query(
    `WITH ${PURCHASE_MOVES}
     SELECT
       d                                    AS purchase_date,
       COALESCE(SUM(bills), 0)::int         AS total_orders,
       COALESCE(SUM(amt), 0)                AS total_purchase,
       COALESCE(SUM(paid), 0)               AS total_paid,
       COALESCE(SUM(amt - paid), 0)         AS total_pending
     FROM purchase_moves
     WHERE d BETWEEN $3 AND $4
     GROUP BY d
     ORDER BY d DESC
     LIMIT $5 OFFSET $6`,
    [zodu_id, branch_id, from_date, to_date, limit, offset]
  );

  return { rows, total: parseInt(countResult.rows[0]?.total || 0) };
}

// ── Expense Reports ───────────────────────────────────────────
async function getExpenseMonthlyBreakdown(zodu_id, branch_id, year, limit, offset) {
  const countResult = await conn.query(
    `SELECT COUNT(*) AS total
     FROM (
       SELECT EXTRACT(MONTH FROM expense_date)
       FROM tbl_expense
       WHERE zodu_id = $1 AND branch_id = $2
         AND EXTRACT(YEAR FROM expense_date) = $3
       GROUP BY EXTRACT(MONTH FROM expense_date)
     ) months`,
    [zodu_id, branch_id, year]
  );

  const { rows } = await conn.query(
    `SELECT
      EXTRACT(MONTH FROM expense_date)::int                                   AS month_num,
      TO_CHAR(TO_DATE(EXTRACT(MONTH FROM expense_date)::text, 'MM'), 'Month') AS month_name,
      COUNT(*)::int                                                            AS bill_count,
      COALESCE(SUM(total_amount), 0)                                          AS total_amount,
      COALESCE(SUM(paid_amount), 0)                                           AS total_paid,
      COALESCE(SUM(total_amount - paid_amount), 0)                            AS total_pending
    FROM tbl_expense
    WHERE zodu_id = $1 AND branch_id = $2
      AND EXTRACT(YEAR FROM expense_date) = $3
    GROUP BY EXTRACT(MONTH FROM expense_date)
    ORDER BY month_num ASC
    LIMIT $4 OFFSET $5`,
    [zodu_id, branch_id, year, limit, offset]
  );
  return { rows, total: parseInt(countResult.rows[0]?.total || 0) };
}

async function getExpenseDatewiseSummary(zodu_id, branch_id, from_date, to_date) {
  const { rows } = await conn.query(
    `SELECT
       COUNT(DISTINCT id)                               AS total_entries,
       TRUNC(COALESCE(SUM(total_amount), 0))                  AS total_expense,
       TRUNC(COALESCE(SUM(paid_amount), 0))                   AS total_paid,
       TRUNC(COALESCE(SUM(total_amount - paid_amount), 0))    AS total_pending
     FROM tbl_expense
     WHERE zodu_id = $1 AND branch_id = $2
       AND expense_date BETWEEN $3 AND $4`,
    [zodu_id, branch_id, from_date, to_date]
  );
  return rows[0] || null;
}

async function getExpenseDatewiseBreakdown(zodu_id, branch_id, from_date, to_date, limit, offset) {
  const countResult = await conn.query(
    `SELECT COUNT(DISTINCT expense_date) AS total
     FROM tbl_expense
     WHERE zodu_id = $1 AND branch_id = $2
       AND expense_date BETWEEN $3 AND $4`,
    [zodu_id, branch_id, from_date, to_date]
  );

  const { rows } = await conn.query(
    `SELECT
       expense_date,
       COUNT(DISTINCT id)::int                       AS total_entries,
       COALESCE(SUM(total_amount), 0)               AS total_expense,
       COALESCE(SUM(paid_amount), 0)                AS total_paid,
       COALESCE(SUM(total_amount - paid_amount), 0) AS total_pending
     FROM tbl_expense
     WHERE zodu_id = $1 AND branch_id = $2
       AND expense_date BETWEEN $3 AND $4
     GROUP BY expense_date
     ORDER BY expense_date DESC
     LIMIT $5 OFFSET $6`,
    [zodu_id, branch_id, from_date, to_date, limit, offset]
  );

  return { rows, total: parseInt(countResult.rows[0]?.total || 0) };
}

// ── Profit Calculation (monthly breakdown for a given year) ──
async function getProfitByYear(zodu_id, branch_id, year) {
  const { rows } = await conn.query(
    `WITH months AS (
       SELECT generate_series(1, 12) AS month_num
     ),
     ${SALE_MOVES},
     ${PURCHASE_MOVES},
     sales_data AS (
       SELECT EXTRACT(MONTH FROM d)::int AS month_num, COALESCE(SUM(amt), 0) AS total_sales
       FROM sale_moves
       WHERE EXTRACT(YEAR FROM d) = $3::int
       GROUP BY EXTRACT(MONTH FROM d)
     ),
     purchase_data AS (
       SELECT EXTRACT(MONTH FROM d)::int AS month_num, COALESCE(SUM(amt), 0) AS total_purchase
       FROM purchase_moves
       WHERE EXTRACT(YEAR FROM d) = $3::int
       GROUP BY EXTRACT(MONTH FROM d)
     ),
     expense_data AS (
       SELECT
         EXTRACT(MONTH FROM expense_date)::int AS month_num,
         COALESCE(SUM(total_amount), 0)         AS total_expense
       FROM tbl_expense
       WHERE zodu_id = $1 AND branch_id = $2
         AND EXTRACT(YEAR FROM expense_date) = $3::int
       GROUP BY EXTRACT(MONTH FROM expense_date)
     )
     SELECT
       m.month_num,
       TO_CHAR(TO_DATE(m.month_num::text, 'MM'), 'Month') AS month_name,
       TRUNC(COALESCE(s.total_sales,    0)) AS total_sales,
       TRUNC(COALESCE(p.total_purchase, 0)) AS total_purchase,
       TRUNC(COALESCE(e.total_expense,  0)) AS total_expense,
       TRUNC(COALESCE(s.total_sales, 0)
         - COALESCE(p.total_purchase, 0)
         - COALESCE(e.total_expense,  0))              AS profit
     FROM months m
     LEFT JOIN sales_data    s ON s.month_num = m.month_num
     LEFT JOIN purchase_data p ON p.month_num = m.month_num
     LEFT JOIN expense_data  e ON e.month_num = m.month_num
     ORDER BY m.month_num ASC`,
    [zodu_id, branch_id, year]
  );
  return rows;
}

// ── Active Years for Profit Dropdown ──────────────────────────
async function getProfitActiveYears(zodu_id, branch_id) {
  const { rows } = await conn.query(
    `WITH ${PROFIT_YEARS}
     SELECT year FROM years ORDER BY year DESC`,
    [zodu_id, branch_id]
  );
  return rows.map((r) => r.year);
}

// ── Profit Year-wise Summary (paginated) ──────────────────────
async function getProfitYearwise(zodu_id, branch_id, limit, offset) {
  const [{ rows }, { rows: countRows }, { rows: summaryRows }] = await Promise.all([

    // data rows — one row per year
    conn.query(
      `WITH ${PROFIT_YEARS}
       SELECT
         y.year,
         COALESCE(s.total_sales,    0) AS total_sales,
         COALESCE(p.total_purchase, 0) AS total_purchase,
         COALESCE(e.total_expense,  0) AS total_expense,
         COALESCE(s.total_sales,    0)
           - COALESCE(p.total_purchase, 0)
           - COALESCE(e.total_expense,  0) AS profit
       FROM years y
       LEFT JOIN sales_y    s ON s.year = y.year
       LEFT JOIN purchase_y p ON p.year = y.year
       LEFT JOIN expense_y  e ON e.year = y.year
       ORDER  BY y.year DESC
       LIMIT  $3 OFFSET $4`,
      [zodu_id, branch_id, limit, offset]
    ),

    // total distinct year count for pagination meta
    conn.query(
      `WITH ${PROFIT_YEARS}
       SELECT COUNT(*)::int AS total FROM years`,
      [zodu_id, branch_id]
    ),

    // overall summary — all years combined
    conn.query(
      `WITH ${PROFIT_YEARS}
       SELECT
         TRUNC(COALESCE((SELECT SUM(total_sales)    FROM sales_y),    0)) AS total_sales,
         TRUNC(COALESCE((SELECT SUM(total_purchase) FROM purchase_y), 0)) AS total_purchase,
         TRUNC(COALESCE((SELECT SUM(total_expense)  FROM expense_y),  0)) AS total_expense`,
      [zodu_id, branch_id]
    ),
  ]);

  const s = summaryRows[0];
  const overall_summary = {
    total_sales:    parseFloat(s.total_sales    || 0),
    total_purchase: parseFloat(s.total_purchase || 0),
    total_expense:  parseFloat(s.total_expense  || 0),
    profit:         parseFloat(s.total_sales || 0) - parseFloat(s.total_purchase || 0) - parseFloat(s.total_expense || 0),
  };

  return { rows, total: parseInt(countRows[0]?.total || 0), overall_summary };
}

// ── Expense Category-wise Report ──────────────────────────────
// Only categories of type 'E' belonging to the same zodu_id/branch_id are
// reported. Both queries are served by idx_tbl_expense_report.
async function getExpenseCategoryWiseSummary(zodu_id, branch_id, from_date, to_date) {
  const { rows } = await conn.query(
    `SELECT
       COUNT(*)::int                                     AS total_entries,
       COALESCE(SUM(e.total_amount), 0)                  AS total_expense,
       COALESCE(SUM(e.paid_amount), 0)                   AS total_paid,
       COALESCE(SUM(e.total_amount - e.paid_amount), 0)  AS total_pending
     FROM tbl_expense e
     JOIN tbl_category c
         ON  c.id        = e.category_id
         AND c.zodu_id   = e.zodu_id
         AND c.branch_id = e.branch_id
         AND c.type      = 'E'
     WHERE e.zodu_id = $1 AND e.branch_id = $2
       AND e.expense_date BETWEEN $3 AND $4`,
    [zodu_id, branch_id, from_date, to_date]
  );
  return rows[0] || null;
}

// Rows = one per category (totals across the date range); count and page run in parallel.
async function getExpenseCategoryWise(zodu_id, branch_id, from_date, to_date, limit, offset) {
  const params = [zodu_id, branch_id, from_date, to_date];

  const [countResult, { rows }] = await Promise.all([
    conn.query(
      `SELECT COUNT(*)::int AS total
       FROM (
         SELECT 1
         FROM tbl_expense e
         JOIN tbl_category c
         ON  c.id        = e.category_id
         AND c.zodu_id   = e.zodu_id
         AND c.branch_id = e.branch_id
         AND c.type      = 'E'
         WHERE e.zodu_id = $1 AND e.branch_id = $2
           AND e.expense_date BETWEEN $3 AND $4
         GROUP BY e.category_id
       ) g`,
      params
    ),
    conn.query(
      `SELECT
         e.category_id,
         c.name                                            AS category_name,
         COUNT(*)::int                                     AS total_entries,
         COALESCE(SUM(e.total_amount), 0)                  AS total_expense,
         COALESCE(SUM(e.paid_amount), 0)                   AS total_paid,
         COALESCE(SUM(e.total_amount - e.paid_amount), 0)  AS total_pending
       FROM tbl_expense e
       JOIN tbl_category c
         ON  c.id        = e.category_id
         AND c.zodu_id   = e.zodu_id
         AND c.branch_id = e.branch_id
         AND c.type      = 'E'
       WHERE e.zodu_id = $1 AND e.branch_id = $2
         AND e.expense_date BETWEEN $3 AND $4
       GROUP BY e.category_id, c.name
       ORDER BY total_expense DESC, c.name ASC, e.category_id ASC
       LIMIT $5 OFFSET $6`,
      [...params, limit, offset]
    ),
  ]);

  return { rows, total: countResult.rows[0]?.total || 0 };
}

// GSTN unit quantity codes. Units are stored as free text / short names ("PKT", "Gram" ...),
// so the common ones are mapped to the code the GST portal expects; anything else is passed
// through upper-cased and a missing unit becomes "OTH".
const uqcSql = (col) => `CASE UPPER(TRIM(COALESCE(${col}, '')))
    WHEN ''         THEN 'OTH'
    WHEN 'PKT'      THEN 'PAC'
    WHEN 'PACKET'   THEN 'PAC'
    WHEN 'GM'       THEN 'GMS'
    WHEN 'GRAM'     THEN 'GMS'
    WHEN 'KG'       THEN 'KGS'
    WHEN 'KILOGRAM' THEN 'KGS'
    WHEN 'LITRE'    THEN 'LTR'
    WHEN 'PIECE'    THEN 'PCS'
    WHEN 'NUMBER'   THEN 'NOS'
    ELSE UPPER(TRIM(${col}))
  END`;

// ── GSTR-1 HSN-wise summary (Table 12) ────────────────────────
// Outward supplies from finalized, non-cancelled orders in the period, grouped by HSN + UQC + GST
// rate. Order lines keep the rate and tax from billing time, but not the HSN, so the HSN is read
// from the menu item. The unit is stored as the unit id (or its short name), resolved through
// tbl_units. Items with no HSN are left out. Taxable value strips the tax from tax-inclusive lines. IGST / cess are not supported.
const GSTR1_HSN_BASE = `
  WITH lines AS (
    SELECT
      NULLIF(TRIM(m.hsn_code), '')            AS hsn_code,
      ${uqcSql(`COALESCE(
        (SELECT u.short_name FROM tbl_units u WHERE u.id::text = oi.item_unit::text LIMIT 1),
        oi.item_unit::text)`)}                AS uqc,
      COALESCE(oi.gst_percentage, 0)          AS gst_rate,
      oi.qty                                  AS quantity,
      CASE WHEN oi.gst_percentage > 0 AND oi.tax_inclusive
           THEN oi.price * oi.qty / (1 + oi.gst_percentage / 100.0)
           ELSE oi.price * oi.qty
      END                                     AS taxable_value,
      COALESCE(oi.cgst, 0)                    AS cgst,
      COALESCE(oi.sgst, 0)                    AS sgst
    FROM tbl_orders o
    JOIN tbl_ordered_items oi ON oi.api_order_id = o.api_order_id
    LEFT JOIN tbl_menu_items m
      ON m.menu_id = oi.item_id AND m.branch_id = o.branch_id AND m.zodu_id = o.zodu_id
    WHERE o.zodu_id = $1 AND o.branch_id = $2
      AND o.order_date >= $3::date AND o.order_date < ($4::date + 1)
      AND o.cancelled_order = false
      AND NULLIF(TRIM(m.hsn_code), '') IS NOT NULL   -- items without an HSN are not reported
  ),
  grp AS (
    SELECT
      hsn_code, uqc, gst_rate,
      ROUND(SUM(quantity)::numeric, 3)       AS quantity,
      ROUND(SUM(taxable_value)::numeric, 2)  AS taxable_value,
      ROUND(SUM(cgst)::numeric, 2)           AS cgst,
      ROUND(SUM(sgst)::numeric, 2)           AS sgst
    FROM lines
    GROUP BY hsn_code, uqc, gst_rate
  ),
  hsn AS (
    -- Description from the HSN master: exact code first, else the first code that starts with it
    -- (bills often carry a 4 or 6 digit HSN while the master lists 8 digit codes).
    SELECT g.*,
      COALESCE(
        (SELECT m.description FROM tbl_hsn_master m WHERE m.hsn_code = g.hsn_code),
        (SELECT m.description FROM tbl_hsn_master m
          WHERE g.hsn_code IS NOT NULL AND starts_with(m.hsn_code, g.hsn_code)
          ORDER BY m.hsn_code LIMIT 1)
      ) AS description
    FROM grp g
  ),
  filtered AS (
    SELECT * FROM hsn
    WHERE $5::text IS NULL OR hsn_code ILIKE $5 OR description ILIKE $5 OR uqc ILIKE $5
  )`;

async function getGstr1Hsn(zodu_id, branch_id, from_date, to_date, search, limit, offset) {
  const params = [zodu_id, branch_id, from_date, to_date, search];

  const [summaryResult, rowsResult] = await Promise.all([
    conn.query(
      `${GSTR1_HSN_BASE}
       SELECT
         COUNT(*)::int                      AS total_hsn_items,
         COALESCE(SUM(taxable_value), 0)    AS total_taxable_value,
         COALESCE(SUM(cgst), 0)             AS total_cgst,
         COALESCE(SUM(sgst), 0)             AS total_sgst
       FROM filtered`,
      params
    ),
    conn.query(
      `${GSTR1_HSN_BASE}
       SELECT hsn_code, description, uqc, gst_rate, quantity, taxable_value, cgst, sgst
       FROM filtered
       ORDER BY hsn_code NULLS LAST, uqc, gst_rate
       LIMIT $6 OFFSET $7`,
      [...params, limit, offset]
    ),
  ]);

  return { summary: summaryResult.rows[0], rows: rowsResult.rows };
}


module.exports = {
  getGstr1Hsn,
  getSalesSummary,
  getMonthlyBreakdown,
  getHistoricalPerformance,
  getCategoryItemSalesSummary,
  getCategoryWiseSales,
  getItemWiseSales,
  getSalesVelocity,
  getDatewiseSaleSummary,
  getDatewiseSaleBreakdown,
  getPurchaseMonthlyBreakdown,
  getPurchaseSummary,
  getPurchaseDatewiseSummary,
  getPurchaseDatewiseBreakdown,
  getExpenseSummary,
  getExpenseMonthlyBreakdown,
  getExpenseDatewiseSummary,
  getExpenseDatewiseBreakdown,
  getExpenseCategoryWiseSummary,
  getExpenseCategoryWise,
  getProfitByYear,
  getProfitActiveYears,
  getProfitYearwise,
};
