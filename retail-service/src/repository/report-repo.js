const conn = require("../database/connection");

// ── Returns are netted into the sales / purchase / profit reports ──────────────────────────
// A sale return / credit note counts as a NEGATIVE sale on the date of the ORIGINAL invoice (not the
// day it was returned), and a purchase return / debit note as a NEGATIVE purchase on the original
// purchase date, so a return always reduces the day / month of the bill it came from. The *_MOVES CTEs below stack the
// documents and the returns into one list with the same columns, so a report only has to SUM it
// and amount, tax and quantity come out net. `bills` is 1 for a document and 0 for a return (and 0 for a document that has been returned
// in full), so a fully returned bill drops out of the bill counts. Returns raised against a cancelled invoice / purchase are ignored,
// the same as the credit-note GST tabs. Every query using them has $1 = zodu_id, $2 = branch_id.
// They are NOT MATERIALIZED on purpose: that lets Postgres push each report's date filter down into
// the sales / returns scans instead of building the tenant's whole history first (the difference is
// seconds on a branch with a million bills).

// Documents: sub = subtotal, tax = total_tax, amt = total_amount.
const SALE_MOVES = `sale_moves AS NOT MATERIALIZED (
    SELECT s.sale_date AS d, CASE WHEN s.total_amount > 0 AND COALESCE((SELECT SUM(r2.return_amount) FROM tbl_sale_returns r2
                      WHERE r2.zodu_id = $1 AND r2.branch_id = $2 AND r2.original_sale_uuid = s.sale_uuid), 0) >= s.total_amount - 0.01
                THEN 0 ELSE 1 END AS bills, s.subtotal AS sub, s.total_tax AS tax, s.total_amount AS amt
    FROM tbl_sales s
    WHERE s.zodu_id = $1 AND s.branch_id = $2 AND s.sale_type != 'Q' AND s.cancelled_inv = false
    UNION ALL
    SELECT s.sale_date, 0, -r.subtotal, -r.total_tax, -r.return_amount
    FROM tbl_sale_returns r
    JOIN tbl_sales s ON s.sale_uuid = r.original_sale_uuid
    WHERE r.zodu_id = $1 AND r.branch_id = $2 AND s.zodu_id = $1 AND s.branch_id = $2
      AND s.sale_type != 'Q' AND s.cancelled_inv = false
  )`;

// Same, per item line (for category / item reports). A returned line is worth what the customer
// got back: taxable value less its share of the discounts plus tax.
const SALE_ITEM_MOVES = `item_moves AS NOT MATERIALIZED (
    SELECT s.sale_date AS d, si.item_id, si.item_name, si.quantity AS qty, si.total_amount AS amt
    FROM tbl_sale_items si
    JOIN tbl_sales s ON s.sale_uuid = si.sale_uuid
    WHERE s.zodu_id = $1 AND s.branch_id = $2 AND s.sale_type != 'Q' AND s.cancelled_inv = false
    UNION ALL
    SELECT s.sale_date, ri.item_id, ri.item_name, -ri.return_qty,
           -(COALESCE(ri.taxable_amount, 0) - COALESCE(ri.discount_amount, 0) + COALESCE(ri.tax_amount, 0))
    FROM tbl_sale_return_items ri
    JOIN tbl_sale_returns r ON r.return_uuid = ri.return_uuid
    JOIN tbl_sales s ON s.sale_uuid = r.original_sale_uuid
    WHERE r.zodu_id = $1 AND r.branch_id = $2 AND s.zodu_id = $1 AND s.branch_id = $2
      AND s.sale_type != 'Q' AND s.cancelled_inv = false
  )`;

