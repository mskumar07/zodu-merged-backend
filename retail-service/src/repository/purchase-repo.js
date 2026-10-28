const conn = require("../database/connection");

exports.createPurchase = async (client, data) => {
  const { rows } = await client.query(
    `INSERT INTO tbl_purchase (
      purchase_id, zodu_id, branch_id,
      purchase_date, vendor_id,
      total_amount, paid_amount,
      payment_status, notes, attachment_url,due_date,invoice_bill_no
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    RETURNING *`,
    [
      data.purchase_id,
      data.zodu_id,
      data.branch_id,
      data.purchase_date,
      data.vendor_id || null,
      data.total_amount,
      data.paid_amount || 0,
      data.payment_status || "pending",
      data.notes || null,
      data.attachment_url ? JSON.stringify(data.attachment_url) : null,
      data.due_date || null,
      data.invoice_bill_no || null,
    ]
  );
  return rows[0];
};

exports.createPurchaseItems = async (client, items, purchase_id, zodu_id) => {
  for (const item of items) {
    await client.query(
      `INSERT INTO tbl_purchase_items (
        purchase_id, item_id, item_name,
        qty, unit, purchase_price,
        gst_percentage, tax_amount, cgst, sgst,
        category_id, item_uuid, zodu_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        purchase_id,
        item.item_id || null,
        item.item_name,
        item.qty,
        item.unit || null,
        item.purchase_price,
        item.gst_percentage || null,
        item.tax_amount || null,
        item.cgst || null,
        item.sgst || null,
        item.category_id || null,
        item.item_uuid || null,
        zodu_id,
      ]
    );
  }
};

// Aggregates every return of a purchase in one pass (child rows shown under it).
const RETURNS_JOIN = `
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*)                          AS return_count,
         COALESCE(SUM(r.return_amount), 0) AS total_returned,
         COALESCE(
           json_agg(
             json_build_object(
               'return_uuid',     r.return_uuid,
               'return_id',       r.return_id,
               'return_type',     r.return_type,
               'return_amount',   r.return_amount,
               'refund_type',     r.refund_type,
               'refund_status',   r.refund_status,
               'adjusted_amount', r.adjusted_amount,
               'refund_due',      r.refund_due,
               'refunded_amount', r.refunded_amount,
               'pending_refund',  GREATEST(r.refund_due - r.refunded_amount, 0),
               'excess_refund',   GREATEST(r.refunded_amount - r.refund_due, 0),
               'return_reason',   r.return_reason,
               'return_date_fmt', TO_CHAR(r.created_at, 'DD Mon YYYY')
             ) ORDER BY r.created_at DESC
           ), '[]'::json
         )                                 AS returns
       FROM tbl_purchase_returns r
       WHERE r.zodu_id = p.zodu_id
         AND r.original_purchase_id = p.purchase_id
     ) ret ON TRUE`;

exports.getPurchases = async ({
  zodu_id,
  branch_id,
  vendor_id,
  payment_status,
  cancelled_purchase,
  search,
} = {}) => {
  const conditions = [`p.cancelled_purchase = $1`];
  const values = [cancelled_purchase || false];
  let idx = 2;

  if (zodu_id) {
    conditions.push(`p.zodu_id = $${idx++}`);
    values.push(zodu_id);
  }
  if (branch_id) {
    conditions.push(`p.branch_id = $${idx++}`);
    values.push(branch_id);
  }
  if (vendor_id) {
    conditions.push(`p.vendor_id = $${idx++}`);
    values.push(vendor_id);
  }
  if (payment_status) {
    conditions.push(`p.payment_status = $${idx++}`);
    values.push(payment_status);
  }
  // A return is listed when its purchase matches every filter (its own id also counts for search).
  const returnConditions = [...conditions];
  if (search) {
    const byPurchase = `p.purchase_id ILIKE $${idx} OR p.vendor_id ILIKE $${idx} OR v.vendor_name ILIKE $${idx}`;
    conditions.push(`(${byPurchase})`);
    returnConditions.push(`(${byPurchase} OR r.return_id ILIKE $${idx})`);
    values.push(`%${search}%`);
    idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const [purchaseResult, returnResult] = await Promise.all([
    conn.query(
      `SELECT
         'purchase'::text AS row_type,
         TO_CHAR(p.purchase_date, 'YYYY-MM-DD') AS sort_date,
         EXTRACT(EPOCH FROM p.created_at)       AS sort_ts,
         p.*,
         TO_CHAR(p.purchase_date, 'DD Mon YYYY') AS purchase_date_formatted,
         TO_CHAR(p.due_date, 'DD Mon YYYY') AS due_date_formatted,
         v.vendor_name,
         v.company_name,
         v.vendor_phone,
         -- Returns reduce what is still owed: due = stored balance - returned amount,
         -- never below 0. With no returns this is unchanged.
         GREATEST(p.balance_amount - ret.total_returned, 0) AS balance_amount,
         p.balance_amount                                   AS original_balance_amount,
         ret.return_count,
         ret.total_returned,
         ret.returns
       FROM tbl_purchase p
       LEFT JOIN tbl_vendor v ON v.vendor_id = p.vendor_id AND p.zodu_id = v.zodu_id AND p.branch_id = v.branch_id
       ${RETURNS_JOIN}
       ${where}`,
      values
    ),
    // The returns / debit notes themselves, as list entries of their own: they are placed by
    // their own date, so a return made today sits among today's rows while its purchase stays put.
    conn.query(
      `SELECT
         'return'::text AS row_type,
         TO_CHAR(r.return_date, 'YYYY-MM-DD') AS sort_date,
         EXTRACT(EPOCH FROM r.created_at)     AS sort_ts,
         r.return_uuid,
         r.return_id,
         r.return_type,
         r.return_amount,
         r.refund_type,
         r.refund_status,
         r.adjusted_amount,
         r.refund_due,
         r.refunded_amount,
         GREATEST(r.refund_due - r.refunded_amount, 0) AS pending_refund,
         GREATEST(r.refunded_amount - r.refund_due, 0) AS excess_refund,
         r.return_reason,
         TO_CHAR(r.return_date, 'DD Mon YYYY') AS return_date_fmt,
         r.original_purchase_id,
         p.vendor_id,
         v.vendor_name,
         v.company_name,
         v.vendor_phone
       FROM tbl_purchase_returns r
       JOIN tbl_purchase p ON p.zodu_id = r.zodu_id AND p.branch_id = r.branch_id AND p.purchase_id = r.original_purchase_id
       LEFT JOIN tbl_vendor v ON v.vendor_id = p.vendor_id AND p.zodu_id = v.zodu_id AND p.branch_id = v.branch_id
       WHERE ${returnConditions.join(" AND ")}`,
      values
    ),
  ]);

  // Newest first, purchases and returns together: by date, then by when the row was created.
  const rows = [...purchaseResult.rows, ...returnResult.rows].sort(
    (a, b) =>
      (a.sort_date < b.sort_date ? 1 : a.sort_date > b.sort_date ? -1 : 0) ||
      (Number(b.sort_ts) || 0) - (Number(a.sort_ts) || 0)
  );

  return rows;
};

exports.getPurchaseById = async (id, { branch_id, zodu_id } = {}) => {
  const conditions = [`p.purchase_id = $1`];
  const values = [id];

  if (branch_id) {
    values.push(branch_id);
    conditions.push(`p.branch_id = $${values.length}`);
  }
  if (zodu_id) {
    values.push(zodu_id);
    conditions.push(`p.zodu_id = $${values.length}`);
  }

  // ── 1. Purchase header + vendor ─────────────────────────────
 const { rows: purchaseRows } = await conn.query(
  `SELECT
     p.*,
     TO_CHAR(p.purchase_date, 'YYYY-MM-DD') AS purchase_date_formatted,
     TO_CHAR(p.due_date, 'DD Mon YYYY') AS due_date_formatted,
     TO_CHAR(p.created_at, 'DD Mon YYYY, HH12:MI AM') AS created_at_formatted,
     v.vendor_name,
     v.company_name,
     v.vendor_phone,
     v.vendor_email,
     v.vendor_address_1,
     v.vendor_address_2,
     v.city,
     v.state,
     v.pincode,
     v.gst AS vendor_gst
   FROM tbl_purchase p
   LEFT JOIN tbl_vendor v ON v.vendor_id = p.vendor_id AND p.zodu_id = v.zodu_id AND p.branch_id = v.branch_id
   WHERE ${conditions.join(" AND ")}`,
  values
);

  const purchase = purchaseRows[0];
  if (!purchase) return null;

  // ── 2. Purchase items ────────────────────────────────────────
const { rows: items } = await conn.query(
  `SELECT
     pi.purchase_item_id,
     pi.item_id,
     pi.item_uuid,
     pi.item_name,
     pi.qty,
     pi.unit,
     pi.purchase_price,
     pi.gst_percentage,
     pi.tax_amount,
     pi.cgst,
     pi.sgst,
     pi.subtotal,
     pi.total_price,
     pi.category_id,
     -- how much of this line has already been returned (the purchase line itself is
     -- never changed by a return), and what can still be returned
     COALESCE(rt.returned_qty, 0)                          AS returned_qty,
     GREATEST(pi.qty - COALESCE(rt.returned_qty, 0), 0)    AS returnable_qty,
     mi.hsn_code                -- 🔥 ADDED
   FROM tbl_purchase_items pi
   LEFT JOIN tbl_menu_items mi 
     ON mi.item_id = pi.item_id AND mi.branch_id = $3 AND mi.zodu_id = $2  -- 🔥 JOIN WITH MENU ITEMS TO GET HSN CODE
   LEFT JOIN LATERAL (
     SELECT SUM(ri.return_qty) AS returned_qty
     FROM tbl_purchase_return_items ri
     JOIN tbl_purchase_returns r ON r.return_uuid = ri.return_uuid
     WHERE r.zodu_id = $2
       AND r.original_purchase_id = pi.purchase_id
       AND ri.original_item_id = pi.purchase_item_id
   ) rt ON TRUE
   WHERE pi.purchase_id = $1
   ORDER BY pi.purchase_item_id ASC`,
  [purchase.purchase_id, purchase.zodu_id, purchase.branch_id]
);

console.log(items)

  // ── 3. Payment history ───────────────────────────────────────
  const { rows: payments } = await conn.query(
    `SELECT
       pp.payment_id,
     TO_CHAR(pp.payment_date, 'DD Mon YYYY') AS payment_date,
       pp.paid_amount,
       pp.transaction_type,
       pp.transaction_id,
       pp.status,
       pp.created_at
     FROM tbl_purchase_payment pp
     WHERE pp.purchase_id = $1
     ORDER BY pp.payment_date ASC, pp.created_at ASC`,
    [purchase.purchase_id]
  );

  // ── 4. Returns / debit notes against this purchase ───────────
  const { rows: returns } = await conn.query(
    `SELECT
       r.return_uuid, r.return_id, r.return_type, r.return_amount,
       r.refund_type, r.refund_status, r.adjusted_amount, r.refund_due,
       r.refunded_amount,
       GREATEST(r.refund_due - r.refunded_amount, 0) AS pending_refund,
       GREATEST(r.refunded_amount - r.refund_due, 0) AS excess_refund,
       r.return_reason,
       TO_CHAR(r.created_at, 'DD Mon YYYY') AS return_date_fmt
     FROM tbl_purchase_returns r
     WHERE r.zodu_id = $1 AND r.original_purchase_id = $2
     ORDER BY r.created_at DESC`,
    [purchase.zodu_id, purchase.purchase_id]
  );
  const totalReturned = returns.reduce((sum, r) => sum + Number(r.return_amount), 0);

  return {
    ...purchase,
    items,
    payments,
    returns,
    total_returned: totalReturned,
    // Stored balance is total - paid; the net due also takes returns off.
    net_balance_amount: Math.max(Number(purchase.balance_amount) - totalReturned, 0),
  };
};

// A purchase with returns cannot be edited or cancelled: editing re-creates its item
// rows (new ids) and cancelling reverses its stock, either of which would leave the
// returns pointing at lines that no longer match.
exports.hasReturns = async (client, purchase_id, zodu_id) => {
  const { rowCount } = await client.query(
    `SELECT 1 FROM tbl_purchase_returns
     WHERE original_purchase_id = $1 AND zodu_id = $2
     LIMIT 1`,
    [purchase_id, zodu_id]
  );
  return rowCount > 0;
};

// Used inside transactions — must use the client
exports.getPurchaseByIdForUpdate = async (client, purchase_id) => {
  const { rows } = await client.query(
    `SELECT * FROM tbl_purchase WHERE purchase_id = $1 FOR UPDATE`,
    [purchase_id]
  );
  return rows[0];
};

exports.getPurchaseItems = async (client, purchase_id) => {
  const { rows } = await client.query(
    `SELECT * FROM tbl_purchase_items WHERE purchase_id = $1`,
    [purchase_id]
  );
  return rows;
};

exports.deletePurchaseItems = async (client, purchase_id) => {
  await client.query(
    `DELETE FROM tbl_purchase_items WHERE purchase_id = $1`,
    [purchase_id]
  );
};

// Reverses stock for every item on a purchase in one round trip, and writes
// one tbl_stock_ledger row per item in a second round trip. Set-based instead
// of per-item queries so an N-item purchase costs 2 queries, not 2N.
// Quantities are pre-aggregated per item_uuid so a purchase with duplicate
// line items for the same item still reverses the full total.
exports.reversePurchaseStock = async (client, { purchase_id, reference_id, zodu_id, branch_id }) => {
  const { rows: totals } = await client.query(
    `SELECT item_uuid, SUM(qty) AS qty
     FROM tbl_purchase_items
     WHERE purchase_id = $1 AND item_uuid IS NOT NULL
     GROUP BY item_uuid`,
    [purchase_id]
  );

  if (totals.length === 0) return [];

  const itemUuids = totals.map((r) => r.item_uuid);
  const qtys      = totals.map((r) => Number(r.qty));

  const { rows: updated } = await client.query(
    `WITH deltas AS (
       SELECT item_uuid, qty FROM unnest($1::uuid[], $2::numeric[]) AS v(item_uuid, qty)
     ),
     before AS (
       SELECT i.item_uuid, i.available_qty AS stock_before
       FROM tbl_inventory i
       JOIN deltas d ON d.item_uuid = i.item_uuid
     )
     UPDATE tbl_inventory i
     SET available_qty      = GREATEST(i.available_qty - d.qty, 0),
         last_stock_update  = NOW()
     FROM deltas d
     JOIN before b ON b.item_uuid = d.item_uuid
     WHERE i.item_uuid = d.item_uuid
     RETURNING i.item_uuid, i.item_id, i.item_name,
               d.qty            AS qty_change,
               b.stock_before   AS stock_before,
               i.available_qty  AS stock_after`,
    [itemUuids, qtys]
  );

  if (updated.length === 0) return [];

  const note = `Stock reversed on deletion of purchase ${purchase_id}`;

  const { rows: ledgerRows } = await client.query(
    `INSERT INTO tbl_stock_ledger (
       item_uuid, item_id, zodu_id, branch_id,
       item_name, transaction_type,
       reference_id, qty_change,
       stock_before, stock_after, notes
     )
     SELECT u.item_uuid, u.item_id, $7, $8,
            u.item_name, 'purchase_delete',
            $9, -u.qty_change,
            u.stock_before, u.stock_after, $10
     FROM unnest(
       $1::uuid[], $2::text[], $3::text[], $4::numeric[], $5::numeric[], $6::numeric[]
     ) AS u(item_uuid, item_id, item_name, qty_change, stock_before, stock_after)
     RETURNING *`,
    [
      updated.map((r) => r.item_uuid),
      updated.map((r) => r.item_id),
      updated.map((r) => r.item_name),
      updated.map((r) => r.qty_change),
      updated.map((r) => r.stock_before),
      updated.map((r) => r.stock_after),
      zodu_id,
      branch_id,
      reference_id,
      note,
    ]
  );

  return ledgerRows;
};

exports.updatePurchase = async (client, purchase_id, data) => {
  const totalAmount = Number(data.total_amount) || 0;
  const paidAmount  = Number(data.paid_amount) || 0;

  await client.query(
    `UPDATE tbl_purchase
     SET vendor_id        = $1,
         purchase_date    = $2,
         total_amount     = $3::numeric,
         paid_amount      = $4::numeric,
         due_date         = $8,
         payment_status   = CASE
                              WHEN $4::numeric >= $3::numeric THEN 'paid'
                              WHEN $4::numeric = 0            THEN 'pending'
                              ELSE 'partial'
                            END,
         notes            = $5,
         attachment_url   = $6,
         updated_at       = NOW(),
         invoice_bill_no  = $9
     WHERE purchase_id = $7::varchar`,   // ✅ FIX HERE
    [
      data.vendor_id || null,
      data.purchase_date,
      totalAmount,
      paidAmount,
      data.notes || null,
      data.attachment_url ? JSON.stringify(data.attachment_url) : null,
      String(purchase_id), // ✅ FORCE STRING
      data.due_date || null,
      data.invoice_bill_no || null,
    ]
  );
};

exports.deletePurchasePayments = async (client, purchase_id) => {
  await client.query(
    `DELETE FROM tbl_purchase_payment WHERE purchase_id = $1`,
    [purchase_id]
  );
};

exports.deletePurchase = async (client, purchase_id) => {
  await client.query(
    `UPDATE tbl_purchase SET cancelled_purchase = true, updated_at = NOW() WHERE purchase_id = $1`,
    [purchase_id]
  );
};

exports.createPurchasePayment = async (client, data) => {
  await client.query(
    `INSERT INTO tbl_purchase_payment (
      purchase_id, zodu_id, branch_id,
      payment_date, paid_amount,
      transaction_type, transaction_id, status
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      data.purchase_id,
      data.zodu_id,
      data.branch_id,
      data.payment_date,
      data.paid_amount,
      data.transaction_type || "cash",
      data.transaction_id || null,
      data.status || "completed",
    ]
  );
};

exports.createStockLedger = async (client, data) => {
  const { rows } = await client.query(
    `INSERT INTO tbl_stock_ledger (
      item_uuid, item_id, zodu_id, branch_id,
      item_name, transaction_type,
      reference_id, qty_change,
      stock_before, stock_after, notes
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING *`,
    [
      data.item_uuid,
      data.item_id,
      data.zodu_id,
      data.branch_id,
      data.item_name,
      data.transaction_type,
      data.reference_id,
      data.qty_change,
      data.stock_before,
      data.stock_after,
      data.notes || null,
    ]
  );
  return rows[0];
};