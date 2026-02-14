const conn = require('../database/connection');


exports.getDashboardSummary = async (zodu_id, branch_id, dateFilter) => {
  const {
    orderDateCondition,
    expenseDateCondition,
    paymentDateCondition
  } = buildDateConditions(dateFilter);

  const query = `
    SELECT
      (SELECT COUNT(*) 
       FROM tbl_orders o
       WHERE o.zodu_id=$1 AND o.branch_id=$2 AND o.final_payment=true ${orderDateCondition}
      ) AS total_orders,

      (SELECT COALESCE(SUM(o.total_amt),0) 
       FROM tbl_orders o
       WHERE o.zodu_id=$1 AND o.branch_id=$2 AND o.final_payment=true ${orderDateCondition}
      ) AS total_sales,

      (SELECT COALESCE(SUM(p.total_amount),0) 
       FROM tbl_payment p
       WHERE p.zodu_id=$1 AND p.branch_id=$2 
       AND p.source_type='expense' ${paymentDateCondition}
      ) AS total_expense,

      (SELECT COUNT(*) 
       FROM tbl_inventory 
       WHERE zodu_id=$1 AND branch_id=$2 
       AND stock_qty <= stock_alert
      ) AS low_stocks
  `;

  const res = await conn.query(query, [zodu_id, branch_id]);
  return res.rows[0];
};

exports.getDashboardOrders = async (
  zodu_id,
  branch_id,
  { limit, offset },
  sortOrder,
  dateFilter
) => {
  const order = sortOrder === "asc" ? "ASC" : "DESC";
  const { orderDateCondition } = buildDateConditions(dateFilter);

  const dataQuery = `
    SELECT 
      o.public_order_no,            -- user-visible order number
      o.api_order_id,               -- internal reference (optional for FE)
      o.total_amt,
      o.no_of_items,
      COALESCE(SUM(oi.qty), 0) AS total_qty,
      o.order_type,
      TO_CHAR(
        o.created_at,
        'DD Mon YYYY, HH12:MI AM (Dy)'
      ) AS formatted_date
    FROM tbl_orders o
    LEFT JOIN tbl_ordered_items oi
      ON oi.api_order_id = o.api_order_id
    WHERE o.zodu_id = $1
      AND o.branch_id = $2
      AND o.final_payment = true
      ${orderDateCondition}
    GROUP BY 
      o.api_order_id,
      o.public_order_no,
      o.total_amt,
      o.no_of_items,
      o.order_type,
      o.created_at
    ORDER BY o.created_at ${order}
    LIMIT $3 OFFSET $4
  `;

  const countQuery = `
    SELECT COUNT(*)
    FROM tbl_orders o
    WHERE o.zodu_id = $1
      AND o.branch_id = $2
      AND o.final_payment = true
      ${orderDateCondition}
  `;

  const [dataRes, countRes] = await Promise.all([
    conn.query(dataQuery, [zodu_id, branch_id, limit, offset]),
    conn.query(countQuery, [zodu_id, branch_id])
  ]);

  return {
    rows: dataRes.rows,
    count: Number(countRes.rows[0].count)
  };
};



exports.getDashboardTopItems = async (
  zodu_id,
  branch_id,
  { limit, offset },
  dateFilter
) => {
  const { orderDateCondition } = buildDateConditions(dateFilter);

  const query = `
    SELECT 
      m.menu_name,
      c.name AS category_name,
      u.short_name AS unit,
      SUM(i.qty) AS total_qty,
      SUM(i.qty * i.price) AS total_amount
    FROM tbl_ordered_items i
    JOIN tbl_orders o ON o.order_id = i.order_id
    JOIN tbl_menu_item m ON m.menu_id = i.item_id
    LEFT JOIN tbl_category c ON c.id = m.menu_category_id
    LEFT JOIN tbl_units u ON u.id = m.menu_unit
    WHERE o.zodu_id=$1 AND o.branch_id=$2
      ${orderDateCondition}
    GROUP BY m.menu_name, c.name, u.short_name
    ORDER BY total_qty DESC
    LIMIT $3 OFFSET $4
  `;

  const countQuery = `
    SELECT COUNT(DISTINCT i.item_id)
    FROM tbl_ordered_items i
    JOIN tbl_orders o ON o.order_id=i.order_id
    WHERE o.zodu_id=$1 AND o.branch_id=$2
      ${orderDateCondition}
  `;

  const [dataRes, countRes] = await Promise.all([
    conn.query(query, [zodu_id, branch_id, limit, offset]),
    conn.query(countQuery, [zodu_id, branch_id])
  ]);

  return {
    rows: dataRes.rows,
    count: Number(countRes.rows[0].count)
  };
};


