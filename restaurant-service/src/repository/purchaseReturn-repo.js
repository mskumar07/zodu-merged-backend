const pool = require("../database/connection");

// Every write takes the caller's transaction `client`; reads for the details
// screen run on the pool.

// ── Purchase ──────────────────────────────────────────────────

// Locks the purchase and returns what the settlement maths needs, including how
// much has already been returned against it. balance_amount is a generated
// column (total - paid) and is never changed by a return.
exports.findPurchaseForUpdate = async (client, purchaseId, zoduId, branchId) => {
  const { rows } = await client.query(
    `SELECT
        p.purchase_id, p.zodu_id, p.branch_id,
        p.total_amount, p.paid_amount, p.balance_amount,
        p.payment_status, p.cancelled_purchase,
        (SELECT COALESCE(SUM(r.return_amount), 0)
           FROM tbl_purchase_returns r
          WHERE r.zodu_id = p.zodu_id
            AND r.original_purchase_id = p.purchase_id) AS returned_total
     FROM tbl_purchase p
     WHERE p.purchase_id = $1
       AND p.zodu_id     = $2
       AND p.branch_id   = $3
     FOR UPDATE`,
    [purchaseId, zoduId, branchId]
  );
  return rows[0] ?? null;
};

// HSN is not stored on purchase lines, so it is read from the menu once, here, and
// copied onto the return line.
exports.findPurchaseItems = async (client, purchaseId, zoduId, branchId) => {
  const { rows } = await client.query(
    `SELECT
        pi.purchase_item_id, pi.item_id, pi.item_uuid, pi.item_name, pi.unit,
        pi.qty, pi.purchase_price, pi.gst_percentage, pi.tax_amount,
        mi.hsn_code
     FROM tbl_purchase_items pi
     LEFT JOIN LATERAL (
        SELECT m.hsn_code
        FROM tbl_menu_items m
        WHERE m.item_uuid = pi.item_uuid
          AND m.zodu_id   = $2
          AND m.branch_id = $3
        LIMIT 1
     ) mi ON TRUE
     WHERE pi.purchase_id = $1
       AND pi.zodu_id     = $2
     ORDER BY pi.purchase_item_id`,
    [purchaseId, zoduId, branchId]
  );
  return rows;
};

// `excludeReturnUuid` leaves one return out, so editing it doesn't count its own
// quantities against itself.
exports.findReturnedQtys = async (client, purchaseId, zoduId, excludeReturnUuid = null) => {
  const { rows } = await client.query(
    `SELECT
        ri.original_item_id,
        COALESCE(SUM(ri.return_qty), 0) AS returned_qty
     FROM tbl_purchase_return_items ri
     JOIN tbl_purchase_returns r ON r.return_uuid = ri.return_uuid
     WHERE r.zodu_id = $2
       AND r.original_purchase_id = $1
       AND ($3::uuid IS NULL OR r.return_uuid <> $3::uuid)
     GROUP BY ri.original_item_id`,
    [purchaseId, zoduId, excludeReturnUuid]
  );
  return rows;
};

// Re-derives the purchase's payment label from what is still owed once returns
// are taken into account (`totalReturned` = every return on it after the change).
// Only the label moves; total, paid and the items are never touched.
exports.syncPurchasePaymentStatus = async (client, purchaseId, zoduId, totalReturned) => {
  await client.query(
    `UPDATE tbl_purchase
     SET payment_status = CASE
           WHEN paid_amount > 0 AND total_amount - $3::numeric - paid_amount <= 0 THEN 'paid'
           WHEN paid_amount > 0                                                  THEN 'partial'
           ELSE 'pending'
         END,
         updated_at = NOW()
     WHERE purchase_id = $1
       AND zodu_id     = $2
       AND payment_status IN ('paid', 'partial', 'pending')`,
    [purchaseId, zoduId, Number(totalReturned).toFixed(2)]
  );
};

// ── Return header + items ─────────────────────────────────────

