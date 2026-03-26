const conn = require("../database/connection");
const repo = require("../repository/purchase-repo");
const inventoryRepo = require("../repository/menu-repo");

// Must use `client` so stock updates stay inside the same transaction
const adjustStockWithLedger = async (client, payload) => {
  let current = await inventoryRepo.getInventoryByItemUuid(
    client,
    payload.item_uuid
  );

  // ── Auto-create inventory row if it doesn't exist yet ──────
  if (!current) {
    const existing = await client.query(
      `SELECT * FROM tbl_inventory WHERE item_uuid = $1`,
      [payload.item_uuid]
    );

    if (existing.rows.length === 0) {
      const inserted = await client.query(
        `INSERT INTO tbl_inventory (
          item_uuid, item_id, item_name,
          zodu_id, branch_id,
          available_qty, reorder_level
        )
        VALUES ($1, $2, $3, $4, $5, 0, 0)
        RETURNING *`,
        [
          payload.item_uuid,
          payload.item_id,
          payload.item_name,
          payload.zodu_id,
          payload.branch_id,
        ]
      );
      current = inserted.rows[0];
    } else {
      current = existing.rows[0];
    }
  }

  if (!current) {
    throw new Error(
      `Failed to find or create inventory record for item_uuid: ${payload.item_uuid}`
    );
  }

  const operator = payload.adjustment_type === "subtract" ? "-" : "+";

  const updated = await client.query(
    `UPDATE tbl_inventory
     SET available_qty = available_qty ${operator} $1,
         last_stock_update = NOW()
     WHERE item_uuid = $2
     RETURNING *`,
    [payload.adjustment_qty, payload.item_uuid]
  );

  const newStock = updated.rows[0];

  await inventoryRepo.createStockLedger(client, {
    item_uuid:        payload.item_uuid,
    item_id:          current.item_id,
    zodu_id:          current.zodu_id,
    branch_id:        current.branch_id,
    item_name:        current.item_name,
    transaction_type: payload.reason,
    reference_id:     payload.reference_id,
    qty_change:
      payload.adjustment_type === "subtract"
        ? -payload.adjustment_qty
        : payload.adjustment_qty,
    stock_before: current.available_qty,
    stock_after:  newStock.available_qty,
  });
};

