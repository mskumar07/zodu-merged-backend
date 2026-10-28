const pool = require("../database/connection");

class SaleReturnRepository {

  // ── Original sale ─────────────────────────────────────────

  async findSaleByUuidForUpdate(client, saleUuid, branchId) {
    const { rows } = await client.query(
      `SELECT
          sale_uuid, sale_id, branch_id, zodu_id,
          customer_uuid, total_amount, paid_amount, balance_amount, payment_status,
          discount_amount, discount_gst_mode,
          TO_CHAR(sale_date, 'YYYY-MM-DD') AS sale_date_iso,
          (SELECT COALESCE(SUM(r.return_amount), 0)
             FROM tbl_sale_returns r
            WHERE r.original_sale_uuid = tbl_sales.sale_uuid) AS returned_total
       FROM tbl_sales
       WHERE sale_uuid = $1
         AND branch_id = $2
       FOR UPDATE`,
      [saleUuid, branchId]
    );
    return rows[0] ?? null;
  }

  async findSaleItemsBySaleUuid(client, saleUuid) {
    const { rows } = await client.query(
      `SELECT
          id, sale_uuid, item_id, item_name, description,
          unit, quantity, price, mrp,
          discount, hsn_code, gst_percentage,
          tax_amount, cgst, sgst, tax_inclusive
       FROM tbl_sale_items
       WHERE sale_uuid = $1`,
      [saleUuid]
    );
    return rows;
  }

  // ── Already returned quantities ───────────────────────────

  // `excludeReturnUuid` leaves one return out, so editing it doesn't count its
  // own quantities against itself.
  async findAlreadyReturnedQtys(client, saleUuid, excludeReturnUuid = null) {
    const { rows } = await client.query(
      `SELECT
          sri.original_item_id,
          COALESCE(SUM(sri.return_qty), 0) AS returned_qty
       FROM tbl_sale_return_items sri
       JOIN tbl_sale_returns sr
         ON sr.return_uuid = sri.return_uuid
       WHERE sr.original_sale_uuid = $1
         AND ($2::uuid IS NULL OR sr.return_uuid <> $2::uuid)
       GROUP BY sri.original_item_id`,
      [saleUuid, excludeReturnUuid]
    );
    return rows;
  }

  // Re-derives the invoice status from what it still owes once returns are taken
  // into account (`totalReturned` = every return on the invoice after the change).
  // balance_amount itself is left alone: the sales-history query already
  // subtracts returns from it. Only the three payment states are touched, never
  // e.g. a cancelled/proforma status.
  async syncSalePaymentStatus(client, saleUuid, totalReturned) {
    await client.query(
      `UPDATE tbl_sales
       SET payment_status = CASE
             WHEN paid_amount > 0 AND balance_amount - $2::numeric <= 0 THEN 'fully_paid'
             WHEN paid_amount > 0                                       THEN 'partially_paid'
             ELSE 'unpaid'
           END
       WHERE sale_uuid = $1
         AND payment_status IN ('fully_paid', 'partially_paid', 'unpaid')`,
      [saleUuid, Number(totalReturned).toFixed(2)]
    );
  }

  // ── Insert return header ──────────────────────────────────

  async insertSaleReturn(client, payload) {
    const {
      return_id, original_sale_uuid, original_sale_id,
      zodu_id, branch_id, customer_id,
      return_reason, total_items, subtotal,
      total_tax, return_amount, refund_type,
      notes, created_by,
      return_type, adjusted_amount, refund_due, refund_status,
      discount_amount, round_off,return_date,
    } = payload;

    const { rows } = await client.query(
      `INSERT INTO tbl_sale_returns (
          return_id, original_sale_uuid, original_sale_id,
          zodu_id, branch_id, customer_id,
          return_reason, total_items, subtotal,
          total_tax, return_amount, refund_type,
          notes, created_by,
          return_type, adjusted_amount, refund_due, refund_status,
          discount_amount, round_off, return_date
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       RETURNING
          return_uuid, return_id, return_amount,
          refund_type, return_type, adjusted_amount,
          refund_due, refunded_amount, refund_status,
          return_date, created_at`,
      [
        return_id, original_sale_uuid, original_sale_id,
        zodu_id, branch_id, customer_id,
        return_reason, total_items,
        subtotal.toFixed(2), total_tax.toFixed(2),
        return_amount.toFixed(2), refund_type,
        notes, created_by,
        return_type, adjusted_amount.toFixed(2),
        refund_due.toFixed(2), refund_status,
        discount_amount.toFixed(2), round_off.toFixed(2),return_date || null,
      ]
    );
    return rows[0];
  }

