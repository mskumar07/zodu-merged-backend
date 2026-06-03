const pool = require("../database/connection");

class SaleReturnRepository {

  // ── Original sale ─────────────────────────────────────────

  async findSaleByUuidForUpdate(client, saleUuid, branchId) {
    const { rows } = await client.query(
      `SELECT
          sale_uuid, sale_id, branch_id, zodu_id,
          customer_uuid, total_amount, payment_status
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
          id, sale_uuid, item_id, item_name,
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

  async findAlreadyReturnedQtys(client, saleUuid) {
    const { rows } = await client.query(
      `SELECT
          sri.original_item_id,
          COALESCE(SUM(sri.return_qty), 0) AS returned_qty
       FROM tbl_sale_return_items sri
       JOIN tbl_sale_returns sr
         ON sr.return_uuid = sri.return_uuid
       WHERE sr.original_sale_uuid = $1
       GROUP BY sri.original_item_id`,
      [saleUuid]
    );
    return rows;
  }

  // ── Insert return header ──────────────────────────────────

  async insertSaleReturn(client, payload) {
    const {
      return_id, original_sale_uuid, original_sale_id,
      zodu_id, branch_id, customer_id,
      return_reason, total_items, subtotal,
      total_tax, return_amount, refund_type,
      notes, created_by,
    } = payload;

    const { rows } = await client.query(
      `INSERT INTO tbl_sale_returns (
          return_id, original_sale_uuid, original_sale_id,
          zodu_id, branch_id, customer_id,
          return_reason, total_items, subtotal,
          total_tax, return_amount, refund_type,
          notes, created_by
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING
          return_uuid, return_id, return_amount,
          refund_type, return_date, created_at`,
      [
        return_id, original_sale_uuid, original_sale_id,
        zodu_id, branch_id, customer_id,
        return_reason, total_items,
        subtotal.toFixed(2), total_tax.toFixed(2),
        return_amount.toFixed(2), refund_type,
        notes, created_by,
      ]
    );
    return rows[0];
  }

  // ── Insert return line items ──────────────────────────────

  async insertSaleReturnItem(client, payload) {
    const {
      return_uuid, original_item_id, item_id,
      item_name, unit, return_qty, original_qty,
      price, tax_amount, gst_percentage, hsn_code,
    } = payload;

    await client.query(
      `INSERT INTO tbl_sale_return_items (
          return_uuid, original_item_id, item_id,
          item_name, unit, return_qty, original_qty,
          price, tax_amount, gst_percentage, hsn_code
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        return_uuid, original_item_id, item_id,
        item_name, unit,
        return_qty, original_qty,
        price, tax_amount.toFixed(2),
        gst_percentage, hsn_code,
      ]
    );
  }

  // ── Inventory ─────────────────────────────────────────────

  async findInventoryForUpdate(client, itemId, branchId) {
    const { rows } = await client.query(
      `SELECT
          inventory_uuid, item_uuid, item_id,
          item_name, available_qty
       FROM tbl_inventory
       WHERE item_id   = $1
         AND branch_id = $2
       FOR UPDATE`,
      [itemId, branchId]
    );
    return rows[0] ?? null;
  }

  async updateInventoryQty(client, inventoryUuid, newQty) {
    await client.query(
      `UPDATE tbl_inventory
       SET available_qty     = $1,
           last_stock_update = CURRENT_TIMESTAMP
       WHERE inventory_uuid  = $2`,
      [newQty.toFixed(2), inventoryUuid]
    );
  }

  // ── Stock ledger ──────────────────────────────────────────

  async insertStockLedger(client, payload) {
    const {
      item_uuid, item_id, zodu_id, branch_id,
      item_name, reference_id,
      qty_change, stock_before, stock_after, notes,
    } = payload;

    await client.query(
      `INSERT INTO tbl_stock_ledger (
          item_uuid, item_id, zodu_id, branch_id,
          item_name, transaction_type, reference_id,
          qty_change, stock_before, stock_after, notes
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        item_uuid, item_id, zodu_id, branch_id,
        item_name,
        'SALE_RETURN',
        reference_id,
        qty_change.toFixed(2),
        stock_before.toFixed(2),
        stock_after.toFixed(2),
        notes,
      ]
    );
  }

  // ── Transaction helpers ───────────────────────────────────

  async getClient() {
    return pool.connect();
  }
}

module.exports = {
  SaleReturnRepository,
};
