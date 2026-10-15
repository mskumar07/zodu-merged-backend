const { SaleReturnRepository } = require("../repository/saleReturn-repo");
const { generateReturnId } = require("../utils/generateId");
const {
  NotFoundError,
  ValidationError,
} = require("../utils/error/errors");

const repo = new SaleReturnRepository();

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// A return can end up refunded beyond what it is now worth (edited down after a
// refund was paid). That still counts as REFUNDED; the excess is reported by the
// callers, never hidden.
const refundStatusFor = (refundDue, refunded) => {
  if (refunded >= refundDue) return refundDue <= 0 && refunded <= 0 ? "NA" : "REFUNDED";
  return refunded <= 0 ? "PENDING" : "PARTIAL";
};

// Validates the requested lines against the original sale and prices them.
// `returnedQtyMap` must already exclude the return being edited, if any.
function buildReturnLines(items, originalById, returnedQtyMap) {
  let subtotal = 0;
  let totalTax = 0;
  const lines = [];

  for (const reqItem of items) {
    const orig = originalById.get(reqItem.original_item_id);

    if (!orig) {
      throw ValidationError(
        `Item id ${reqItem.original_item_id} does not belong to this sale`
      );
    }

    const maxReturnable = Number(orig.quantity) - (returnedQtyMap.get(orig.id) ?? 0);

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

    lines.push({
      original_item_id: orig.id,
      item_id: orig.item_id,
      item_name: orig.item_name,
      description: orig.description ?? null,
      unit: orig.unit,
      return_qty: reqItem.return_qty,
      original_qty: Number(orig.quantity),
      price: Number(orig.price),
      tax_amount: lineTax,
      gst_percentage: orig.gst_percentage,
      hsn_code: orig.hsn_code,
    });
  }

  return { lines, subtotal, totalTax };
}

// Splits a return into "reduces what the customer still owes" and "cash we owe
// the customer". balance_amount is total - paid and ignores returns, so the other
// returns on the invoice are subtracted (same maths as the sales-history balance).
function splitReturnAmount(sale, returnAmount, otherReturned) {
  const dueBefore = Math.max(round2(Number(sale.balance_amount) - otherReturned), 0);
  const adjustedAmount = round2(Math.min(returnAmount, dueBefore));
  return { adjustedAmount, refundDue: round2(returnAmount - adjustedAmount) };
}

// Sums quantities per item_id; one item can sit on several sale lines.
function qtyByItemId(rows, qtyKey) {
  const map = new Map();
  for (const row of rows) {
    map.set(row.item_id, (map.get(row.item_id) ?? 0) + Number(row[qtyKey]));
  }
  return map;
}

// Moves stock by a signed quantity per item (+ in, - out) and writes one ledger
// entry per item that actually changed. Rows are locked in item order inside one
// query, then updated and logged with one statement each.
async function applyStockDelta(client, { zodu_id, branch_id, deltaByItem, nameByItem, reference_id, notes, transaction_type }) {
  const changed = [...deltaByItem].filter(([, delta]) => delta !== 0).map(([itemId]) => itemId);
  if (!changed.length) return;

  const inventories = await repo.findInventoriesForUpdate(client, changed, branch_id);
  if (!inventories.length) return;

  const updates = [];
  const entries = [];

  for (const inv of inventories) {
    const delta = deltaByItem.get(inv.item_id);
    const stockBefore = Number(inv.available_qty);
    const stockAfter = stockBefore + delta;

    updates.push({ inventory_uuid: inv.inventory_uuid, new_qty: stockAfter });
    entries.push({
      item_uuid: inv.item_uuid,
      item_id: inv.item_id,
      item_name: nameByItem.get(inv.item_id) ?? inv.item_name,
      qty_change: delta,
      stock_before: stockBefore,
      stock_after: stockAfter,
    });
  }

  await repo.bulkUpdateInventoryQty(client, updates);
  await repo.bulkInsertStockLedger(client, {
    zodu_id,
    branch_id,
    reference_id,
    notes,
    entries,
    transaction_type,
  });
}

