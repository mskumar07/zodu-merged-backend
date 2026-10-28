const repo = require("../repository/purchaseReturn-repo");
const pool = require("../database/connection");
const { generatePurchaseReturnId } = require("../utils/generateId");
const { NotFoundError, ValidationError } = require("../utils/error/errors");

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// A return can end up refunded beyond what it is now worth (edited down after a
// refund was received). That still counts as REFUNDED; the excess is reported,
// never hidden.
const refundStatusFor = (refundDue, refunded) => {
  if (refunded >= refundDue) return refundDue <= 0 && refunded <= 0 ? "NA" : "REFUNDED";
  return refunded <= 0 ? "PENDING" : "PARTIAL";
};

// Validates the requested lines against the purchase and prices them. Everything
// is taken from the purchase line (name, unit, price, GST) and rounded per line,
// so the document totals are exactly the sum of its lines. A purchase price is
// tax-exclusive: the line value is qty x price and the stored line tax is added on
// top, pro-rated by quantity. `returnedQtyMap` must already exclude the return
// being edited, if any.
function buildReturnLines(items, purchaseItems, returnedQtyMap) {
  const byId = new Map(purchaseItems.map((item) => [item.purchase_item_id, item]));
  const lines = [];
  let subtotal = 0;
  let totalTax = 0;

  for (const req of items) {
    const orig = byId.get(req.original_item_id);
    if (!orig) {
      throw ValidationError(`Item id ${req.original_item_id} does not belong to this purchase`);
    }

    const maxReturnable = Number(orig.qty) - (returnedQtyMap.get(orig.purchase_item_id) ?? 0);
    if (maxReturnable <= 0) {
      throw ValidationError(`Item "${orig.item_name}" has already been fully returned`);
    }
    if (req.return_qty > maxReturnable) {
      throw ValidationError(
        `Return qty ${req.return_qty} exceeds max returnable ${maxReturnable} for item "${orig.item_name}"`
      );
    }

    const taxable = round2(req.return_qty * Number(orig.purchase_price));
    const gstPct = Number(orig.gst_percentage) || 0;
    const tax = round2(
      orig.tax_amount != null
        ? (Number(orig.tax_amount) * req.return_qty) / Number(orig.qty)
        : (taxable * gstPct) / 100
    );
    const cgst = round2(tax / 2);

    subtotal += taxable;
    totalTax += tax;

    lines.push({
      original_item_id: orig.purchase_item_id,
      item_id: orig.item_id,
      item_uuid: orig.item_uuid,
      item_name: orig.item_name,
      unit: orig.unit,
      hsn_code: orig.hsn_code,
      gst_percentage: orig.gst_percentage,
      purchase_price: Number(orig.purchase_price),
      original_qty: Number(orig.qty),
      return_qty: req.return_qty,
      taxable_amount: taxable,
      tax_amount: tax,
      cgst,
      sgst: round2(tax - cgst),
    });
  }

  subtotal = round2(subtotal);
  totalTax = round2(totalTax);
  return { lines, subtotal, totalTax, total: round2(subtotal + totalTax) };
}

// Splits the return into "reduces what we still owe the vendor" and "cash the
// vendor owes us". balance_amount is total - paid and ignores returns, so the
// other returns on the purchase are subtracted.
function splitReturnAmount(purchase, returnAmount, otherReturned) {
  const dueBefore = Math.max(round2(Number(purchase.balance_amount) - otherReturned), 0);
  const adjustedAmount = round2(Math.min(returnAmount, dueBefore));
  return { adjustedAmount, refundDue: round2(returnAmount - adjustedAmount) };
}

// Sums quantities per item_uuid; one item can sit on several purchase lines. Lines
// with no item_uuid have nothing to move in stock.
function qtyByItemUuid(rows, qtyKey) {
  const map = new Map();
  for (const row of rows) {
    if (!row.item_uuid) continue;
    map.set(row.item_uuid, (map.get(row.item_uuid) ?? 0) + Number(row[qtyKey]));
  }
  return map;
}