// Same again with profit, for the date-wise sale report. A returned item takes back its margin
// (return qty x (price - current purchase price)), mirroring how the sale's margin is worked out.
const SALE_PROFIT_MOVES = `sale_profit_moves AS NOT MATERIALIZED (
    SELECT s.sale_date AS d, CASE WHEN s.total_amount > 0 AND COALESCE((SELECT SUM(r2.return_amount) FROM tbl_sale_returns r2
                      WHERE r2.zodu_id = $1 AND r2.branch_id = $2 AND r2.original_sale_uuid = s.sale_uuid), 0) >= s.total_amount - 0.01
                THEN 0 ELSE 1 END AS bills, s.total_amount AS amt, s.total_tax AS tax,
           COALESCE(p.sale_profit, 0) AS profit
    FROM tbl_sales s
    LEFT JOIN LATERAL (
      SELECT SUM(si.quantity * (si.price - COALESCE(m.purchase_price, 0))) AS sale_profit
      FROM tbl_sale_items si
      LEFT JOIN tbl_menu_items m ON m.item_id = si.item_id AND m.zodu_id = $1 AND m.branch_id = $2
      WHERE si.sale_uuid = s.sale_uuid
    ) p ON true
    WHERE s.zodu_id = $1 AND s.branch_id = $2 AND s.sale_type != 'Q' AND s.cancelled_inv = false
    UNION ALL
    SELECT s.sale_date, 0, -r.return_amount, -r.total_tax, -COALESCE(rp.return_profit, 0)
    FROM tbl_sale_returns r
    JOIN tbl_sales s ON s.sale_uuid = r.original_sale_uuid
    LEFT JOIN LATERAL (
      SELECT SUM(ri.return_qty * (ri.price - COALESCE(m.purchase_price, 0))) AS return_profit
      FROM tbl_sale_return_items ri
      LEFT JOIN tbl_menu_items m ON m.item_id = ri.item_id AND m.zodu_id = $1 AND m.branch_id = $2
      WHERE ri.return_uuid = r.return_uuid
    ) rp ON true
    WHERE r.zodu_id = $1 AND r.branch_id = $2 AND s.zodu_id = $1 AND s.branch_id = $2
      AND s.sale_type != 'Q' AND s.cancelled_inv = false
  )`;

// Purchases: amt = total_amount, paid = paid_amount. A return lowers the bought value by
// return_amount and the money paid by what the vendor has refunded so far, so
// pending (amt - paid) comes out right: the part set off against the bill drops the pending,
// the part already paid becomes a refund due from the vendor until it is received.
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