  // ── Insert return line items (one round trip for all lines) ──

  async insertSaleReturnItems(client, returnUuid, lines) {
    await client.query(
      `INSERT INTO tbl_sale_return_items (
          return_uuid, original_item_id, item_id,
          item_name, unit, return_qty, original_qty,
          price, tax_amount, taxable_amount, discount_amount, cgst, sgst,
          gst_percentage, hsn_code,
          description
       )
       SELECT
          $1::uuid, t.original_item_id, t.item_id,
          t.item_name, t.unit, t.return_qty, t.original_qty,
          t.price, t.tax_amount, t.taxable_amount, t.discount_amount, t.cgst, t.sgst,
          t.gst_percentage, t.hsn_code,
          t.description
       FROM UNNEST(
          $2::int[], $3::text[], $4::text[], $5::text[],
          $6::numeric[], $7::numeric[], $8::numeric[], $9::numeric[],
          $10::numeric[], $11::numeric[], $12::numeric[],
          $13::numeric[], $14::text[], $15::text[], $16::numeric[]
       ) AS t(
          original_item_id, item_id, item_name, unit,
          return_qty, original_qty, price, tax_amount,
          taxable_amount, cgst, sgst,
          gst_percentage, hsn_code, description, discount_amount
       )`,
      [
        returnUuid,
        lines.map((l) => l.original_item_id),
        lines.map((l) => l.item_id),
        lines.map((l) => l.item_name),
        lines.map((l) => l.unit),
        lines.map((l) => l.return_qty),
        lines.map((l) => l.original_qty),
        lines.map((l) => l.price),
        lines.map((l) => l.tax_amount.toFixed(2)),
        lines.map((l) => l.taxable_amount.toFixed(2)),
        lines.map((l) => l.cgst.toFixed(2)),
        lines.map((l) => l.sgst.toFixed(2)),
        lines.map((l) => l.gst_percentage),
        lines.map((l) => l.hsn_code),
        lines.map((l) => l.description ?? null),
        lines.map((l) => l.discount_amount.toFixed(2)),
      ]
    );
  }

  // ── Inventory ─────────────────────────────────────────────

  // Locks every affected stock row in one query. Ordered by item_id so two
  // concurrent returns touching the same items always lock in the same order.
  async findInventoriesForUpdate(client, itemIds, branchId) {
    const { rows } = await client.query(
      `SELECT
          inventory_uuid, item_uuid, item_id,
          item_name, available_qty
       FROM tbl_inventory
       WHERE item_id   = ANY($1::text[])
         AND branch_id = $2
       ORDER BY item_id
       FOR UPDATE`,
      [itemIds, branchId]
    );
    return rows;
  }

  async bulkUpdateInventoryQty(client, updates) {
    await client.query(
      `UPDATE tbl_inventory AS inv
       SET available_qty     = t.new_qty,
           last_stock_update = CURRENT_TIMESTAMP
       FROM UNNEST($1::uuid[], $2::numeric[]) AS t(inventory_uuid, new_qty)
       WHERE inv.inventory_uuid = t.inventory_uuid`,
      [
        updates.map((u) => u.inventory_uuid),
        updates.map((u) => u.new_qty.toFixed(2)),
      ]
    );
  }

  // ── Stock ledger ──────────────────────────────────────────

  async bulkInsertStockLedger(client, { zodu_id, branch_id, reference_id, notes, entries, transaction_type = 'SALE_RETURN' }) {
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
  }

  // ── Delete ────────────────────────────────────────────────

  // Unlocked peek used only to learn which sale to lock first, so deleting a
  // return takes locks in the same order as creating one (sale, then return,
  // then stock) and the two can never deadlock.
  async findReturnSaleUuid(client, returnUuid, zoduId, branchId) {
    const { rows } = await client.query(
      `SELECT original_sale_uuid
       FROM tbl_sale_returns
       WHERE return_uuid = $1
         AND zodu_id     = $2
         AND branch_id   = $3`,
      [returnUuid, zoduId, branchId]
    );
    return rows[0]?.original_sale_uuid ?? null;
  }