// Moves stock by a signed quantity per item (+ in, - out) and writes one ledger
// entry per item that changed: one lock query, one update, one insert. Stock is
// allowed to go below zero, like the rest of the system.
async function applyStockDelta(client, { zodu_id, branch_id, deltaByItem, nameByItem, reference_id, notes, transaction_type }) {
  const changed = [...deltaByItem].filter(([, delta]) => delta !== 0).map(([uuid]) => uuid);
  if (!changed.length) return;

  const inventories = await repo.findInventoriesForUpdate(client, changed, branch_id);
  if (!inventories.length) return;

  const updates = [];
  const entries = [];

  for (const inv of inventories) {
    const delta = deltaByItem.get(inv.item_uuid);
    const stockBefore = Number(inv.available_qty);
    const stockAfter = stockBefore + delta;

    updates.push({ inventory_uuid: inv.inventory_uuid, new_qty: stockAfter });
    entries.push({
      item_uuid: inv.item_uuid,
      item_id: inv.item_id,
      item_name: nameByItem.get(inv.item_uuid) ?? inv.item_name,
      qty_change: delta,
      stock_before: stockBefore,
      stock_after: stockAfter,
    });
  }

  await repo.bulkUpdateInventoryQty(client, updates);
  await repo.bulkInsertStockLedger(client, { zodu_id, branch_id, reference_id, notes, entries, transaction_type });
}

async function inTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// return_date is a YYYY-MM-DD string (Joi .raw()), so a string compare is a date compare.
function assertReturnDateNotBeforePurchase(return_date, purchase) {
  if (return_date && purchase.purchase_date_iso && String(return_date).slice(0, 10) < purchase.purchase_date_iso) {
    throw ValidationError(`Return date cannot be before the purchase date (${purchase.purchase_date_iso})`);
  }
}

// Locks the purchase, then the return (same order everywhere, so two writes on the
// same purchase can never deadlock), and returns both.
async function lockPurchaseAndReturn(client, { return_uuid, zodu_id, branch_id }) {
  const purchaseId = await repo.findReturnPurchaseId(client, return_uuid, zodu_id, branch_id);
  if (!purchaseId) throw NotFoundError("Purchase return not found");

  const purchase = await repo.findPurchaseForUpdate(client, purchaseId, zodu_id, branch_id);
  const ret = await repo.findReturnForUpdate(client, return_uuid, zodu_id, branch_id);
  if (!purchase || !ret) throw NotFoundError("Purchase return not found");

  return { purchase, ret };
}

async function createPurchaseReturn(dto) {
  const {
    original_purchase_id, zodu_id, branch_id, return_type = "PURCHASE_RETURN", return_reason,
    refund_type, refund_payment, notes, created_by, items,return_date
  } = dto;

  return inTransaction(async (client) => {
    const purchase = await repo.findPurchaseForUpdate(client, original_purchase_id, zodu_id, branch_id);
    if (!purchase) throw NotFoundError("Original purchase not found");
    if (purchase.cancelled_purchase) throw ValidationError("This purchase is cancelled");
    assertReturnDateNotBeforePurchase(return_date, purchase);

    const [purchaseItems, returnedRows] = await Promise.all([
      repo.findPurchaseItems(client, original_purchase_id, zodu_id, branch_id),
      repo.findReturnedQtys(client, original_purchase_id, zodu_id),
    ]);
    if (!purchaseItems.length) throw NotFoundError("No items found for this purchase");

    const returnedQtyMap = new Map(returnedRows.map((r) => [Number(r.original_item_id), Number(r.returned_qty)]));
    const { lines, subtotal, totalTax, total } = buildReturnLines(items, purchaseItems, returnedQtyMap);

    const otherReturned = Number(purchase.returned_total);
    const { adjustedAmount, refundDue } = splitReturnAmount(purchase, total, otherReturned);

    // Optional refund received at the same time; anything not received now stays
    // PENDING and is recorded later through recordRefund.
    const refundNow = refundDue > 0 && refund_payment
      ? round2(Math.min(refund_payment.amount ?? refundDue, refundDue))
      : 0;
    const refundStatus = refundStatusFor(refundDue, refundNow);

    const returnId = generatePurchaseReturnId();
    const row = await repo.insertReturn(client, {
      return_id: returnId, return_type, zodu_id, branch_id, original_purchase_id,
      return_reason, notes, refund_type: refund_type || null,
      subtotal, total_tax: totalTax, return_amount: total,
      adjusted_amount: adjustedAmount, refund_due: refundDue,
      refunded_amount: refundNow, refund_status: refundStatus,
      created_by,return_date: return_date
    });

    await repo.insertItems(client, row.return_uuid, lines);

    // Both Purchase Return and Debit Note take the goods back out of stock.
    await applyStockDelta(client, {
      zodu_id, branch_id,
      deltaByItem: new Map([...qtyByItemUuid(lines, "return_qty")].map(([uuid, qty]) => [uuid, -qty])),
      nameByItem: new Map(lines.filter((l) => l.item_uuid).map((l) => [l.item_uuid, l.item_name])),
      reference_id: row.return_uuid,
      notes: `Purchase return ${returnId} - purchase ${original_purchase_id}`,
      transaction_type: "PURCHASE_RETURN",
    });

    await repo.syncPurchasePaymentStatus(client, original_purchase_id, zodu_id, otherReturned + total);

    let refund = null;
    if (refundNow > 0) {
      refund = await repo.insertRefund(client, {
        return_uuid: row.return_uuid, zodu_id, branch_id,
        refund_amount: refundNow,
        payment_mode: refund_payment.payment_mode,
        reference_no: refund_payment.reference_no,
        refund_date: refund_payment.refund_date,
      });
    }

    return {
      return_uuid: row.return_uuid,
      return_id: row.return_id,
      return_type: row.return_type,
      return_amount: Number(row.return_amount),
      adjusted_amount: adjustedAmount,
      refund_due: refundDue,
      refunded_amount: refundNow,
      refund_status: refundStatus,
      refund_type: row.refund_type,
      return_date: row.return_date,
      items_returned: lines.length,
      created_at: row.created_at,
      refund,
    };
  });
}