// ─────────────────────────────────────────────────────────────
// CREATE PURCHASE
// ─────────────────────────────────────────────────────────────
exports.createPurchase = async (data) => {
  const client = await conn.connect();
  try {
    await client.query("BEGIN");

    const purchase_id = "PUR-" + Date.now();

    const purchase = await repo.createPurchase(client, {
      ...data,
      purchase_id,
    });

    await repo.createPurchaseItems(client, data.items, purchase_id);

    // Add stock for each purchased item
    for (const item of data.items) {
      await adjustStockWithLedger(client, {
        item_uuid:       item.item_uuid,
        item_id:         item.item_id,
        item_name:       item.item_name,
        zodu_id:         data.zodu_id,
        branch_id:       data.branch_id,
        adjustment_type: "add",
        adjustment_qty:  item.qty,
        reason:          "purchase",
        reference_id:    purchase.id,  // ✅ fixed: was purchase.purchase_id
      });
    }

    // Record payment if an upfront amount was provided
    if (data.paid_amount && data.paid_amount > 0) {
      await repo.createPurchasePayment(client, {
        purchase_id,
        zodu_id:          data.zodu_id,
        branch_id:        data.branch_id,
        payment_date:     data.purchase_date,
        paid_amount:      data.paid_amount,
        transaction_type: data.transaction_type || "cash",
        transaction_id:   data.transaction_id  || null,
        status:           "completed",
      });
    }

    await client.query("COMMIT");
    return { success: true, data: purchase };
  } catch (err) {
    await client.query("ROLLBACK");
    console.log(err);
    return { success: false, message: err.message };
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────
// GET ALL
// ─────────────────────────────────────────────────────────────
exports.getPurchases = async (params = {}) => {
  const data = await repo.getPurchases(params);
  return { success: true, data };
};

// ─────────────────────────────────────────────────────────────
// GET ONE
// ─────────────────────────────────────────────────────────────
exports.getPurchaseById = async (id, params = {}) => {
  const data = await repo.getPurchaseById(id, params);
  if (!data) return { success: false, message: "Not found" };
  return { success: true, data };
};

// ─────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────
exports.getPurchaseSummary = async ({ zodu_id, branch_id }) => {
  try {
    const { rows } = await conn.query(
      `SELECT
         COUNT(*)::text                                          AS total_purchase_count,
         COALESCE(SUM(paid_amount),    0)::text                 AS total_paid_amount,
         COALESCE(SUM(balance_amount), 0)::text                 AS total_unpaid_amount,
         COALESCE(SUM(
           CASE
             WHEN DATE_TRUNC('month', purchase_date) = DATE_TRUNC('month', CURRENT_DATE)
             THEN total_amount ELSE 0
           END
         ), 0)::text                                            AS this_month_spent,
         COALESCE(SUM(
           CASE
             WHEN DATE_TRUNC('month', purchase_date) = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
             THEN total_amount ELSE 0
           END
         ), 0)::text                                            AS last_month_spent
       FROM tbl_purchase
       WHERE zodu_id = $1 AND branch_id = $2`,
      [zodu_id, branch_id]
    );
    return { success: true, data: rows[0] };
  } catch (err) {
    return { success: false, message: err.message };
  }
};
// ─────────────────────────────────────────────────────────────
// UPDATE PURCHASE (WITH STOCK REVERSAL)
// ─────────────────────────────────────────────────────────────
exports.updatePurchase = async (purchase_id, data) => {
  const client = await conn.connect();
  console.log(data)
  try {
    await client.query("BEGIN");

    const oldPurchase = await repo.getPurchaseByIdForUpdate(client, purchase_id);
    if (!oldPurchase) {
      await client.query("ROLLBACK");
      return { success: false, message: "Purchase not found" };
    }

    const oldItems = await repo.getPurchaseItems(client, purchase_id);

    // Reverse stock for old items
    for (const item of oldItems) {
      await adjustStockWithLedger(client, {
        item_uuid:       item.item_uuid,
        item_id:         item.item_id,
        item_name:       item.item_name,
        zodu_id:         oldPurchase.zodu_id,
        branch_id:       oldPurchase.branch_id,
        adjustment_type: "subtract",
        adjustment_qty:  item.qty,
        reason:          "purchase_edit_reverse",
        reference_id:    oldPurchase.id,  // ✅ uuid
      });
    }

    await repo.deletePurchaseItems(client, purchase_id);
    await repo.updatePurchase(client, purchase_id, data);
    await repo.createPurchaseItems(client, data.items, purchase_id);

    // Apply stock for new items
    for (const item of data.items) {
      await adjustStockWithLedger(client, {
        item_uuid:       item.item_uuid,
        item_id:         item.item_id,
        item_name:       item.item_name,
        zodu_id:         data.zodu_id   || oldPurchase.zodu_id,
        branch_id:       data.branch_id || oldPurchase.branch_id,
        adjustment_type: "add",
        adjustment_qty:  item.qty,
        reason:          "purchase_edit_add",
        reference_id:    oldPurchase.id,  // ✅ uuid
      });
    }

    // Only record a new payment entry for the incremental difference
    const oldPaid  = Number(oldPurchase.paid_amount || 0);
    const newPaid  = Number(data.paid_amount || 0);
    const paidDiff = newPaid - oldPaid;

    if (paidDiff > 0) {
      await repo.createPurchasePayment(client, {
        purchase_id,
        zodu_id:          oldPurchase.zodu_id,
        branch_id:        oldPurchase.branch_id,
        payment_date:     new Date(),
        paid_amount:      paidDiff,
        transaction_type: data.transaction_type || "cash",
        transaction_id:   data.transaction_id   || null,
        status:           "completed",
      });
    }

    await client.query("COMMIT");
    return { success: true, message: "Updated successfully" };
  } catch (err) {
    await client.query("ROLLBACK");
    console.log(err)
    return { success: false, message: err.message };
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────
// DELETE PURCHASE (WITH STOCK REVERSAL)
// ─────────────────────────────────────────────────────────────
exports.deletePurchase = async (purchase_id) => {
  const client = await conn.connect();
  try {
    await client.query("BEGIN");

    const purchase = await repo.getPurchaseByIdForUpdate(client, purchase_id);
    if (!purchase) {
      await client.query("ROLLBACK");
      return { success: false, message: "Purchase not found" };
    }

    const items = await repo.getPurchaseItems(client, purchase_id);

    for (const item of items) {
      await adjustStockWithLedger(client, {
        item_uuid:       item.item_uuid,
        item_id:         item.item_id,
        item_name:       item.item_name,
        zodu_id:         purchase.zodu_id,
        branch_id:       purchase.branch_id,
        adjustment_type: "subtract",
        adjustment_qty:  item.qty,
        reason:          "purchase_delete",
        reference_id:    purchase.id,  // ✅ uuid
      });
    }

    // Delete children before parent to satisfy FK constraints
    await repo.deletePurchaseItems(client, purchase_id);
    await repo.deletePurchasePayments(client, purchase_id);
    await repo.deletePurchase(client, purchase_id);

    await client.query("COMMIT");
    return { success: true, message: "Deleted successfully" };
  } catch (err) {
    await client.query("ROLLBACK");
    return { success: false, message: err.message };
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────
// MARK PAYMENT
// ─────────────────────────────────────────────────────────────
exports.markPayment = async (purchase_id, data) => {
  const client = await conn.connect();
  try {
    await client.query("BEGIN");

    await repo.createPurchasePayment(client, {
      purchase_id,
      ...data,
    });

    const updated = await client.query(
      `UPDATE tbl_purchase
       SET paid_amount = paid_amount + $1,
           payment_status =
             CASE
               WHEN (paid_amount + $1) >= total_amount THEN 'paid'
               WHEN (paid_amount + $1) = 0             THEN 'pending'
               ELSE 'partial'
             END,
           updated_at = NOW()
       WHERE purchase_id = $2
       RETURNING *`,
      [data.paid_amount, purchase_id]
    );

    await client.query("COMMIT");
    return { success: true, data: updated.rows[0] };
  } catch (err) {
    await client.query("ROLLBACK");
    return { success: false, message: err.message };
  } finally {
    client.release();
  }
};