const conn = require("../database/connection");

async function getStats(zodu_id, branch_id) {
  const { rows } = await conn.query(
    `SELECT
      COALESCE(SUM(total_amount), 0)                                              AS total_sales,
      COUNT(*)                                                                    AS total_invoices,
      COALESCE(SUM(CASE WHEN sale_date = CURRENT_DATE THEN total_amount END), 0) AS todays_revenue,
      (
        SELECT COALESCE(SUM(balance_amount), 0)
        FROM tbl_sales
        WHERE zodu_id = $1 AND branch_id = $2 AND sale_type != 'Q'
          AND payment_status IN ('unpaid', 'partially_paid')
      ) + (
        SELECT COALESCE(SUM(balance_amount), 0)
        FROM tbl_purchase
        WHERE zodu_id = $1 AND branch_id = $2
          AND payment_status IN ('pending', 'partial')
      )                                                                           AS total_due,
      (
        SELECT COUNT(*)
        FROM tbl_sales
        WHERE zodu_id = $1 AND branch_id = $2 AND sale_type != 'Q'
          AND payment_status IN ('unpaid', 'partially_paid')
      ) + (
        SELECT COUNT(*)
        FROM tbl_purchase
        WHERE zodu_id = $1 AND branch_id = $2
          AND payment_status IN ('pending', 'partial')
      )                                                                           AS total_reminders,
      (
        SELECT si.item_name
        FROM tbl_sale_items si
        JOIN tbl_sales s ON s.sale_uuid = si.sale_uuid
        WHERE s.zodu_id = $1 AND s.branch_id = $2
        GROUP BY si.item_name
        ORDER BY SUM(si.quantity) DESC
        LIMIT 1
      )                                                                           AS top_item_name,
      (
        SELECT SUM(si.quantity)
        FROM tbl_sale_items si
        JOIN tbl_sales s ON s.sale_uuid = si.sale_uuid
        WHERE s.zodu_id = $1 AND s.branch_id = $2
        GROUP BY si.item_name
        ORDER BY SUM(si.quantity) DESC
        LIMIT 1
      )                                                                           AS top_item_sold,
      (
        SELECT COALESCE(SUM(si.quantity), 0)
        FROM tbl_sale_items si
        JOIN tbl_sales s ON s.sale_uuid = si.sale_uuid
        WHERE s.zodu_id = $1 AND s.branch_id = $2
      )                                                                           AS total_sold,
      (
        SELECT COUNT(*) FROM tbl_inventory
        WHERE zodu_id = $1 AND branch_id = $2
          AND available_qty = 0
      )                                                                           AS out_of_stock_count,
      (
        SELECT COUNT(*) FROM tbl_inventory
        WHERE zodu_id = $1 AND branch_id = $2
          AND available_qty <= reorder_level
      )                                                                           AS total_alerts
    FROM tbl_sales
    WHERE zodu_id = $1 AND branch_id = $2 AND sale_type != 'Q'`,
    [zodu_id, branch_id]
  );
  return rows[0];
}

async function getSales(zodu_id, branch_id, limit, cursor) {
  const values = [zodu_id, branch_id, limit];
  let where = "s.zodu_id = $1 AND s.branch_id = $2 AND s.sale_type != 'Q'";

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
  WHERE s.zodu_id = $1 AND s.branch_id = $2
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

async function getReminders(zodu_id, branch_id, limit, cursor) {
  const values = [zodu_id, branch_id, limit];
  let cursorClause = "";

  if (cursor) {
    cursorClause = `AND (
      due_date > $4
      OR (due_date = $4 AND ref_type > $6)
      OR (due_date = $4 AND ref_type = $6 AND ref_id > $5)
    )`;
    values.push(cursor.due_date, cursor.ref_id, cursor.ref_type);
  }

  const { rows } = await conn.query(
  `SELECT
    ref_id,
    ref_type,
    txn_date,
    TO_CHAR(due_date, 'DD Mon YYYY') AS due_date,   -- format for display
    total_amount,
    paid_amount,
    balance_amount,
    payment_status,
    transaction_type,
    party_name,
    vendor_name
  FROM (

    SELECT
      s.sale_id::varchar                      AS ref_id,
      s.sale_uuid                             AS ref_uuid,
      'SALE'                                  AS ref_type,
      TO_CHAR(s.sale_date, 'DD Mon YYYY')     AS txn_date,
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
    WHERE s.zodu_id = $1 AND s.branch_id = $2 AND s.sale_type != 'Q'
      AND s.payment_status IN ('unpaid', 'partially_paid')

    UNION ALL

    SELECT
      p.purchase_id::varchar                                                                AS ref_id,
      NULL::uuid                                                                            AS ref_uuid,
      'PURCHASE'                                                                            AS ref_type,
      TO_CHAR(p.purchase_date, 'DD Mon YYYY')                                              AS txn_date,
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

  ) combined
  WHERE 1=1 ${cursorClause}
  ORDER BY due_date ASC NULLS LAST, ref_type ASC, ref_id ASC
  LIMIT $3`,
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
        WHEN i.available_qty = 0                      THEN 'out'
        WHEN i.available_qty <= i.reorder_level * 0.5 THEN 'critical'
        ELSE                                               'low'
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