// Replaces the items of an existing return (add an item, change a quantity, drop an
// item), keeping its id. Stock moves by the difference only. Refunds already
// received stay recorded even if the return shrinks below them; the difference
// shows up as `excess_refund`.
async function updatePurchaseReturn(dto) {
  const { return_uuid, zodu_id, branch_id, return_type, return_reason, refund_type, notes, items,return_date } = dto;

  return inTransaction(async (client) => {
    const { purchase, ret } = await lockPurchaseAndReturn(client, { return_uuid, zodu_id, branch_id });
    const purchaseId = purchase.purchase_id;
    assertReturnDateNotBeforePurchase(return_date, purchase);

    const [purchaseItems, otherReturnedRows, oldItems] = await Promise.all([
      repo.findPurchaseItems(client, purchaseId, zodu_id, branch_id),
      repo.findReturnedQtys(client, purchaseId, zodu_id, return_uuid),
      repo.findReturnItemQtys(client, return_uuid),
    ]);

    const returnedQtyMap = new Map(otherReturnedRows.map((r) => [Number(r.original_item_id), Number(r.returned_qty)]));
    const { lines, subtotal, totalTax, total } = buildReturnLines(items, purchaseItems, returnedQtyMap);

    const otherReturned = Math.max(round2(Number(purchase.returned_total) - Number(ret.return_amount)), 0);
    const { adjustedAmount, refundDue } = splitReturnAmount(purchase, total, otherReturned);

    const refunded = Number(ret.refunded_amount);
    const refundStatus = refundStatusFor(refundDue, refunded);

    await repo.updateReturn(client, {
      return_uuid, return_type, return_reason, notes, refund_type, return_date,
      subtotal, total_tax: totalTax, return_amount: total,
      adjusted_amount: adjustedAmount, refund_due: refundDue, refund_status: refundStatus,
    });

    await repo.deleteItems(client, return_uuid);
    await repo.insertItems(client, return_uuid, lines);

    // Net stock change: goods out for the new quantities, goods back in for the old.
    const deltaByItem = new Map([...qtyByItemUuid(lines, "return_qty")].map(([uuid, qty]) => [uuid, -qty]));
    for (const [uuid, qty] of qtyByItemUuid(oldItems, "return_qty")) {
      deltaByItem.set(uuid, (deltaByItem.get(uuid) ?? 0) + qty);
    }
    await applyStockDelta(client, {
      zodu_id, branch_id, deltaByItem,
      nameByItem: new Map([...oldItems, ...lines].filter((r) => r.item_uuid).map((r) => [r.item_uuid, r.item_name])),
      reference_id: return_uuid,
      notes: `Purchase return ${ret.return_id} edited - purchase ${purchaseId}`,
      transaction_type: "PURCHASE_RETURN_EDITED",
    });

    await repo.syncPurchasePaymentStatus(client, purchaseId, zodu_id, otherReturned + total);

    return {
      return_uuid,
      return_id: ret.return_id,
      return_amount: total,
      adjusted_amount: adjustedAmount,
      refund_due: refundDue,
      refunded_amount: refunded,
      pending_refund: Math.max(round2(refundDue - refunded), 0),
      excess_refund: Math.max(round2(refunded - refundDue), 0),
      refund_status: refundStatus,
      items_returned: lines.length,
    };
  });
}