exports.getDashboardDatewiseSales = async (
  zodu_id,
  branch_id,
  { limit, offset }
) => {
 const query = `
  SELECT 
  TO_CHAR(created_at::date, 'DD Mon YYYY (Dy)') AS formatted_date,
  COUNT(order_id) AS total_orders,
  COALESCE(SUM(total_amt), 0) AS total_amount
FROM tbl_orders
WHERE zodu_id = $1 AND branch_id = $2
GROUP BY created_at::date
ORDER BY created_at::date DESC
LIMIT $3 OFFSET $4;

`;

  const countQuery = `
    SELECT COUNT(DISTINCT created_at::date)
    FROM tbl_orders
    WHERE zodu_id=$1 AND branch_id=$2
  `;

  const [dataRes, countRes] = await Promise.all([
    conn.query(query, [zodu_id, branch_id, limit, offset]),
    conn.query(countQuery, [zodu_id, branch_id])
  ]);

  return {
    rows: dataRes.rows,
    count: Number(countRes.rows[0].count)
  };
};


exports.getDashboardExpenses = async (
  zodu_id,
  branch_id,
  { limit, offset },
  sortOrder,
  dateFilter
) => {
  const order = sortOrder === "asc" ? "ASC" : "DESC";
  const { expenseDateCondition } = buildDateConditions(dateFilter);

  const query = `
    SELECT 
      e.expense_id,
      c.category_name,
      COALESCE(p.total_amount,0) AS total_amount,
      COALESCE(p.paid_amount,0) AS paid_amount,
      (COALESCE(p.total_amount,0)-COALESCE(p.paid_amount,0)) AS due_amount,
      COUNT(i.id) AS item_count,
      e.updated_at
    FROM tbl_expense e
    LEFT JOIN tbl_expense_category c ON c.id=e.category_id
    LEFT JOIN tbl_payment p 
      ON p.source_id=e.expense_id AND p.source_type='expense'
    LEFT JOIN tbl_expense_items i ON i.expense_id=e.expense_id
    WHERE e.zodu_id=$1 AND e.branch_id=$2
      ${expenseDateCondition}
    GROUP BY e.expense_id, c.category_name, p.total_amount, p.paid_amount, e.updated_at
    ORDER BY e.updated_at ${order}
    LIMIT $3 OFFSET $4
  `;

  const countQuery = `
    SELECT COUNT(*)
    FROM tbl_expense e
    WHERE e.zodu_id=$1 AND e.branch_id=$2
      ${expenseDateCondition}
  `;

  const [dataRes, countRes] = await Promise.all([
    conn.query(query, [zodu_id, branch_id, limit, offset]),
    conn.query(countQuery, [zodu_id, branch_id])
  ]);

  return {
    rows: dataRes.rows,
    count: Number(countRes.rows[0].count)
  };
};


