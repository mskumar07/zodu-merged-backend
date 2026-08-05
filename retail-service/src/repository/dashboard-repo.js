const conn = require("../database/connection");

async function getStats(zodu_id, branch_id) {
  const { rows } = await conn.query(
    `WITH
      -- Single scan of tbl_sales: covers total_sales, total_invoices, todays_revenue,
      -- total_due (sales side), total_reminders (sales side), total_due_to_receivable_amount
      sales_agg AS (
        SELECT
          COALESCE(SUM(total_amount), 0)                                                AS total_sales,
          COUNT(*)                                                                      AS total_invoices,
          COALESCE(SUM(CASE WHEN sale_date = CURRENT_DATE THEN total_amount END), 0)   AS todays_revenue,
          COALESCE(SUM(CASE WHEN payment_status IN ('unpaid','partially_paid')
                            THEN balance_amount END), 0)                               AS sales_due_balance,
          COUNT(CASE WHEN payment_status IN ('unpaid','partially_paid') THEN 1 END)    AS sales_due_count,
          COALESCE(SUM(balance_amount), 0)                                             AS total_due_to_receivable_amount
        FROM tbl_sales
        WHERE zodu_id = $1 AND branch_id = $2 AND sale_type != 'Q' AND cancelled_inv = false
      ),

      -- Single scan of tbl_purchase: covers total_due (purchase side),
      -- total_reminders (purchase side), total_due_to_payable_amount (purchase side)
      purchase_agg AS (
        SELECT
          COALESCE(SUM(CASE WHEN payment_status IN ('pending','partial')
                            THEN balance_amount END), 0)                               AS purchase_due_balance,
          COUNT(CASE WHEN payment_status IN ('pending','partial') THEN 1 END)          AS purchase_due_count,
          COALESCE(SUM(balance_amount), 0)                                             AS purchase_payable_balance
        FROM tbl_purchase
        WHERE zodu_id = $1 AND branch_id = $2
      ),

      -- Single scan of tbl_sale_items: covers top_item_name, top_item_sold, total_sold
      sale_items_agg AS (
        SELECT
          si.item_name,
          SUM(si.quantity) AS qty
        FROM tbl_sale_items si
        JOIN tbl_sales s ON s.sale_uuid = si.sale_uuid
        WHERE s.zodu_id = $1 AND s.branch_id = $2 AND s.sale_type != 'Q' AND s.cancelled_inv = false
        GROUP BY si.item_name
      ),
      top_item AS (
        SELECT item_name AS top_item_name, qty AS top_item_sold
        FROM sale_items_agg
        ORDER BY qty DESC
        LIMIT 1
      ),
      items_total AS (
        SELECT COALESCE(SUM(qty), 0) AS total_sold
        FROM sale_items_agg
      ),

      -- Single scan of tbl_inventory: covers out_of_stock_count and total_alerts
      inventory_agg AS (
        SELECT
          COUNT(CASE WHEN available_qty = 0 THEN 1 END)              AS out_of_stock_count,
          COUNT(CASE WHEN available_qty <= reorder_level THEN 1 END) AS total_alerts
        FROM tbl_inventory
        WHERE zodu_id = $1 AND branch_id = $2
      ),

      -- Single scan of tbl_expense: covers total_due_to_payable_amount (expense side)
      expense_agg AS (
        SELECT COALESCE(SUM(balance_amount), 0) AS expense_payable_balance
        FROM tbl_expense
        WHERE zodu_id = $1 AND branch_id = $2
      )

    SELECT
      TRUNC(sa.total_sales)                                                  AS total_sales,
      sa.total_invoices,
      TRUNC(sa.todays_revenue)                                               AS todays_revenue,
      TRUNC(sa.sales_due_balance + pa.purchase_due_balance)                  AS total_due,
      sa.sales_due_count   + pa.purchase_due_count                           AS total_reminders,
      ti.top_item_name,
      ti.top_item_sold,
      it.total_sold,
      ia.out_of_stock_count,
      ia.total_alerts,
      TRUNC(sa.total_due_to_receivable_amount)                               AS total_due_to_receivable_amount,
      TRUNC(ea.expense_payable_balance + pa.purchase_payable_balance)        AS total_due_to_payable_amount
    FROM       sales_agg    sa
    CROSS JOIN purchase_agg pa
    CROSS JOIN top_item      ti
    CROSS JOIN items_total   it
    CROSS JOIN inventory_agg ia
    CROSS JOIN expense_agg   ea`,
    [zodu_id, branch_id]
  );
  return rows[0];
}