// Records (part of) the refund the vendor still owes. Callable repeatedly until
// refund_due is fully received.
async function recordRefund(dto) {
  const { return_uuid, zodu_id, branch_id, refund_amount, payment_mode, reference_no, refund_date } = dto;

  return inTransaction(async (client) => {
    const ret = await repo.findReturnForUpdate(client, return_uuid, zodu_id, branch_id);
    if (!ret) throw NotFoundError("Purchase return not found");

    const refundDue = Number(ret.refund_due);
    const outstanding = round2(refundDue - Number(ret.refunded_amount));

    if (outstanding <= 0) throw ValidationError("No refund is pending for this return");
    if (refund_amount > outstanding) {
      throw ValidationError(`Refund amount exceeds the pending refund of ${outstanding.toFixed(2)}`);
    }

    // refund_date is a YYYY-MM-DD string (Joi .raw()), so a string compare is a date compare.
    if (refund_date && ret.return_date_iso && String(refund_date).slice(0, 10) < ret.return_date_iso) {
      throw ValidationError(`Refund date cannot be before the return date (${ret.return_date_iso})`);
    }

    const payment = await repo.insertRefund(client, {
      return_uuid, zodu_id, branch_id, refund_amount, payment_mode, reference_no, refund_date,
    });

    const refundedAmount = round2(Number(ret.refunded_amount) + refund_amount);
    const refundStatus = refundStatusFor(refundDue, refundedAmount);
    await repo.updateRefundProgress(client, return_uuid, refundedAmount, refundStatus);

    return {
      return_uuid,
      return_id: ret.return_id,
      refund_due: refundDue,
      refunded_amount: refundedAmount,
      pending_refund: round2(refundDue - refundedAmount),
      refund_status: refundStatus,
      payment,
    };
  });
}

// Fully reverses a return: the goods come back into stock, the refund payments
// recorded against it are removed (they cascade with the return row), and the
// purchase's payment label is recomputed from what is still owed.
async function deletePurchaseReturn(dto) {
  const { return_uuid, zodu_id, branch_id } = dto;

  return inTransaction(async (client) => {
    const { purchase, ret } = await lockPurchaseAndReturn(client, { return_uuid, zodu_id, branch_id });

    const returnedItems = await repo.findReturnItemQtys(client, return_uuid);
    await applyStockDelta(client, {
      zodu_id, branch_id,
      deltaByItem: qtyByItemUuid(returnedItems, "return_qty"),
      nameByItem: new Map(returnedItems.map((r) => [r.item_uuid, r.item_name])),
      reference_id: return_uuid,
      notes: `Stock restored on deletion of return ${ret.return_id} - purchase ${purchase.purchase_id}`,
      transaction_type: "PURCHASE_RETURN_DELETED",
    });

    await repo.deleteReturn(client, return_uuid);

    const remaining = Math.max(round2(Number(purchase.returned_total) - Number(ret.return_amount)), 0);
    await repo.syncPurchasePaymentStatus(client, purchase.purchase_id, zodu_id, remaining);

    return {
      return_uuid,
      return_id: ret.return_id,
      original_purchase_id: ret.original_purchase_id,
      return_amount: Number(ret.return_amount),
      refund_reversed: Number(ret.refunded_amount),
    };
  });
}

// One return for the details dialog; the totals are already worked out in SQL.
async function getPurchaseReturnDetail({ return_uuid, zodu_id, branch_id }) {
  const row = await repo.getReturnDetail(return_uuid, zodu_id, branch_id);
  if (!row) throw NotFoundError("Purchase return not found");

  return {
    return: {
      return_uuid: row.return_uuid,
      return_id: row.return_id,
      return_type: row.return_type,
      original_purchase_id: row.original_purchase_id,
      invoice_bill_no: row.invoice_bill_no,
      purchase_date_fmt: row.purchase_date_fmt,
      return_reason: row.return_reason,
      notes: row.notes,
      refund_type: row.refund_type,
      refund_status: row.refund_status,
      return_date_fmt: row.return_date_fmt,
      created_at_fmt: row.created_at_fmt,
    },
    vendor: {
      vendor_name: row.vendor_name,
      company_name: row.company_name,
      phone: row.vendor_phone,
      gst: row.vendor_gst,
      address_line1: row.vendor_address_1,
      address_line2: row.vendor_address_2,
      city: row.city,
      state: row.state,
      pincode: row.pincode,
    },
    items: row.items,
    summary: {
      subtotal: Number(row.subtotal),
      cgst: Number(row.cgst),
      sgst: Number(row.sgst),
      total_tax: Number(row.total_tax),
      return_total: Number(row.return_amount),
      adjusted_amount: Number(row.adjusted_amount),
      refund_due: Number(row.refund_due),
      refunded_amount: Number(row.refunded_amount),
      pending_refund: Number(row.pending_refund),
      excess_refund: Number(row.excess_refund),
    },
    refunds: row.refunds,
  };
}

module.exports = {
  createPurchaseReturn,
  updatePurchaseReturn,
  recordRefund,
  deletePurchaseReturn,
  getPurchaseReturnDetail,
};