  async findReturnItemQtys(client, returnUuid) {
    const { rows } = await client.query(
      `SELECT item_id, MAX(item_name) AS item_name, SUM(return_qty) AS return_qty
       FROM tbl_sale_return_items
       WHERE return_uuid = $1
       GROUP BY item_id`,
      [returnUuid]
    );
    return rows;
  }

  async deleteSaleReturnItems(client, returnUuid) {
    await client.query(`DELETE FROM tbl_sale_return_items WHERE return_uuid = $1`, [returnUuid]);
  }

  // Items first in case the FK is not ON DELETE CASCADE; refund payments cascade.
  async deleteSaleReturn(client, returnUuid) {
    await this.deleteSaleReturnItems(client, returnUuid);
    await client.query(`DELETE FROM tbl_sale_returns WHERE return_uuid = $1`, [returnUuid]);
  }

  // ── Edit ──────────────────────────────────────────────────

  // refunded_amount is deliberately untouched: refunds already paid stay recorded.
  // A missing type / refund type keeps what the return already had.
  async updateSaleReturn(client, payload) {
    const {
      return_uuid, return_type, return_reason, refund_type, notes,
      total_items, subtotal, total_tax, return_amount,
      adjusted_amount, refund_due, refund_status, discount_amount, round_off,return_date,
    } = payload;

    await client.query(
      `UPDATE tbl_sale_returns
       SET return_type     = COALESCE($2, return_type),
           return_reason   = $3,
           refund_type     = COALESCE(NULLIF($4::text, ''), refund_type),
           notes           = $5,
           total_items     = $6,
           subtotal        = $7,
           total_tax       = $8,
           return_amount   = $9,
           adjusted_amount = $10,
           refund_due      = $11,
           refund_status   = $12,
           discount_amount = $13,
           round_off       = $14,
           return_date     = $15
       WHERE return_uuid   = $1`,
      [
        return_uuid, return_type ?? null, return_reason ?? null, refund_type ?? null, notes ?? null,
        total_items, subtotal.toFixed(2), total_tax.toFixed(2), return_amount.toFixed(2),
        adjusted_amount.toFixed(2), refund_due.toFixed(2), refund_status,
        discount_amount.toFixed(2), round_off.toFixed(2), return_date || null,
      ]
    );
  }

  // ── Refunds ───────────────────────────────────────────────

  async findReturnForUpdate(client, returnUuid, zoduId, branchId) {
    const { rows } = await client.query(
      `SELECT
          return_uuid, return_id, original_sale_id, return_amount,
          refund_due, refunded_amount, refund_status,
          TO_CHAR(return_date, 'YYYY-MM-DD') AS return_date_iso
       FROM tbl_sale_returns
       WHERE return_uuid = $1
         AND zodu_id     = $2
         AND branch_id   = $3
       FOR UPDATE`,
      [returnUuid, zoduId, branchId]
    );
    return rows[0] ?? null;
  }

  async insertRefundPayment(client, payload) {
    const {
      return_uuid, zodu_id, branch_id,
      refund_amount, payment_mode, reference_no, refund_date,
    } = payload;

    const { rows } = await client.query(
      `INSERT INTO tbl_sale_return_payment (
          return_uuid, zodu_id, branch_id,
          refund_amount, payment_mode, reference_no, refund_date
       )
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::date, CURRENT_DATE))
       RETURNING id, refund_amount, payment_mode, reference_no, refund_date, created_at`,
      [
        return_uuid, zodu_id, branch_id,
        refund_amount.toFixed(2), payment_mode, reference_no ?? null, refund_date ?? null,
      ]
    );
    return rows[0];
  }

  async updateRefundProgress(client, returnUuid, refundedAmount, refundStatus) {
    await client.query(
      `UPDATE tbl_sale_returns
       SET refunded_amount = $2,
           refund_status   = $3
       WHERE return_uuid   = $1`,
      [returnUuid, refundedAmount.toFixed(2), refundStatus]
    );
  }

  // ── Detail (read-only, runs on the pool) ──────────────────