exports.insertReturn = async (client, p) => {
  const { rows } = await client.query(
    `INSERT INTO tbl_purchase_returns (
        return_id, return_type, zodu_id, branch_id, original_purchase_id,
        return_reason, notes, refund_type,
        subtotal, total_tax, return_amount,
        adjusted_amount, refund_due, refunded_amount, refund_status,
        created_by
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING
        return_uuid, return_id, return_type, return_amount,
        adjusted_amount, refund_due, refunded_amount, refund_status,
        refund_type, return_date, created_at`,
    [
      p.return_id, p.return_type, p.zodu_id, p.branch_id, p.original_purchase_id,
      p.return_reason ?? null, p.notes ?? null, p.refund_type ?? null,
      p.subtotal.toFixed(2), p.total_tax.toFixed(2), p.return_amount.toFixed(2),
      p.adjusted_amount.toFixed(2), p.refund_due.toFixed(2), p.refunded_amount.toFixed(2),
      p.refund_status,
      p.created_by ?? null,
    ]
  );
  return rows[0];
};

// refunded_amount is deliberately untouched: refunds already received stay recorded.
exports.updateReturn = async (client, p) => {
  const { rows } = await client.query(
    `UPDATE tbl_purchase_returns
     SET return_type     = COALESCE($2, return_type),
         return_reason   = $3,
         notes           = $4,
         refund_type     = COALESCE(NULLIF($5::text, ''), refund_type),
         subtotal        = $6,
         total_tax       = $7,
         return_amount   = $8,
         adjusted_amount = $9,
         refund_due      = $10,
         refund_status   = $11
     WHERE return_uuid   = $1
     RETURNING return_amount, adjusted_amount, refund_due, refunded_amount, refund_status`,
    [
      p.return_uuid, p.return_type ?? null, p.return_reason ?? null, p.notes ?? null, p.refund_type ?? null,
      p.subtotal.toFixed(2), p.total_tax.toFixed(2), p.return_amount.toFixed(2),
      p.adjusted_amount.toFixed(2), p.refund_due.toFixed(2), p.refund_status,
    ]
  );
  return rows[0];
};

exports.insertItems = async (client, returnUuid, lines) => {
  await client.query(
    `INSERT INTO tbl_purchase_return_items (
        return_uuid, original_item_id, item_id, item_uuid, item_name, unit,
        hsn_code, gst_percentage, purchase_price, original_qty, return_qty,
        taxable_amount, tax_amount, cgst, sgst
     )
     SELECT
        $1::uuid, t.original_item_id, t.item_id, t.item_uuid, t.item_name, t.unit,
        t.hsn_code, t.gst_percentage, t.purchase_price, t.original_qty, t.return_qty,
        t.taxable_amount, t.tax_amount, t.cgst, t.sgst
     FROM UNNEST(
        $2::int[], $3::text[], $4::uuid[], $5::text[], $6::text[],
        $7::text[], $8::numeric[], $9::numeric[], $10::numeric[], $11::numeric[],
        $12::numeric[], $13::numeric[], $14::numeric[], $15::numeric[]
     ) AS t(
        original_item_id, item_id, item_uuid, item_name, unit,
        hsn_code, gst_percentage, purchase_price, original_qty, return_qty,
        taxable_amount, tax_amount, cgst, sgst
     )`,
    [
      returnUuid,
      lines.map((l) => l.original_item_id),
      lines.map((l) => l.item_id),
      lines.map((l) => l.item_uuid),
      lines.map((l) => l.item_name),
      lines.map((l) => l.unit),
      lines.map((l) => l.hsn_code),
      lines.map((l) => l.gst_percentage),
      lines.map((l) => l.purchase_price),
      lines.map((l) => l.original_qty),
      lines.map((l) => l.return_qty),
      lines.map((l) => l.taxable_amount.toFixed(2)),
      lines.map((l) => l.tax_amount.toFixed(2)),
      lines.map((l) => l.cgst.toFixed(2)),
      lines.map((l) => l.sgst.toFixed(2)),
    ]
  );
};

exports.deleteItems = async (client, returnUuid) => {
  await client.query(`DELETE FROM tbl_purchase_return_items WHERE return_uuid = $1`, [returnUuid]);
};

// Items first in case a database lacks the cascade; refund payments cascade.
exports.deleteReturn = async (client, returnUuid) => {
  await exports.deleteItems(client, returnUuid);
  await client.query(`DELETE FROM tbl_purchase_returns WHERE return_uuid = $1`, [returnUuid]);
};