const buildDateConditions = (dateFilter) => {
  let orderDateCondition = "";
  let expenseDateCondition = "";
  let paymentDateCondition = "";

  if (!dateFilter || dateFilter.dateType === "today") {
    orderDateCondition = `AND o.created_at::date = CURRENT_DATE`;
    expenseDateCondition = `AND e.updated_at::date = CURRENT_DATE`;
    paymentDateCondition = `AND p.updated_at::date = CURRENT_DATE`;
  }

  else if (dateFilter?.dateType === "yesterday") {
    orderDateCondition = `AND o.created_at::date = CURRENT_DATE - INTERVAL '1 day'`;
    expenseDateCondition = `AND e.updated_at::date = CURRENT_DATE - INTERVAL '1 day'`;
    paymentDateCondition = `AND p.updated_at::date = CURRENT_DATE - INTERVAL '1 day'`;
  }

  else if (dateFilter?.dateType === "thisWeek") {
    orderDateCondition = `AND o.created_at::date >= date_trunc('week', CURRENT_DATE)`;
    expenseDateCondition = `AND e.updated_at::date >= date_trunc('week', CURRENT_DATE)`;
    paymentDateCondition = `AND p.updated_at::date >= date_trunc('week', CURRENT_DATE)`;
  }

  else if (dateFilter?.dateType === "last7Days") {
    orderDateCondition = `AND o.created_at >= CURRENT_DATE - INTERVAL '7 days'`;
    expenseDateCondition = `AND e.updated_at::date >= CURRENT_DATE - INTERVAL '7 days'`;
    paymentDateCondition = `AND p.updated_at::date >= CURRENT_DATE - INTERVAL '7 days'`;
  }

  else if (dateFilter?.dateType === "last14Days") {
    orderDateCondition = `AND o.created_at >= CURRENT_DATE - INTERVAL '14 days'`;
    expenseDateCondition = `AND e.updated_at::date >= CURRENT_DATE - INTERVAL '14 days'`;
    paymentDateCondition = `AND p.updated_at::date >= CURRENT_DATE - INTERVAL '14 days'`;
  }

  else if (dateFilter?.dateType === "last30Days") {
    orderDateCondition = `AND o.created_at >= CURRENT_DATE - INTERVAL '30 days'`;
    expenseDateCondition = `AND e.updated_at::date >= CURRENT_DATE - INTERVAL '30 days'`;
    paymentDateCondition = `AND p.updated_at::date >= CURRENT_DATE - INTERVAL '30 days'`;
  }

  else if (dateFilter?.dateType === "thisMonth") {
    orderDateCondition = `AND o.created_at >= date_trunc('month', CURRENT_DATE)`;
    expenseDateCondition = `AND e.updated_at::date >= date_trunc('month', CURRENT_DATE)`;
    paymentDateCondition = `AND p.updated_at::date >= date_trunc('month', CURRENT_DATE)`;
  }

  else if (dateFilter?.dateType === "lastMonth") {
    orderDateCondition = `
      AND o.created_at >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month')
      AND o.created_at < date_trunc('month', CURRENT_DATE)
    `;
    expenseDateCondition = `
      AND e.updated_at::date >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month')
      AND e.updated_at::date < date_trunc('month', CURRENT_DATE)
    `;
    paymentDateCondition = `
      AND p.updated_at::date >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month')
      AND p.updated_at::date < date_trunc('month', CURRENT_DATE)
    `;
  }

  else if (dateFilter?.dateType === "thisQuarter") {
    orderDateCondition = `AND o.created_at >= date_trunc('quarter', CURRENT_DATE)`;
    expenseDateCondition = `AND e.updated_at::date >= date_trunc('quarter', CURRENT_DATE)`;
    paymentDateCondition = `AND p.updated_at::date >= date_trunc('quarter', CURRENT_DATE)`;
  }

  else if (dateFilter?.dateType === "lastQuarter") {
    orderDateCondition = `
      AND o.created_at >= date_trunc('quarter', CURRENT_DATE - INTERVAL '3 month')
      AND o.created_at < date_trunc('quarter', CURRENT_DATE)
    `;
    expenseDateCondition = `
      AND e.updated_at::date >= date_trunc('quarter', CURRENT_DATE - INTERVAL '3 month')
      AND e.updated_at::date < date_trunc('quarter', CURRENT_DATE)
    `;
    paymentDateCondition = `
      AND p.updated_at::date >= date_trunc('quarter', CURRENT_DATE - INTERVAL '3 month')
      AND p.updated_at::date < date_trunc('quarter', CURRENT_DATE)
    `;
  }

  else if (dateFilter?.dateType === "custom" && dateFilter.fromDate && dateFilter.toDate) {
    orderDateCondition = `AND o.created_at::date BETWEEN '${dateFilter.fromDate}' AND '${dateFilter.toDate}'`;
    expenseDateCondition = `AND e.updated_at::date BETWEEN '${dateFilter.fromDate}' AND '${dateFilter.toDate}'`;
    paymentDateCondition = `AND p.updated_at::date BETWEEN '${dateFilter.fromDate}' AND '${dateFilter.toDate}'`;
  }
  // reuse your existing else-if blocks here exactly

  return {
    orderDateCondition,
    expenseDateCondition,
    paymentDateCondition
  };
};
