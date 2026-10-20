const conn = require("../database/connection");

// ── Accounting ledger (day book) ──────────────────────────────
// One chronological list of every money movement in the branch. Each source table contributes
// rows of the same shape through a UNION ALL, then a window function turns them into a running
// balance. Convention (cash-book style):
//   Credit = value coming IN  : Sales, Receipt, Purchase Return, Debit Note
//   Debit  = value going OUT  : Purchase, Payment, Expense, Sales Return, Credit Note
//   balance = running SUM(credit - debit) over the WHOLE ledger up to that row, so a filtered
//   view (dates / type / search) still shows the true balance. Cr when >= 0, Dr when < 0.
//
// Receipts and Payments settle invoices that are already counted by Sales / Purchase, so they
// move the balance only while SETTLEMENTS_AFFECT_BALANCE is true. Flip it to false to keep the
// balance a pure sales - purchases - expenses - returns position.
const SETTLEMENTS_AFFECT_BALANCE = true;

// Row timestamp = the document's own date + time. Tables that store only a date borrow the
// time of day from created_at; a payment saved without a payment_date uses its created_at date.
const LEDGER_CTE = `
  WITH ledger AS (
    SELECT 'Sales'::text AS type, 'S:' || s.sale_uuid AS id,
           (s.sale_date + s.sale_time) AS ts, s.sale_id AS reference, s.sale_id AS ref_key,
           COALESCE(NULLIF(TRIM(c.cust_name), ''), c.cpy_name, 'Walk-In Customer') AS party,
           NULL::text AS payment_type, NULL::numeric AS debit, s.total_amount AS credit
      FROM tbl_sales s
      LEFT JOIN tbl_customer c ON c.cust_uuid = s.customer_uuid
     WHERE s.zodu_id = $1 AND s.branch_id = $2 AND s.sale_type = 'S' AND s.cancelled_inv = false

    UNION ALL
    SELECT 'Receipt', 'R:' || p.id,
           (COALESCE(p.payment_date, p.created_at::date) + p.created_at::time), s.sale_id, s.sale_id,
           COALESCE(NULLIF(TRIM(c.cust_name), ''), c.cpy_name, 'Walk-In Customer'),
           COALESCE(p.transaction_type, 'Cash'), NULL::numeric, p.paid_amount
      FROM tbl_sale_payment p
      JOIN tbl_sales s ON s.sale_id = p.sale_id AND s.zodu_id = p.zodu_id AND s.branch_id = p.branch_id
                      AND s.sale_type = 'S' AND s.cancelled_inv = false
      LEFT JOIN tbl_customer c ON c.cust_uuid = s.customer_uuid
     WHERE p.zodu_id = $1 AND p.branch_id = $2

    UNION ALL
    SELECT 'Purchase', 'P:' || pu.id,
           (pu.purchase_date + pu.created_at::time), pu.purchase_id, pu.purchase_id,
           COALESCE(v.vendor_name, v.company_name, '-'),
           NULL::text, pu.total_amount, NULL::numeric
      FROM tbl_purchase pu
      LEFT JOIN tbl_vendor v ON v.vendor_id = pu.vendor_id AND v.zodu_id = pu.zodu_id AND v.branch_id = pu.branch_id
     WHERE pu.zodu_id = $1 AND pu.branch_id = $2 AND pu.cancelled_purchase = false

    UNION ALL
    SELECT 'Payment', 'PP:' || pp.id,
           (COALESCE(pp.payment_date, pp.created_at::date) + pp.created_at::time), pu.purchase_id, pu.purchase_id,
           COALESCE(v.vendor_name, v.company_name, '-'),
           COALESCE(pp.transaction_type, 'Cash'), pp.paid_amount, NULL::numeric
      FROM tbl_purchase_payment pp
      JOIN tbl_purchase pu ON pu.purchase_id = pp.purchase_id AND pu.zodu_id = pp.zodu_id
                          AND pu.branch_id = pp.branch_id AND pu.cancelled_purchase = false
      LEFT JOIN tbl_vendor v ON v.vendor_id = pu.vendor_id AND v.zodu_id = pu.zodu_id AND v.branch_id = pu.branch_id
     WHERE pp.zodu_id = $1 AND pp.branch_id = $2

    UNION ALL
    SELECT 'Expense', 'E:' || e.id,
           (e.expense_date + (e.created_at AT TIME ZONE 'Asia/Kolkata')::time), e.expense_id, e.expense_id,
           COALESCE(cat.name, '-'),
           NULL::text, e.total_amount, NULL::numeric
      FROM tbl_expense e
      LEFT JOIN tbl_category cat ON cat.id = e.category_id
     WHERE e.zodu_id = $1 AND e.branch_id = $2

    UNION ALL
    SELECT CASE r.return_type WHEN 'CREDIT_NOTE' THEN 'Credit Note' ELSE 'Sales Return' END,
           'SR:' || r.return_uuid,
           (r.return_date + r.return_time), r.return_id, r.return_id,
           COALESCE(NULLIF(TRIM(c.cust_name), ''), c.cpy_name, 'Walk-In Customer'),
           COALESCE(r.refund_type, 'Credit'), r.return_amount, NULL::numeric
      FROM tbl_sale_returns r
      LEFT JOIN tbl_sales s ON s.sale_uuid = r.original_sale_uuid
      LEFT JOIN tbl_customer c ON c.cust_uuid = s.customer_uuid
     WHERE r.zodu_id = $1 AND r.branch_id = $2

    UNION ALL
    SELECT CASE r.return_type WHEN 'DEBIT_NOTE' THEN 'Debit Note' ELSE 'Purchase Return' END,
           'PR:' || r.return_uuid,
           (r.return_date + r.created_at::time), r.return_id, r.return_id,
           COALESCE(v.vendor_name, v.company_name, '-'),
           COALESCE(r.refund_type, 'Credit'), NULL::numeric, r.return_amount
      FROM tbl_purchase_returns r
      LEFT JOIN tbl_purchase pu ON pu.purchase_id = r.original_purchase_id AND pu.zodu_id = r.zodu_id AND pu.branch_id = r.branch_id
      LEFT JOIN tbl_vendor v ON v.vendor_id = pu.vendor_id AND v.zodu_id = pu.zodu_id AND v.branch_id = pu.branch_id
     WHERE r.zodu_id = $1 AND r.branch_id = $2
  ),
  running AS (
    SELECT l.*,
           SUM(
             CASE WHEN l.type IN ('Receipt', 'Payment') AND NOT ${SETTLEMENTS_AFFECT_BALANCE} THEN 0
                  ELSE COALESCE(l.credit, 0) - COALESCE(l.debit, 0) END
           ) OVER (ORDER BY l.ts, l.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS balance
      FROM ledger l
  )`;