async function getSales(zodu_id, branch_id, limit, cursor) {
  const values = [zodu_id, branch_id, limit];
  let where = "s.zodu_id = $1 AND s.branch_id = $2 AND s.sale_type != 'Q' AND s.cancelled_inv = false";

  if (cursor) {
    where += ` AND (
      s.sale_date < $4
      OR (s.sale_date = $4 AND s.sale_time < $5)
      OR (s.sale_date = $4 AND s.sale_time = $5 AND s.sale_uuid < $6::uuid)
    )`;
    values.push(cursor.sale_date, cursor.sale_time, cursor.sale_uuid);
  }

  const { rows } = await conn.query(
    `SELECT
      s.sale_uuid,
      s.sale_id,
      TO_CHAR(s.sale_date, 'DD Mon YYYY') AS sale_date,
      TO_CHAR(s.sale_time, 'HH12:MI AM') AS sale_time,
      s.total_amount,
      s.payment_status,
      COALESCE(c.cust_name, 'Walk-in') AS customer_name
    FROM tbl_sales s
    LEFT JOIN tbl_customer c ON c.cust_uuid = s.customer_uuid
    WHERE ${where}
    ORDER BY s.sale_date DESC, s.sale_time DESC, s.sale_uuid DESC
    LIMIT $3`,
    values
  );
  return rows;
}

async function getTopItems(zodu_id, branch_id, limit, cursor) {
  const values = [zodu_id, branch_id, limit];
  let having = "";

  if (cursor) {
    having = `HAVING (
      SUM(si.quantity) < $4
      OR (SUM(si.quantity) = $4 AND si.item_id > $5)
    )`;
    values.push(cursor.total_sold, cursor.item_id);
  }

  const { rows } = await conn.query(
  `SELECT
    si.item_id,
    si.item_name,
    m.category_id,
    c.name AS category_name,
    SUM(si.quantity)     AS total_sold,
    SUM(si.total_amount) AS total_revenue
  FROM tbl_sale_items si
  JOIN tbl_sales s ON s.sale_uuid = si.sale_uuid
  LEFT JOIN tbl_menu_items m
    ON m.item_id = si.item_id AND m.zodu_id = $1 AND m.branch_id = $2
  LEFT JOIN tbl_category c
    ON c.id = m.category_id AND c.zodu_id = $1 AND c.branch_id = $2
  WHERE s.zodu_id = $1 AND s.branch_id = $2 AND s.sale_type != 'Q' AND s.cancelled_inv = false
  GROUP BY 
    si.item_id, 
    si.item_name, 
    m.category_id,
    c.name
  ${having}
  ORDER BY total_sold DESC, si.item_id ASC
  LIMIT $3`,
    values
  );
  return rows;
}

