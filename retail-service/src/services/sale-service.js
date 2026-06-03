const { SaleReturnRepository } = require("../repository/saleReturn-repo");
const { generateReturnId } = require("../utils/generateId");
const {
  NotFoundError,
  ValidationError,
} = require("../utils/error/errors");

const repo = new SaleReturnRepository();

async function createSaleReturn(dto) {
  const {
    original_sale_uuid,
    zodu_id,
    branch_id,
    return_reason,
    refund_type,
    notes,
    created_by,
    items,
  } = dto;

  const client = await repo.getClient();

  try {
    await client.query("BEGIN");

    const sale = await repo.findSaleByUuidForUpdate(
      client,
      original_sale_uuid,
      branch_id
    );

    if (!sale) {
      throw NotFoundError("Original sale not found");
    }

    const originalItems = await repo.findSaleItemsBySaleUuid(
      client,
      original_sale_uuid
    );

    if (!originalItems.length) {
      throw NotFoundError("No items found for this sale");
    }

    const alreadyReturnedRows = await repo.findAlreadyReturnedQtys(
      client,
      original_sale_uuid
    );

    const returnedQtyMap = Object.fromEntries(
      alreadyReturnedRows.map((row) => [
        Number(row.original_item_id),
        Number(row.returned_qty),
      ])
    );

    let subtotal = 0;
    let totalTax = 0;
    const validatedLines = [];

    for (const reqItem of items) {
      const orig = originalItems.find((item) => item.id === reqItem.original_item_id);

      if (!orig) {
        throw ValidationError(
          `Item id ${reqItem.original_item_id} does not belong to this sale`
        );
      }

      const alreadyReturned = returnedQtyMap[orig.id] ?? 0;
      const maxReturnable = Number(orig.quantity) - alreadyReturned;

      if (maxReturnable <= 0) {
        throw ValidationError(
          `Item "${orig.item_name}" has already been fully returned`
        );
      }

      if (reqItem.return_qty > maxReturnable) {
        throw ValidationError(
          `Return qty ${reqItem.return_qty} exceeds max returnable ${maxReturnable} for item "${orig.item_name}"`
        );
      }

      const lineSubtotal = reqItem.return_qty * Number(orig.price);
      const gstPct = Number(orig.gst_percentage) || 0;
      const lineTax = orig.tax_inclusive
        ? lineSubtotal - lineSubtotal / (1 + gstPct / 100)
        : (lineSubtotal * gstPct) / 100;

      subtotal += lineSubtotal;
      totalTax += lineTax;

      validatedLines.push({
        original_item_id: orig.id,
        item_id: orig.item_id,
        item_uuid: reqItem.item_uuid,
        item_name: orig.item_name,
        unit: orig.unit,
        return_qty: reqItem.return_qty,
        original_qty: Number(orig.quantity),
        price: Number(orig.price),
        tax_amount: lineTax,
        gst_percentage: orig.gst_percentage,
        hsn_code: orig.hsn_code,
      });
    }

    const returnId = generateReturnId();
    const returnRow = await repo.insertSaleReturn(client, {
      return_id: returnId,
      original_sale_uuid: sale.sale_uuid,
      original_sale_id: sale.sale_id,
      zodu_id,
      branch_id,
      customer_id: sale.customer_uuid,
      return_reason,
      total_items: validatedLines.length,
      subtotal,
      total_tax: totalTax,
      return_amount: subtotal,
      refund_type,
      notes,
      created_by,
    });

    for (const line of validatedLines) {
      await repo.insertSaleReturnItem(client, {
        return_uuid: returnRow.return_uuid,
        original_item_id: line.original_item_id,
        item_id: line.item_id,
        item_name: line.item_name,
        unit: line.unit,
        return_qty: line.return_qty,
        original_qty: line.original_qty,
        price: line.price,
        tax_amount: line.tax_amount,
        gst_percentage: line.gst_percentage,
        hsn_code: line.hsn_code,
      });

      const inv = await repo.findInventoryForUpdate(client, line.item_id, branch_id);

      if (inv) {
        const stockBefore = Number(inv.available_qty);
        const stockAfter = stockBefore + line.return_qty;

        await repo.updateInventoryQty(client, inv.inventory_uuid, stockAfter);

        await repo.insertStockLedger(client, {
          item_uuid: inv.item_uuid,
          item_id: line.item_id,
          zodu_id,
          branch_id,
          item_name: line.item_name,
          reference_id: returnRow.return_uuid,
          qty_change: line.return_qty,
          stock_before: stockBefore,
          stock_after: stockAfter,
          notes: `Return ${returnId} - original sale ${sale.sale_id}`,
        });
      }
    }

    await client.query("COMMIT");

    return {
      return_uuid: returnRow.return_uuid,
      return_id: returnRow.return_id,
      return_amount: returnRow.return_amount,
      refund_type: returnRow.refund_type,
      return_date: returnRow.return_date,
      items_returned: validatedLines.length,
      created_at: returnRow.created_at,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  createSaleReturn,
};