// Filters shared by the page query and the count. Type is a list of ledger types.
function buildFilters({ from_date, to_date, types, search }) {
  const conditions = [];
  const values = [];
  let idx = 3; // $1 zodu_id, $2 branch_id
  if (from_date) { conditions.push(`ts::date >= $${idx++}`); values.push(from_date); }
  if (to_date)   { conditions.push(`ts::date <= $${idx++}`); values.push(to_date); }
  if (types?.length) { conditions.push(`type = ANY($${idx++})`); values.push(types); }
  if (search) {
    conditions.push(`(reference ILIKE $${idx} OR party ILIKE $${idx})`);
    values.push(`%${search}%`);
    idx++;
  }
  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values, nextIdx: idx };
}

// How a Sales / Purchase / Expense row was paid: the distinct modes of its payments, or Credit
// when nothing has been paid. Looked up for the page's rows only.
async function paymentModes(table, keyColumn, zodu_id, branch_id, keys) {
  if (!keys.length) return new Map();
  const { rows } = await conn.query(
    `SELECT ${keyColumn} AS k, string_agg(DISTINCT COALESCE(transaction_type, 'Cash'), ', ') AS modes
       FROM ${table}
      WHERE zodu_id = $1 AND branch_id = $2 AND ${keyColumn} = ANY($3)
      GROUP BY ${keyColumn}`,
    [zodu_id, branch_id, keys]
  );
  return new Map(rows.map((r) => [r.k, r.modes]));
}

exports.getAccountingEntries = async (zodu_id, branch_id, filters, limit, offset) => {
  const { where, values, nextIdx } = buildFilters(filters);
  const params = [zodu_id, branch_id, ...values];

  const [countResult, pageResult] = await Promise.all([
    conn.query(`${LEDGER_CTE} SELECT COUNT(*)::int AS total FROM running ${where}`, params),
    conn.query(
      `${LEDGER_CTE}
       SELECT id, TO_CHAR(ts, 'YYYY-MM-DD"T"HH24:MI:SS') AS date_time, type, reference, ref_key,
              party, payment_type, debit, credit, balance
         FROM running
         ${where}
        ORDER BY ts DESC, id DESC
        LIMIT $${nextIdx} OFFSET $${nextIdx + 1}`,
      [...params, limit, offset]
    ),
  ]);

  const rows = pageResult.rows;
  const keysOf = (type) => rows.filter((r) => r.type === type).map((r) => r.ref_key);
  const [saleModes, purchaseModes, expenseModes] = await Promise.all([
    paymentModes("tbl_sale_payment", "sale_id", zodu_id, branch_id, keysOf("Sales")),
    paymentModes("tbl_purchase_payment", "purchase_id", zodu_id, branch_id, keysOf("Purchase")),
    paymentModes("tbl_expense_payment", "expense_id", zodu_id, branch_id, keysOf("Expense")),
  ]);
  const modesByType = { Sales: saleModes, Purchase: purchaseModes, Expense: expenseModes };
  for (const r of rows) {
    if (!r.payment_type) r.payment_type = modesByType[r.type]?.get(r.ref_key) ?? "Credit";
  }

  return { total: countResult.rows[0].total, rows };
};

// Cards for the selected period: amount + count per kind (type and search do not narrow them).
exports.getAccountingSummary = async (zodu_id, branch_id, { from_date, to_date }) => {
  const { where, values } = buildFilters({ from_date, to_date });
  const { rows } = await conn.query(
    `${LEDGER_CTE}
     SELECT
       COALESCE(SUM(credit) FILTER (WHERE type = 'Sales'),    0) AS sales_amount,    COUNT(*) FILTER (WHERE type = 'Sales')    AS sales_count,
       COALESCE(SUM(debit)  FILTER (WHERE type = 'Purchase'), 0) AS purchases_amount, COUNT(*) FILTER (WHERE type = 'Purchase') AS purchases_count,
       COALESCE(SUM(debit)  FILTER (WHERE type = 'Payment'),  0) AS payments_amount,  COUNT(*) FILTER (WHERE type = 'Payment')  AS payments_count,
       COALESCE(SUM(credit) FILTER (WHERE type = 'Receipt'),  0) AS receipts_amount,  COUNT(*) FILTER (WHERE type = 'Receipt')  AS receipts_count,
       COALESCE(SUM(debit)  FILTER (WHERE type = 'Expense'),  0) AS expenses_amount,  COUNT(*) FILTER (WHERE type = 'Expense')  AS expenses_count
       FROM ledger
       ${where}`,
    [zodu_id, branch_id, ...values]
  );
  return rows[0];
};