// Unlocked peek used only to learn which purchase to lock first, so every write
// takes locks in the same order (purchase, then return, then stock).
exports.findReturnPurchaseId = async (client, returnUuid, zoduId, branchId) => {
  const { rows } = await client.query(
    `SELECT original_purchase_id
     FROM tbl_purchase_returns
     WHERE return_uuid = $1 AND zodu_id = $2 AND branch_id = $3`,
    [returnUuid, zoduId, branchId]
  );
  return rows[0]?.original_purchase_id ?? null;
};

exports.findReturnForUpdate = async (client, returnUuid, zoduId, branchId) => {
  const { rows } = await client.query(
    `SELECT
        return_uuid, return_id, original_purchase_id,
        return_amount, refund_due, refunded_amount, refund_status
     FROM tbl_purchase_returns
     WHERE return_uuid = $1 AND zodu_id = $2 AND branch_id = $3
     FOR UPDATE`,
    [returnUuid, zoduId, branchId]
  );
  return rows[0] ?? null;
};

// Quantities per stock item, for the stock movement. Lines with no item_uuid
// (nothing to move) are left out.
exports.findReturnItemQtys = async (client, returnUuid) => {
  const { rows } = await client.query(
    `SELECT item_uuid, MAX(item_name) AS item_name, SUM(return_qty) AS return_qty
     FROM tbl_purchase_return_items
     WHERE return_uuid = $1 AND item_uuid IS NOT NULL
     GROUP BY item_uuid`,
    [returnUuid]
  );
  return rows;
};

// ── Refunds received ──────────────────────────────────────────

exports.insertRefund = async (client, p) => {
  const { rows } = await client.query(
    `INSERT INTO tbl_purchase_return_payment (
        return_uuid, zodu_id, branch_id,
        refund_amount, payment_mode, reference_no, refund_date
     )
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::date, CURRENT_DATE))
     RETURNING id, refund_amount, payment_mode, reference_no, refund_date, created_at`,
    [
      p.return_uuid, p.zodu_id, p.branch_id,
      p.refund_amount.toFixed(2), p.payment_mode, p.reference_no ?? null, p.refund_date ?? null,
    ]
  );
  return rows[0];
};

exports.updateRefundProgress = async (client, returnUuid, refundedAmount, refundStatus) => {
  await client.query(
    `UPDATE tbl_purchase_returns
     SET refunded_amount = $2, refund_status = $3
     WHERE return_uuid = $1`,
    [returnUuid, refundedAmount.toFixed(2), refundStatus]
  );
};

// ── Stock (keyed by item_uuid, which is how purchases find inventory) ──

// Restaurant stock lives in stock_qty. Locks every affected stock row in one query, in a fixed order so two returns
// touching the same items can never deadlock each other.
exports.findInventoriesForUpdate = async (client, itemUuids, branchId) => {
  const { rows } = await client.query(
    `SELECT inventory_uuid, item_uuid, item_id, item_name, stock_qty AS available_qty
     FROM tbl_inventory
     WHERE item_uuid = ANY($1::uuid[])
       AND branch_id = $2
     ORDER BY item_uuid
     FOR UPDATE`,
    [itemUuids, branchId]
  );
  return rows;
};

exports.bulkUpdateInventoryQty = async (client, updates) => {
  await client.query(
    `UPDATE tbl_inventory AS inv
     SET stock_qty  = t.new_qty,
         updated_at = NOW()
     FROM UNNEST($1::uuid[], $2::numeric[]) AS t(inventory_uuid, new_qty)
     WHERE inv.inventory_uuid = t.inventory_uuid`,
    [updates.map((u) => u.inventory_uuid), updates.map((u) => u.new_qty.toFixed(2))]
  );
};

exports.bulkInsertStockLedger = async (client, { zodu_id, branch_id, reference_id, notes, entries, transaction_type }) => {
  await client.query(
    `INSERT INTO tbl_stock_ledger (
        item_uuid, item_id, zodu_id, branch_id,
        item_name, transaction_type, reference_id,
        qty_change, stock_before, stock_after, notes
     )
     SELECT
        t.item_uuid, t.item_id, $1, $2,
        t.item_name, $11, $3::uuid,
        t.qty_change, t.stock_before, t.stock_after, $4
     FROM UNNEST(
        $5::uuid[], $6::text[], $7::text[],
        $8::numeric[], $9::numeric[], $10::numeric[]
     ) AS t(item_uuid, item_id, item_name, qty_change, stock_before, stock_after)`,
    [
      zodu_id, branch_id, reference_id, notes,
      entries.map((e) => e.item_uuid),
      entries.map((e) => e.item_id),
      entries.map((e) => e.item_name),
      entries.map((e) => e.qty_change.toFixed(2)),
      entries.map((e) => e.stock_before.toFixed(2)),
      entries.map((e) => e.stock_after.toFixed(2)),
      transaction_type,
    ]
  );
};