async function getReminders(zodu_id, branch_id, limit, offset) {
  const values = [zodu_id, branch_id, limit, offset];

  const { rows } = await conn.query(
  `WITH combined AS (

    SELECT
      s.sale_id::varchar                      AS ref_id,
      s.sale_uuid                             AS ref_uuid,
      'SALE'                                  AS ref_type,
      TO_CHAR(s.sale_date, 'DD Mon YYYY')     AS txn_date,
      s.sale_date::date                       AS txn_date_raw,
      s.due_date::date                        AS due_date,
      s.total_amount,
      s.paid_amount,
      s.balance_amount,
      s.payment_status,
      NULL::varchar                           AS transaction_type,
      COALESCE(c.cust_name, 'Walk-in')        AS party_name,
      NULL::varchar                           AS vendor_name
    FROM tbl_sales s
    LEFT JOIN tbl_customer c ON c.cust_uuid = s.customer_uuid
    WHERE s.zodu_id = $1 AND s.branch_id = $2 AND s.sale_type != 'Q' AND s.cancelled_inv = false
      AND s.payment_status IN ('unpaid', 'partially_paid')

    UNION ALL

    SELECT
      p.purchase_id::varchar                                                                AS ref_id,
      NULL::uuid                                                                            AS ref_uuid,
      'PURCHASE'                                                                            AS ref_type,
      TO_CHAR(p.purchase_date, 'DD Mon YYYY')                                              AS txn_date,
      p.purchase_date::date                                                                 AS txn_date_raw,
      COALESCE(MAX(pp.payment_date), p.due_date)::date                                     AS due_date,
      p.total_amount,
      p.paid_amount,
      p.balance_amount,
      p.payment_status,
      STRING_AGG(DISTINCT pp.transaction_type, ', ' ORDER BY pp.transaction_type)          AS transaction_type,
      NULL::varchar                                                                         AS party_name,
      COALESCE(v.vendor_name, 'Unknown Vendor')                                            AS vendor_name
    FROM tbl_purchase p
    LEFT JOIN tbl_purchase_payment pp
      ON pp.purchase_id = p.purchase_id
     AND pp.zodu_id = $1 AND pp.branch_id = $2
    LEFT JOIN tbl_vendor v ON v.vendor_id = p.vendor_id AND v.zodu_id = $1 AND v.branch_id = $2
    WHERE p.zodu_id = $1 AND p.branch_id = $2
      AND p.payment_status IN ('pending', 'partial')
    GROUP BY p.purchase_id, p.purchase_date, p.due_date, p.total_amount, p.paid_amount,
             p.balance_amount, p.payment_status, v.vendor_name

    UNION ALL

    SELECT
      e.expense_id                                   AS ref_id,
      NULL::uuid                                     AS ref_uuid,
      'EXPENSE'                                      AS ref_type,
      TO_CHAR(e.expense_date, 'DD Mon YYYY')         AS txn_date,
      e.expense_date::date                           AS txn_date_raw,
      e.due_date::date                               AS due_date,
      e.total_amount,
      e.paid_amount,
      e.balance_amount,
      e.payment_status,
      NULL::varchar                                  AS transaction_type,
      c.name                                         AS party_name,
      NULL::varchar                                  AS vendor_name
    FROM tbl_expense e
    LEFT JOIN tbl_category c ON c.id = e.category_id AND c.zodu_id = $1 AND c.branch_id = $2
    WHERE e.zodu_id = $1 AND e.branch_id = $2
      AND e.payment_status IN ('pending', 'partial')

  )
  SELECT
    ref_id,
    ref_type,
    txn_date,
    TO_CHAR(due_date, 'DD Mon YYYY') AS due_date,
    total_amount,
    paid_amount,
    balance_amount,
    payment_status,
    transaction_type,
    party_name,
    vendor_name,
    COUNT(*) OVER() AS total_count
  FROM combined
  ORDER BY due_date ASC NULLS FIRST, txn_date_raw ASC, ref_id ASC
  LIMIT $3 OFFSET $4`,
  values
);
  return rows;
}

async function getInventoryAlerts(zodu_id, branch_id, limit, cursor) {
  const values = [zodu_id, branch_id, limit];
  let where = `i.zodu_id = $1 AND i.branch_id = $2
    AND i.available_qty <= i.reorder_level`;

  if (cursor) {
    where += ` AND (
      i.available_qty > $4
      OR (i.available_qty = $4 AND i.item_uuid > $5::uuid)
    )`;
    values.push(cursor.available_qty, cursor.item_uuid);
  }

  const { rows } = await conn.query(
    `SELECT
      i.inventory_uuid,
      i.item_uuid,
      i.item_id,
      i.item_name,
      c.name AS category_name,
      i.available_qty,
      i.reorder_level,
      i.last_stock_update,
      CASE
        WHEN i.available_qty <= 0 THEN 'Out of Stock'
        ELSE                          'Low Stock'
      END AS stock_status
    FROM tbl_inventory i
    LEFT JOIN tbl_menu_items m
      ON m.item_uuid = i.item_uuid AND m.zodu_id = $1 AND m.branch_id = $2
    LEFT JOIN tbl_category c
      ON c.id = m.category_id AND c.zodu_id = $1 AND c.branch_id = $2
    WHERE ${where}
    ORDER BY i.available_qty ASC, i.item_uuid ASC
    LIMIT $3`,
    values
  );
  return rows;
}

module.exports = {
  getStats,
  getSales,
  getTopItems,
  getReminders,
  getInventoryAlerts,
};