async function createSaleReturn(dto) {
  const {
    original_sale_uuid,
    zodu_id,
    branch_id,
    return_type,
    return_reason,
    refund_type,
    refund_payment,
    notes,
    created_by,
    items,
  } = dto;

  const client = await repo.getClient();

  try {
    await client.query("BEGIN");

    const sale = await repo.findSaleByUuidForUpdate(client, original_sale_uuid, branch_id);
    if (!sale) {
      throw NotFoundError("Original sale not found");
    }

    const [originalItems, alreadyReturnedRows] = await Promise.all([
      repo.findSaleItemsBySaleUuid(client, original_sale_uuid),
      repo.findAlreadyReturnedQtys(client, original_sale_uuid),
    ]);

    if (!originalItems.length) {
      throw NotFoundError("No items found for this sale");
    }

    const originalById = new Map(originalItems.map((item) => [item.id, item]));
    const returnedQtyMap = new Map(
      alreadyReturnedRows.map((row) => [Number(row.original_item_id), Number(row.returned_qty)])
    );

    const { lines, subtotal, totalTax } = buildReturnLines(items, originalById, returnedQtyMap);

    const returnAmount = round2(subtotal);
    const otherReturned = Number(sale.returned_total);
    const { adjustedAmount, refundDue } = splitReturnAmount(sale, returnAmount, otherReturned);

    // Optional immediate refund. Anything not paid now stays PENDING and is paid
    // later through recordRefund.
    const refundNow = refundDue > 0 && refund_payment
      ? round2(Math.min(refund_payment.amount ?? refundDue, refundDue))
      : 0;

    const returnId = generateReturnId();
    const returnRow = await repo.insertSaleReturn(client, {
      return_id: returnId,
      original_sale_uuid: sale.sale_uuid,
      original_sale_id: sale.sale_id,
      zodu_id,
      branch_id,
      customer_id: sale.customer_uuid,
      return_reason,
      total_items: lines.length,
      subtotal,
      total_tax: totalTax,
      return_amount: returnAmount,
      refund_type: refund_type || null,
      notes,
      created_by,
      return_type,
      adjusted_amount: adjustedAmount,
      refund_due: refundDue,
      refund_status: refundStatusFor(refundDue, 0),
    });

    await repo.insertSaleReturnItems(client, returnRow.return_uuid, lines);

    // Stock goes back for both Sales Return and Credit Note.
    await applyStockDelta(client, {
      zodu_id,
      branch_id,
      deltaByItem: qtyByItemId(lines, "return_qty"),
      nameByItem: new Map(lines.map((l) => [l.item_id, l.item_name])),
      reference_id: returnRow.return_uuid,
      notes: `Return ${returnId} - original sale ${sale.sale_id}`,
      transaction_type: "SALE_RETURN",
    });

    // A return that clears what a part-paid invoice still owed settles it, so it
    // stops showing Mark Payment.
    await repo.syncSalePaymentStatus(client, sale.sale_uuid, otherReturned + returnAmount);

    let refundRow = null;
    let refundStatus = returnRow.refund_status;
    if (refundNow > 0) {
      refundRow = await repo.insertRefundPayment(client, {
        return_uuid: returnRow.return_uuid,
        zodu_id,
        branch_id,
        refund_amount: refundNow,
        payment_mode: refund_payment.payment_mode,
        reference_no: refund_payment.reference_no,
        refund_date: refund_payment.refund_date,
      });
      refundStatus = refundStatusFor(refundDue, refundNow);
      await repo.updateRefundProgress(client, returnRow.return_uuid, refundNow, refundStatus);
    }

    await client.query("COMMIT");

    return {
      return_uuid: returnRow.return_uuid,
      return_id: returnRow.return_id,
      return_type: returnRow.return_type,
      return_amount: returnRow.return_amount,
      adjusted_amount: adjustedAmount,
      refund_due: refundDue,
      refunded_amount: refundNow,
      refund_status: refundStatus,
      refund_type: returnRow.refund_type,
      return_date: returnRow.return_date,
      items_returned: lines.length,
      created_at: returnRow.created_at,
      refund: refundRow,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Replaces the items of an existing return with the submitted set (add an item,
// raise or lower a quantity, drop an item) keeping its id. Stock moves by the
// difference only. Refunds already paid are left as they are even if the return
// shrinks below them; the excess shows up as `excess_refund`.
async function updateSaleReturn(dto) {
  const {
    return_uuid,
    zodu_id,
    branch_id,
    return_type,
    return_reason,
    refund_type,
    notes,
    items,
  } = dto;

  const client = await repo.getClient();

  try {
    await client.query("BEGIN");

    // Same lock order as create/delete: sale, then the return, then stock.
    const saleUuid = await repo.findReturnSaleUuid(client, return_uuid, zodu_id, branch_id);
    if (!saleUuid) {
      throw NotFoundError("Sale return not found");
    }

    const sale = await repo.findSaleByUuidForUpdate(client, saleUuid, branch_id);
    const ret = await repo.findReturnForUpdate(client, return_uuid, zodu_id, branch_id);
    if (!sale || !ret) {
      throw NotFoundError("Sale return not found");
    }

    const [originalItems, otherReturnedRows, oldItems] = await Promise.all([
      repo.findSaleItemsBySaleUuid(client, saleUuid),
      repo.findAlreadyReturnedQtys(client, saleUuid, return_uuid),
      repo.findReturnItemQtys(client, return_uuid),
    ]);

    const originalById = new Map(originalItems.map((item) => [item.id, item]));
    const returnedQtyMap = new Map(
      otherReturnedRows.map((row) => [Number(row.original_item_id), Number(row.returned_qty)])
    );

    const { lines, subtotal, totalTax } = buildReturnLines(items, originalById, returnedQtyMap);

    const returnAmount = round2(subtotal);
    const otherReturned = Math.max(round2(Number(sale.returned_total) - Number(ret.return_amount)), 0);
    const { adjustedAmount, refundDue } = splitReturnAmount(sale, returnAmount, otherReturned);

    const refunded = Number(ret.refunded_amount);
    const refundStatus = refundStatusFor(refundDue, refunded);

    await repo.updateSaleReturn(client, {
      return_uuid,
      return_type,
      return_reason,
      refund_type: refund_type || null,
      notes,
      total_items: lines.length,
      subtotal,
      total_tax: totalTax,
      return_amount: returnAmount,
      adjusted_amount: adjustedAmount,
      refund_due: refundDue,
      refund_status: refundStatus,
    });

    await repo.deleteSaleReturnItems(client, return_uuid);
    await repo.insertSaleReturnItems(client, return_uuid, lines);

    // Net stock change = new quantities - old quantities, per item.
    const deltaByItem = qtyByItemId(lines, "return_qty");
    for (const [itemId, qty] of qtyByItemId(oldItems, "return_qty")) {
      deltaByItem.set(itemId, (deltaByItem.get(itemId) ?? 0) - qty);
    }
    const nameByItem = new Map([...oldItems, ...lines].map((r) => [r.item_id, r.item_name]));

    await applyStockDelta(client, {
      zodu_id,
      branch_id,
      deltaByItem,
      nameByItem,
      reference_id: return_uuid,
      notes: `Return ${ret.return_id} edited - original sale ${ret.original_sale_id}`,
      transaction_type: "SALE_RETURN_EDITED",
    });

    await repo.syncSalePaymentStatus(client, saleUuid, otherReturned + returnAmount);

    await client.query("COMMIT");

    return {
      return_uuid,
      return_id: ret.return_id,
      return_amount: returnAmount,
      adjusted_amount: adjustedAmount,
      refund_due: refundDue,
      refunded_amount: refunded,
      pending_refund: Math.max(round2(refundDue - refunded), 0),
      excess_refund: Math.max(round2(refunded - refundDue), 0),
      refund_status: refundStatus,
      items_returned: lines.length,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Pays out (part of) the cash owed on a return. Callable repeatedly until
// refund_due is fully refunded.
async function recordRefund(dto) {
  const { return_uuid, zodu_id, branch_id, refund_amount, payment_mode, reference_no, refund_date } = dto;

  const client = await repo.getClient();

  try {
    await client.query("BEGIN");

    const ret = await repo.findReturnForUpdate(client, return_uuid, zodu_id, branch_id);
    if (!ret) {
      throw NotFoundError("Sale return not found");
    }

    const refundDue = Number(ret.refund_due);
    const outstanding = round2(refundDue - Number(ret.refunded_amount));

    if (outstanding <= 0) {
      throw ValidationError("No refund is pending for this return");
    }
    if (refund_amount > outstanding) {
      throw ValidationError(`Refund amount exceeds the pending refund of ${outstanding.toFixed(2)}`);
    }

    const payment = await repo.insertRefundPayment(client, {
      return_uuid, zodu_id, branch_id, refund_amount, payment_mode, reference_no, refund_date,
    });

    const refundedAmount = round2(Number(ret.refunded_amount) + refund_amount);
    const refundStatus = refundStatusFor(refundDue, refundedAmount);
    await repo.updateRefundProgress(client, return_uuid, refundedAmount, refundStatus);

    await client.query("COMMIT");

    return {
      return_uuid,
      return_id: ret.return_id,
      refund_due: refundDue,
      refunded_amount: refundedAmount,
      pending_refund: round2(refundDue - refundedAmount),
      refund_status: refundStatus,
      payment,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Fully reverses a return: stock goes back out, the refund payments recorded
// against it are removed (they cascade with the return row), and the invoice
// status is recomputed from what is still owed.
async function deleteSaleReturn(dto) {
  const { return_uuid, zodu_id, branch_id } = dto;

  const client = await repo.getClient();

  try {
    await client.query("BEGIN");

    const saleUuid = await repo.findReturnSaleUuid(client, return_uuid, zodu_id, branch_id);
    if (!saleUuid) {
      throw NotFoundError("Sale return not found");
    }

    const sale = await repo.findSaleByUuidForUpdate(client, saleUuid, branch_id);
    const ret = await repo.findReturnForUpdate(client, return_uuid, zodu_id, branch_id);
    if (!sale || !ret) {
      throw NotFoundError("Sale return not found");
    }

    const returnedItems = await repo.findReturnItemQtys(client, return_uuid);
    const deltaByItem = new Map(
      [...qtyByItemId(returnedItems, "return_qty")].map(([itemId, qty]) => [itemId, -qty])
    );

    await applyStockDelta(client, {
      zodu_id,
      branch_id,
      deltaByItem,
      nameByItem: new Map(returnedItems.map((r) => [r.item_id, r.item_name])),
      reference_id: ret.return_uuid,
      notes: `Stock reversed on deletion of return ${ret.return_id} - original sale ${ret.original_sale_id}`,
      transaction_type: "SALE_RETURN_DELETED",
    });

    await repo.deleteSaleReturn(client, return_uuid);

    const remainingReturned = Math.max(
      round2(Number(sale.returned_total) - Number(ret.return_amount)),
      0
    );
    await repo.syncSalePaymentStatus(client, sale.sale_uuid, remainingReturned);

    await client.query("COMMIT");

    return {
      return_uuid,
      return_id: ret.return_id,
      original_sale_id: ret.original_sale_id,
      return_amount: Number(ret.return_amount),
      refund_reversed: Number(ret.refunded_amount),
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
  updateSaleReturn,
  recordRefund,
  deleteSaleReturn,
};