// Per-year sales / purchase / expense for the profit reports (net of returns).
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
    `WITH ${SALE_MOVES},
    yearly AS (
      SELECT TRUNC(COALESCE(SUM(amt), 0)) AS total_yearly_sales
      FROM sale_moves
      WHERE EXTRACT(YEAR FROM d) = $3
    ),
    monthly AS (
      SELECT TRUNC(COALESCE(SUM(amt), 0)) AS total_monthly_sales
      FROM sale_moves
      WHERE EXTRACT(YEAR FROM d)  = $3
        AND EXTRACT(MONTH FROM d) = EXTRACT(MONTH FROM CURRENT_DATE)
    ),
    last_year AS (
      SELECT TRUNC(COALESCE(SUM(amt), 0)) AS total_last_year
      FROM sale_moves
      WHERE EXTRACT(YEAR FROM d) = $3 - 1
    ),
    top_month AS (
      SELECT
        TO_CHAR(TO_DATE(EXTRACT(MONTH FROM d)::text, 'MM'), 'Month') AS top_month_name,
        SUM(amt) AS month_total
      FROM sale_moves
      WHERE EXTRACT(YEAR FROM d) = $3
      GROUP BY EXTRACT(MONTH FROM d)
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
    `WITH ${SALE_MOVES}
     SELECT COUNT(DISTINCT EXTRACT(MONTH FROM d)) AS total
     FROM sale_moves
     WHERE EXTRACT(YEAR FROM d) = $3`,
    [zodu_id, branch_id, year]
  );

  const { rows } = await conn.query(
    `WITH ${SALE_MOVES}
    SELECT
      EXTRACT(MONTH FROM d)::int                                   AS month_num,
      TO_CHAR(TO_DATE(EXTRACT(MONTH FROM d)::text, 'MM'), 'Month') AS month_name,
      COALESCE(SUM(bills), 0)::int                                 AS bill_count,
      COALESCE(SUM(sub),   0)                                      AS subtotal,
      COALESCE(SUM(tax),   0)                                      AS total_tax,
      COALESCE(SUM(amt),   0)                                      AS net_sales
    FROM sale_moves
    WHERE EXTRACT(YEAR FROM d) = $3
    GROUP BY EXTRACT(MONTH FROM d)
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
    ${SALE_MOVES},
    sales_by_year AS (
      SELECT EXTRACT(YEAR FROM d)::int AS year, COALESCE(SUM(amt), 0) AS net_sales
      FROM sale_moves
      GROUP BY EXTRACT(YEAR FROM d)
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
    `WITH ${SALE_MOVES}, ${SALE_ITEM_MOVES},
    period_sales AS (
      SELECT
        TRUNC(COALESCE(SUM(amt), 0)) AS total_sales,
        TRUNC(COALESCE(SUM(tax), 0)) AS total_tax,
        TRUNC(COALESCE(SUM(sub), 0)) AS total_subtotal
      FROM sale_moves
      WHERE d BETWEEN $3 AND $4
    ),
    prev_period AS (
      SELECT TRUNC(COALESCE(SUM(amt), 0)) AS prev_total
      FROM sale_moves
      WHERE d BETWEEN $5 AND $6
    ),
    best_cat AS (
      SELECT c.name AS cat_name, SUM(im.amt) AS cat_sales
      FROM item_moves im
      JOIN tbl_menu_items m
        ON m.item_id = im.item_id AND m.zodu_id = $1 AND m.branch_id = $2
      JOIN tbl_category c
        ON c.id = m.category_id AND c.zodu_id = $1
      WHERE im.d BETWEEN $3 AND $4
      GROUP BY c.id, c.name
      ORDER BY cat_sales DESC
      LIMIT 1
    ),
    best_item AS (
      SELECT im.item_name, SUM(im.qty)::float8 AS units_sold
      FROM item_moves im
      WHERE im.d BETWEEN $3 AND $4
      GROUP BY im.item_name
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
    `WITH ${SALE_ITEM_MOVES}
     SELECT COUNT(DISTINCT COALESCE(m.category_id::text, 'uncategorized')) AS total
     FROM item_moves im
     LEFT JOIN tbl_menu_items m
       ON m.item_id = im.item_id AND m.zodu_id = $1 AND m.branch_id = $2
     WHERE im.d BETWEEN $3 AND $4`,
    [zodu_id, branch_id, from_date, to_date]
  );

  const { rows } = await conn.query(
    `WITH ${SALE_ITEM_MOVES},
    current_cat AS (
      SELECT
        COALESCE(m.category_id::text, 'uncategorized') AS cat_key,
        COALESCE(c.name, 'Uncategorized')              AS category_name,
        SUM(im.qty)::float8                            AS total_units,
        SUM(im.amt)                                    AS total_sales
      FROM item_moves im
      LEFT JOIN tbl_menu_items m
        ON m.item_id = im.item_id AND m.zodu_id = $1 AND m.branch_id = $2
      LEFT JOIN tbl_category c
        ON c.id = m.category_id AND c.zodu_id = $1
      WHERE im.d BETWEEN $3 AND $4
      GROUP BY m.category_id, c.name
    ),
    prev_cat AS (
      SELECT
        COALESCE(m.category_id::text, 'uncategorized') AS cat_key,
        SUM(im.amt) AS prev_sales
      FROM item_moves im
      LEFT JOIN tbl_menu_items m
        ON m.item_id = im.item_id AND m.zodu_id = $1 AND m.branch_id = $2
      WHERE im.d BETWEEN $5 AND $6
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
  const conditions = ['im.d BETWEEN $3 AND $4'];
  const values     = [zodu_id, branch_id, from_date, to_date];
  let   idx        = 5;

  if (category_id != null) {
    conditions.push(`m.category_id = $${idx++}`);
    values.push(category_id);
  }

  const where = conditions.join(' AND ');

  // An item sold and fully returned in the period nets to nothing, so it is not listed.
  const countResult = await conn.query(
    `WITH ${SALE_ITEM_MOVES}
     SELECT COUNT(*) AS total
     FROM (
       SELECT im.item_id
       FROM item_moves im
       LEFT JOIN tbl_menu_items m
         ON m.item_id = im.item_id AND m.zodu_id = $1 AND m.branch_id = $2
       WHERE ${where}
       GROUP BY im.item_id
       HAVING SUM(im.qty) <> 0 OR SUM(im.amt) <> 0
     ) items`,
    values
  );

  const { rows } = await conn.query(
    `WITH ${SALE_ITEM_MOVES}
     SELECT
       im.item_id,
       im.item_name,
       COALESCE(c.name, 'Uncategorized')                               AS category_name,
       SUM(im.qty)::float8                                             AS qty,
       ROUND(SUM(im.amt) / NULLIF(SUM(im.qty), 0), 2)                  AS price,
       SUM(im.amt)                                                     AS total
     FROM item_moves im
     LEFT JOIN tbl_menu_items m
       ON m.item_id = im.item_id AND m.zodu_id = $1 AND m.branch_id = $2
     LEFT JOIN tbl_category c
       ON c.id = m.category_id AND c.zodu_id = $1
     WHERE ${where}
     GROUP BY im.item_id, im.item_name, c.name
     HAVING SUM(im.qty) <> 0 OR SUM(im.amt) <> 0
     ORDER BY total DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...values, limit, offset]
  );

  return { rows, total: parseInt(countResult.rows[0]?.total || 0) };
}

// ── Daily Sales Velocity ──────────────────────────────────────
async function getSalesVelocity(zodu_id, branch_id, from_date, to_date) {
  const { rows } = await conn.query(
    `WITH ${SALE_MOVES}
     SELECT
       d                          AS sale_date,
       COALESCE(SUM(amt), 0)      AS daily_sales
     FROM sale_moves
     WHERE d BETWEEN $3 AND $4
     GROUP BY d
     ORDER BY d ASC`,
    [zodu_id, branch_id, from_date, to_date]
  );
  return rows;
}

// ── Datewise Sale Report ──────────────────────────────────────
async function getDatewiseSaleSummary(zodu_id, branch_id, from_date, to_date) {
  const { rows } = await conn.query(
    `WITH ${SALE_PROFIT_MOVES}
     SELECT
       COALESCE(SUM(bills), 0)                     AS total_orders,
       TRUNC(COALESCE(SUM(amt), 0))                AS total_sales,
       TRUNC(COALESCE(SUM(tax), 0))                AS total_tax,
       TRUNC(COALESCE(SUM(profit), 0))             AS total_profit
     FROM sale_profit_moves
     WHERE d BETWEEN $3 AND $4`,
    [zodu_id, branch_id, from_date, to_date]
  );
  return rows[0] || null;
}

async function getDatewiseSaleBreakdown(zodu_id, branch_id, from_date, to_date, limit, offset) {
  const countResult = await conn.query(
    `WITH ${SALE_MOVES}
     SELECT COUNT(DISTINCT d) AS total
     FROM sale_moves
     WHERE d BETWEEN $3 AND $4`,
    [zodu_id, branch_id, from_date, to_date]
  );

  const { rows } = await conn.query(
    `WITH ${SALE_PROFIT_MOVES}
     SELECT
       d                                    AS sale_date,
       COALESCE(SUM(bills), 0)::int         AS total_orders,
       COALESCE(SUM(amt), 0)                AS total_sales,
       COALESCE(SUM(tax), 0)                AS total_tax,
       COALESCE(SUM(profit), 0)             AS total_profit
     FROM sale_profit_moves
     WHERE d BETWEEN $3 AND $4
     GROUP BY d
     ORDER BY d DESC
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

// ── GSTR-1 B2B ────────────────────────────────────────────────
// B2B = non-cancelled sale invoices (sale_type 'S') of customers that have a GSTIN.
// IGST / CESS are not supported yet, so they are returned as 0 by the service.
const GSTR1_B2B_BASE = `
  WITH inv AS (
    SELECT
      s.sale_uuid,
      s.sale_id                         AS invoice_no,
      TO_CHAR(s.sale_date, 'YYYY-MM-DD') AS invoice_date,
      c.cust_name                       AS customer_name,
      UPPER(TRIM(c.gst))                AS gstin,
      s.subtotal                        AS taxable_value,
      COALESCE(t.cgst, 0)               AS cgst,
      COALESCE(t.sgst, 0)               AS sgst,
      s.total_amount                    AS total_value
    FROM tbl_sales s
    JOIN tbl_customer c ON c.cust_uuid = s.customer_uuid
    LEFT JOIN LATERAL (
      SELECT SUM(si.cgst) AS cgst, SUM(si.sgst) AS sgst
      FROM tbl_sale_items si
      WHERE si.sale_uuid = s.sale_uuid
    ) t ON true
    WHERE s.zodu_id = $1 AND s.branch_id = $2
      AND s.sale_date BETWEEN $3 AND $4
      AND s.sale_type = 'S'
      AND s.cancelled_inv = false
      AND COALESCE(TRIM(c.gst), '') <> ''
      AND ($5::text IS NULL OR UPPER(TRIM(c.gst)) = $5)
      AND ($6::text IS NULL
           OR s.sale_id ILIKE $6 OR c.cust_name ILIKE $6 OR c.gst ILIKE $6)
  )`;

async function getGstr1B2BGstins(zodu_id, branch_id, from_date, to_date) {
  const { rows } = await conn.query(
    `SELECT UPPER(TRIM(c.gst)) AS gstin, MAX(c.cust_name) AS customer_name
     FROM tbl_sales s
     JOIN tbl_customer c ON c.cust_uuid = s.customer_uuid
     WHERE s.zodu_id = $1 AND s.branch_id = $2
       AND s.sale_date BETWEEN $3 AND $4
       AND s.sale_type = 'S' AND s.cancelled_inv = false
       AND COALESCE(TRIM(c.gst), '') <> ''
     GROUP BY UPPER(TRIM(c.gst))
     ORDER BY customer_name`,
    [zodu_id, branch_id, from_date, to_date]
  );
  return rows;
}

async function getGstr1B2B(zodu_id, branch_id, from_date, to_date, gstin, search, limit, offset) {
  const params = [zodu_id, branch_id, from_date, to_date, gstin, search];

  const [summaryResult, rowsResult] = await Promise.all([
    conn.query(
      `${GSTR1_B2B_BASE}
       SELECT
         COUNT(*)::int                     AS total_invoices,
         COALESCE(SUM(taxable_value), 0)   AS total_taxable_value,
         COALESCE(SUM(cgst), 0)            AS total_cgst,
         COALESCE(SUM(sgst), 0)            AS total_sgst,
         COALESCE(SUM(total_value), 0)     AS total_value
       FROM inv`,
      params
    ),
    conn.query(
      `${GSTR1_B2B_BASE}
       SELECT * FROM inv
       ORDER BY invoice_date, invoice_no
       LIMIT $7 OFFSET $8`,
      [...params, limit, offset]
    ),
  ]);

  return { summary: summaryResult.rows[0], rows: rowsResult.rows };
}

// ── GSTR-1 B2C Large ──────────────────────────────────────────
// B2C Large = non-cancelled sale invoices to customers WITHOUT a GSTIN, where the
// place of supply (customer state) differs from the branch state (inter-state) and
// the invoice value exceeds the threshold. The branch state is passed in by the
// service (tbl_branch lives in auth-service). Filtering is done first on the
// lightweight `inv` CTE; per-item CGST/SGST is looked up afterwards (for the page
// only in the rows query) so we never aggregate tbl_sale_items for discarded rows.
const GSTR1_B2CL_BASE = `
  WITH inv AS (
    SELECT
      s.sale_uuid,
      s.sale_id                          AS invoice_no,
      s.sale_date,
      c.cust_name                        AS customer_name,
      c.state                            AS place_of_supply,
      s.subtotal                         AS taxable_value,
      s.total_amount                     AS total_value
    FROM tbl_sales s
    JOIN tbl_customer c ON c.cust_uuid = s.customer_uuid
    WHERE s.zodu_id = $1 AND s.branch_id = $2
      AND s.sale_date BETWEEN $3 AND $4
      AND s.sale_type = 'S'
      AND s.cancelled_inv = false
      AND COALESCE(TRIM(c.gst), '') = ''
      AND COALESCE(TRIM(c.state), '') <> ''
      AND LOWER(TRIM(c.state)) <> $5
      AND s.total_amount > $6
      AND ($7::text IS NULL OR s.sale_id ILIKE $7 OR c.cust_name ILIKE $7)
  )`;

async function getGstr1B2CLarge(zodu_id, branch_id, from_date, to_date, branch_state, threshold, search, limit, offset) {
  const params = [zodu_id, branch_id, from_date, to_date, branch_state, threshold, search];

  const [summaryResult, rowsResult] = await Promise.all([
    conn.query(
      `${GSTR1_B2CL_BASE}
       SELECT
         COUNT(*)::int                     AS total_invoices,
         COALESCE(SUM(i.taxable_value), 0) AS total_taxable_value,
         COALESCE(SUM(t.cgst), 0)          AS total_cgst,
         COALESCE(SUM(t.sgst), 0)          AS total_sgst,
         COALESCE(SUM(i.total_value), 0)   AS total_value
       FROM inv i
       LEFT JOIN LATERAL (
         SELECT SUM(si.cgst) AS cgst, SUM(si.sgst) AS sgst
         FROM tbl_sale_items si WHERE si.sale_uuid = i.sale_uuid
       ) t ON true`,
      params
    ),
    conn.query(
      `${GSTR1_B2CL_BASE}
       SELECT
         p.invoice_no,
         TO_CHAR(p.sale_date, 'YYYY-MM-DD') AS invoice_date,
         p.customer_name, p.place_of_supply,
         p.taxable_value, p.total_value,
         COALESCE(t.cgst, 0) AS cgst,
         COALESCE(t.sgst, 0) AS sgst
       FROM (
         SELECT * FROM inv
         ORDER BY sale_date, invoice_no, sale_uuid
         LIMIT $8 OFFSET $9
       ) p
       LEFT JOIN LATERAL (
         SELECT SUM(si.cgst) AS cgst, SUM(si.sgst) AS sgst
         FROM tbl_sale_items si WHERE si.sale_uuid = p.sale_uuid
       ) t ON true
       ORDER BY p.sale_date, p.invoice_no, p.sale_uuid`,
      [...params, limit, offset]
    ),
  ]);

  return { summary: summaryResult.rows[0], rows: rowsResult.rows };
}

// B2C Small = non-cancelled sale invoices to customers without a GSTIN valued at
// Rs 2,50,000 or less. Tax for detail rows is aggregated only after pagination.
const GSTR1_B2CS_BASE = `
  WITH inv AS (
    SELECT
      s.sale_uuid,
      s.sale_id                          AS invoice_no,
      s.sale_date,
      c.cust_name                        AS customer_name,
      c.state                            AS place_of_supply,
      s.subtotal                         AS taxable_value,
      s.total_amount                     AS total_value
    FROM tbl_sales s
    JOIN tbl_customer c ON c.cust_uuid = s.customer_uuid
    WHERE s.zodu_id = $1 AND s.branch_id = $2
      AND s.sale_date BETWEEN $3 AND $4
      AND s.sale_type = 'S'
      AND s.cancelled_inv = false
      AND COALESCE(TRIM(c.gst), '') = ''
      AND s.total_amount <= $5
      AND ($6::text IS NULL OR s.sale_id ILIKE $6 OR c.cust_name ILIKE $6)
  )`;

async function getGstr1B2CSmall(zodu_id, branch_id, from_date, to_date, maxInvoiceValue, search, limit, offset) {
  const params = [zodu_id, branch_id, from_date, to_date, maxInvoiceValue, search];

  const [summaryResult, rowsResult] = await Promise.all([
    conn.query(
      `${GSTR1_B2CS_BASE}
       SELECT
         COUNT(*)::int                     AS total_invoices,
         COALESCE(SUM(i.taxable_value), 0) AS total_taxable_value,
         COALESCE(SUM(t.cgst), 0)          AS total_cgst,
         COALESCE(SUM(t.sgst), 0)          AS total_sgst,
         COALESCE(SUM(i.total_value), 0)   AS total_value
       FROM inv i
       LEFT JOIN LATERAL (
         SELECT SUM(si.cgst) AS cgst, SUM(si.sgst) AS sgst
         FROM tbl_sale_items si WHERE si.sale_uuid = i.sale_uuid
       ) t ON true`,
      params
    ),
    conn.query(
      `${GSTR1_B2CS_BASE}
       SELECT
         p.invoice_no,
         TO_CHAR(p.sale_date, 'YYYY-MM-DD') AS invoice_date,
         p.customer_name, p.place_of_supply,
         p.taxable_value, p.total_value,
         COALESCE(t.cgst, 0) AS cgst,
         COALESCE(t.sgst, 0) AS sgst
       FROM (
         SELECT * FROM inv
         ORDER BY sale_date, invoice_no, sale_uuid
         LIMIT $7 OFFSET $8
       ) p
       LEFT JOIN LATERAL (
         SELECT SUM(si.cgst) AS cgst, SUM(si.sgst) AS sgst
         FROM tbl_sale_items si WHERE si.sale_uuid = p.sale_uuid
       ) t ON true
       ORDER BY p.sale_date, p.invoice_no, p.sale_uuid`,
      [...params, limit, offset]
    ),
  ]);

  return { summary: summaryResult.rows[0], rows: rowsResult.rows };
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
// Outward supplies from the invoice lines in the period (sale invoices, not cancelled), grouped by
// HSN + UQC + GST rate. HSN, unit, rate and tax are the values copied onto the line at billing time,
// so old periods never change when an item is edited later. Taxable value is derived from the stored
// tax (tax * 100 / rate) so it is right for both tax-inclusive and exclusive lines, and for a 0% line it
// is price * qty less the line discount. Lines with no HSN are left out. IGST / cess are not supported yet (same as the other tabs).
const GSTR1_HSN_BASE = `
  WITH lines AS (
    SELECT
      NULLIF(TRIM(si.hsn_code), '')           AS hsn_code,
      ${uqcSql('si.unit')}                    AS uqc,
      COALESCE(si.gst_percentage, 0)          AS gst_rate,
      si.quantity,
      CASE WHEN si.gst_percentage > 0
           THEN si.tax_amount * 100.0 / si.gst_percentage
           ELSE si.price * si.quantity - COALESCE(si.discount, 0)
      END                                     AS taxable_value,
      COALESCE(si.cgst, 0)                    AS cgst,
      COALESCE(si.sgst, 0)                    AS sgst
    FROM tbl_sales s
    JOIN tbl_sale_items si ON si.sale_uuid = s.sale_uuid
    WHERE s.zodu_id = $1 AND s.branch_id = $2
      AND s.sale_date BETWEEN $3 AND $4
      AND s.sale_type = 'S'
      AND s.cancelled_inv = false
      AND NULLIF(TRIM(si.hsn_code), '') IS NOT NULL   -- lines without an HSN are not reported
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


// ── GSTR-1 CDNR / CDNUR (section 9B) ──────────────────────────
// Credit notes = sale returns / credit notes (tbl_sale_returns) raised against non-cancelled
// invoices, placed in the period by the return's own date. CDNR is the ones whose customer has a
// GSTIN; CDNUR the rest (incl. walk-in sales with no customer) — one query shape, one flag.
// note_no is the return id. Taxable value, CGST and SGST are summed from the returned lines
// (older returns stored r.subtotal tax-inclusive, the line amounts are right for every row;
// r.subtotal is only the fallback). IGST / CESS are not supported yet, so 0, same as B2B.
// total_value is the return amount. Place of supply is the state in the customer's shipping
// address ("…, Tamil Nadu, 625874"), else the customer's state; null for a walk-in.
const gstr1NotesSource = (registered) => `
  WITH filtered_notes AS (
    SELECT
      r.return_id                        AS note_no,
      'Credit Note'::text                AS note_type,
      r.return_date                      AS note_date,
      s.sale_id                          AS original_invoice_no,
      s.sale_date                        AS original_invoice_date,
      COALESCE(NULLIF(TRIM(c.cust_name), ''), c.cpy_name) AS customer_name,
      UPPER(TRIM(c.gst))                 AS gstin,
      COALESCE(
        NULLIF(TRIM((regexp_match(c.shipping_address, ',\\s*([^,]+?)\\s*,\\s*\\d{6}\\s*$'))[1]), ''),
        NULLIF(TRIM(c.state), '')
      )                                  AS place_of_supply,
      COALESCE(t.taxable, r.subtotal)    AS taxable_value,
      0::numeric                         AS igst,
      COALESCE(t.cgst, 0)                AS cgst,
      COALESCE(t.sgst, 0)                AS sgst,
      0::numeric                         AS cess,
      r.return_amount                    AS total_value
    FROM tbl_sale_returns r
    JOIN tbl_sales s ON s.sale_uuid = r.original_sale_uuid
    LEFT JOIN tbl_customer c ON c.cust_uuid = s.customer_uuid
    LEFT JOIN LATERAL (
      SELECT SUM(ri.taxable_amount) AS taxable, SUM(ri.cgst) AS cgst, SUM(ri.sgst) AS sgst
      FROM tbl_sale_return_items ri
      WHERE ri.return_uuid = r.return_uuid
    ) t ON true
    WHERE r.zodu_id = $1 AND r.branch_id = $2
      AND r.return_date BETWEEN $3::date AND $4::date
      AND s.cancelled_inv = false
      AND COALESCE(TRIM(c.gst), '') ${registered ? "<>" : "="} ''
      AND ($5::text IS NULL OR UPPER(TRIM(c.gst)) = $5)
      AND (
        $6::text IS NULL
        OR r.return_id ILIKE $6
        OR s.sale_id ILIKE $6
        OR c.cust_name ILIKE $6
        OR c.cpy_name ILIKE $6
        OR c.gst ILIKE $6
      )
  )`;

async function queryGstr1Notes(registered, zodu_id, branch_id, from_date, to_date, gstin, search, limit, offset) {
  const source = gstr1NotesSource(registered);
  const params = [zodu_id, branch_id, from_date, to_date, gstin, search];
  const [summaryResult, rowsResult] = await Promise.all([
    conn.query(
      `${source}
       SELECT
         COUNT(*)::int AS total_notes,
         COALESCE(SUM(total_value), 0)   AS total_credit_note_value,
         COALESCE(SUM(taxable_value), 0) AS total_taxable_value,
         COALESCE(SUM(igst), 0) AS total_igst,
         COALESCE(SUM(cgst), 0) AS total_cgst,
         COALESCE(SUM(sgst), 0) AS total_sgst,
         COALESCE(SUM(cess), 0) AS total_cess,
         COALESCE(SUM(total_value), 0) AS total_note_value
       FROM filtered_notes`,
      params
    ),
    conn.query(
      `${source}
       SELECT
         note_no,
         note_type,
         TO_CHAR(note_date, 'YYYY-MM-DD') AS note_date,
         original_invoice_no,
         TO_CHAR(original_invoice_date, 'YYYY-MM-DD') AS original_invoice_date,
         customer_name,
         gstin,
         place_of_supply,
         taxable_value,
         igst,
         cgst,
         sgst,
         cess,
         total_value
       FROM filtered_notes
       ORDER BY filtered_notes.note_date, note_no
       LIMIT $7 OFFSET $8`,
      [...params, limit, offset]
    ),
  ]);

  return { summary: summaryResult.rows[0], rows: rowsResult.rows };
}

const getGstr1CDNR = (...args) => queryGstr1Notes(true, ...args);
// Unregistered customers have no GSTIN to filter on, so none is passed.
const getGstr1CDNUR = (zodu_id, branch_id, from_date, to_date, search, limit, offset) =>
  queryGstr1Notes(false, zodu_id, branch_id, from_date, to_date, null, search, limit, offset);

module.exports = {
  getGstr1B2CLarge,
  getGstr1B2CSmall,
  getGstr1Hsn,
  getGstr1CDNR,
  getGstr1CDNUR,
  getGstr1B2BGstins,
  getGstr1B2B,
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