  // Everything the Sales Return Details dialog needs, in ONE round trip: header,
  // customer, items (as a JSON array in line order), refund payments and the
  // totals. The lateral joins aggregate each child table once per return, so the
  // result is a single row and the app does no further queries or summing.
  async getSaleReturnDetail(returnUuid, zoduId, branchId) {
    const { rows } = await pool.query(
      `SELECT
          r.return_uuid, r.return_id, r.return_type,
          r.original_sale_uuid, r.original_sale_id,
          r.return_reason, r.notes, r.refund_type, r.refund_status,
          r.adjusted_amount, r.refund_due, r.refunded_amount,
          GREATEST(r.refund_due - r.refunded_amount, 0) AS pending_refund,
          GREATEST(r.refunded_amount - r.refund_due, 0) AS excess_refund,
          TO_CHAR(r.return_date, 'DD Mon YYYY')             AS return_date_fmt,
          TO_CHAR(r.return_time, 'HH12:MI AM')              AS return_time_fmt,
          TO_CHAR(r.created_at,  'DD Mon YYYY, HH12:MI AM') AS created_at_fmt,

          c.cust_uuid, c.cust_id, c.cust_name, c.cpy_name,
          c.mobile_no->>0 AS customer_mobile,
          c.gst           AS customer_gst,
          c.address_line1, c.address_line2, c.city, c.state, c.pincode,

          COALESCE(it.items, '[]'::json)   AS items,
          COALESCE(it.subtotal, 0)         AS subtotal,
          COALESCE(it.discount, 0)         AS discount_amount,
          COALESCE(it.cgst, 0)             AS cgst,
          COALESCE(it.sgst, 0)             AS sgst,
          COALESCE(it.total_tax, 0)        AS total_tax,
          r.round_off,
          COALESCE(it.subtotal - it.discount + it.total_tax, 0) + r.round_off AS return_total,
          COALESCE(rf.refunds, '[]'::json) AS refunds
       FROM tbl_sale_returns r
       LEFT JOIN tbl_sales s
              ON s.sale_uuid = r.original_sale_uuid
       LEFT JOIN tbl_customer c
              ON c.cust_uuid = s.customer_uuid AND c.branch_id = s.branch_id
       LEFT JOIN LATERAL (
          SELECT
             json_agg(json_build_object(
                'id',               i.id,
                'original_item_id', i.original_item_id,
                'item_id',          i.item_id,
                'item_name',        i.item_name,
                'description',      i.description,
                'unit',             i.unit,
                'hsn_code',         i.hsn_code,
                'return_qty',       i.return_qty,
                'original_qty',     i.original_qty,
                'price',            i.price,
                'gst_percentage',   i.gst_percentage,
                'taxable_amount',   i.taxable_amount,
                'discount_amount',  i.discount_amount,
                'cgst',             i.cgst,
                'sgst',             i.sgst,
                'tax_amount',       i.tax_amount,
                'total_amount',     i.taxable_amount - i.discount_amount + i.tax_amount
             ) ORDER BY i.id)       AS items,
             SUM(i.taxable_amount)  AS subtotal,
             SUM(i.discount_amount) AS discount,
             SUM(i.cgst)            AS cgst,
             SUM(i.sgst)            AS sgst,
             SUM(i.tax_amount)      AS total_tax
          FROM tbl_sale_return_items i
          WHERE i.return_uuid = r.return_uuid
       ) it ON TRUE
       LEFT JOIN LATERAL (
          SELECT json_agg(json_build_object(
                'id',              p.id,
                'refund_amount',   p.refund_amount,
                'payment_mode',    p.payment_mode,
                'reference_no',    p.reference_no,
                'refund_date',     p.refund_date,
                'refund_date_fmt', TO_CHAR(p.refund_date, 'DD Mon YYYY')
             ) ORDER BY p.created_at, p.id) AS refunds
          FROM tbl_sale_return_payment p
          WHERE p.return_uuid = r.return_uuid
       ) rf ON TRUE
       WHERE r.return_uuid = $1
         AND r.zodu_id     = $2
         AND r.branch_id   = $3`,
      [returnUuid, zoduId, branchId]
    );
    return rows[0] ?? null;
  }

  // ── Transaction helpers ───────────────────────────────────

  async getClient() {
    return pool.connect();
  }
}

module.exports = {
  SaleReturnRepository,
};
