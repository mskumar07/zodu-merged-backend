const conn = require("../database/connection");

// ── Summary Cards ─────────────────────────────────────────────
async function getSalesSummary(zodu_id, branch_id, year) {
  const { rows } = await conn.query(
    `WITH yearly AS (
      SELECT
        COALESCE(SUM(total_amount), 0) AS total_yearly_sales
      FROM tbl_sales
      WHERE zodu_id = $1 AND branch_id = $2
        AND EXTRACT(YEAR FROM sale_date) = $3
    ),
    monthly AS (
      SELECT
        COALESCE(SUM(total_amount), 0) AS total_monthly_sales
      FROM tbl_sales
      WHERE zodu_id = $1 AND branch_id = $2
        AND EXTRACT(YEAR FROM sale_date)  = $3
        AND EXTRACT(MONTH FROM sale_date) = EXTRACT(MONTH FROM CURRENT_DATE)
    ),
    last_year AS (
      SELECT
        COALESCE(SUM(total_amount), 0) AS total_last_year
      FROM tbl_sales
      WHERE zodu_id = $1 AND branch_id = $2
        AND EXTRACT(YEAR FROM sale_date) = $3 - 1
    ),
    top_month AS (
      SELECT
        TO_CHAR(TO_DATE(EXTRACT(MONTH FROM sale_date)::text, 'MM'), 'Month') AS top_month_name,
        SUM(total_amount) AS month_total
      FROM tbl_sales
      WHERE zodu_id = $1 AND branch_id = $2
        AND EXTRACT(YEAR FROM sale_date) = $3
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
    FROM yearly y, monthly m, last_year l, top_month t`,
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
         AND EXTRACT(YEAR FROM sale_date) = $3
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
      AND EXTRACT(YEAR FROM sale_date) = $3
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
        COALESCE(SUM(total_amount), 0) AS total_sales,
        COALESCE(SUM(total_tax),    0) AS total_tax,
        COALESCE(SUM(subtotal),     0) AS total_subtotal
      FROM tbl_sales
      WHERE zodu_id = $1 AND branch_id = $2
        AND sale_date BETWEEN $3 AND $4
    ),
    prev_period AS (
      SELECT COALESCE(SUM(total_amount), 0) AS prev_total
      FROM tbl_sales
      WHERE zodu_id = $1 AND branch_id = $2
        AND sale_date BETWEEN $5 AND $6
    ),
    best_cat AS (
      SELECT c.name AS cat_name, SUM(si.total_amount) AS cat_sales
      FROM tbl_sale_items si
      JOIN tbl_sales s ON s.sale_uuid = si.sale_uuid
      LEFT JOIN tbl_menu_items m
        ON m.item_id = si.item_id AND m.zodu_id = $1 AND m.branch_id = $2
      LEFT JOIN tbl_category c
        ON c.id = m.category_id AND c.zodu_id = $1
      WHERE s.zodu_id = $1 AND s.branch_id = $2
        AND s.sale_date BETWEEN $3 AND $4
      GROUP BY c.id, c.name
      ORDER BY cat_sales DESC
      LIMIT 1
    ),
    best_item AS (
      SELECT si.item_name, SUM(si.quantity)::int AS units_sold
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
        SUM(si.quantity)::int                          AS total_units,
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
       SUM(si.quantity)::int                                           AS qty,
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

module.exports = {
  getSalesSummary,
  getMonthlyBreakdown,
  getHistoricalPerformance,
  getCategoryItemSalesSummary,
  getCategoryWiseSales,
  getItemWiseSales,
  getSalesVelocity,
};