// ── Details (read-only) ───────────────────────────────────────

// Everything the details dialog needs in ONE round trip: header, vendor, items
// and refunds as JSON arrays, and the tax totals. Each lateral join aggregates a
// child table once, so the result is a single row and the app does no more work.
exports.getReturnDetail = async (returnUuid, zoduId, branchId) => {
  const { rows } = await pool.query(
    `SELECT
        r.return_uuid, r.return_id, r.return_type,
        r.original_purchase_id, r.return_reason, r.notes, r.refund_type, r.refund_status,
        r.subtotal, r.total_tax, r.return_amount,
        r.adjusted_amount, r.refund_due, r.refunded_amount,
        GREATEST(r.refund_due - r.refunded_amount, 0) AS pending_refund,
        GREATEST(r.refunded_amount - r.refund_due, 0) AS excess_refund,
        TO_CHAR(r.return_date, 'DD Mon YYYY')             AS return_date_fmt,
        TO_CHAR(r.created_at,  'DD Mon YYYY, HH12:MI AM') AS created_at_fmt,

        TO_CHAR(p.purchase_date, 'DD Mon YYYY') AS purchase_date_fmt,
        p.invoice_bill_no,
        v.vendor_name, v.company_name, v.vendor_phone, v.gst AS vendor_gst,
        v.vendor_address_1, v.vendor_address_2, v.city, v.state, v.pincode,

        COALESCE(it.items, '[]'::json)   AS items,
        COALESCE(it.cgst, 0)             AS cgst,
        COALESCE(it.sgst, 0)             AS sgst,
        COALESCE(rf.refunds, '[]'::json) AS refunds
     FROM tbl_purchase_returns r
     LEFT JOIN tbl_purchase p
            ON p.zodu_id = r.zodu_id AND p.branch_id = r.branch_id AND p.purchase_id = r.original_purchase_id
     LEFT JOIN tbl_vendor v
            ON v.vendor_id = p.vendor_id AND v.zodu_id = p.zodu_id AND v.branch_id = p.branch_id
     LEFT JOIN LATERAL (
        SELECT
           json_agg(json_build_object(
              'id',               i.id,
              'original_item_id', i.original_item_id,
              'item_id',          i.item_id,
              'item_name',        i.item_name,
              'unit',             i.unit,
              'hsn_code',         i.hsn_code,
              'gst_percentage',   i.gst_percentage,
              'purchase_price',   i.purchase_price,
              'original_qty',     i.original_qty,
              'return_qty',       i.return_qty,
              'taxable_amount',   i.taxable_amount,
              'tax_amount',       i.tax_amount,
              'cgst',             i.cgst,
              'sgst',             i.sgst,
              'total_amount',     i.total_amount
           ) ORDER BY i.id) AS items,
           SUM(i.cgst) AS cgst,
           SUM(i.sgst) AS sgst
        FROM tbl_purchase_return_items i
        WHERE i.return_uuid = r.return_uuid
     ) it ON TRUE
     LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object(
              'id',              pay.id,
              'refund_amount',   pay.refund_amount,
              'payment_mode',    pay.payment_mode,
              'reference_no',    pay.reference_no,
              'refund_date',     pay.refund_date,
              'refund_date_fmt', TO_CHAR(pay.refund_date, 'DD Mon YYYY')
           ) ORDER BY pay.created_at, pay.id) AS refunds
        FROM tbl_purchase_return_payment pay
        WHERE pay.return_uuid = r.return_uuid
     ) rf ON TRUE
     WHERE r.return_uuid = $1
       AND r.zodu_id     = $2
       AND r.branch_id   = $3`,
    [returnUuid, zoduId, branchId]
  );
  return rows[0] ?? null;
};
