const conn = require("../database/connection");
const repo = require("../repository/purchase-repo");
const inventoryRepo = require("../repository/menu-repo");

// Must use `client` so stock updates stay inside the same transaction
// Returns the updated inventory record with new stock level
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

  // Validate that subtract operation won't result in negative stock
  if (payload.adjustment_type === "subtract") {
    const newQty = current.available_qty - payload.adjustment_qty;
    if (newQty < 0) {
      throw new Error(
        `Insufficient stock for item ${payload.item_name}. ` +
        `Current: ${current.available_qty}, Attempting to subtract: ${payload.adjustment_qty}`
      );
    }
  }

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

  return newStock;
};

// ─────────────────────────────────────────────────────────────
// CREATE PURCHASE
// ─────────────────────────────────────────────────────────────
exports.createPurchase = async (data) => {
  const client = await conn.connect();
  try {
    await client.query("BEGIN");

    const { missing } = await inventoryRepo.checkItemIdsExistBulk(
      (data.items || []).map(i => i.item_id),
      data.zodu_id,
      data.branch_id,
      client
    );
    if (missing.length > 0) {
      await client.query("ROLLBACK");
      return { success: false, message: `Item(s) not found in menu: ${missing.join(", ")}` };
    }

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
        payment_date:     data.payment_date,
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
         TRUNC(COALESCE(SUM(paid_amount),    0))::text                 AS total_paid_amount,
         TRUNC(COALESCE(SUM(balance_amount), 0))::text                 AS total_unpaid_amount,
         TRUNC(COALESCE(SUM(total_amount), 0))::text                 AS total_amount,
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
// UPDATE PURCHASE (WITH SMART STOCK ADJUSTMENT)
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
    const newItems = data.items || [];

    const zodu_id = data.zodu_id || oldPurchase.zodu_id;
    const branch_id = data.branch_id || oldPurchase.branch_id;

    const { missing } = await inventoryRepo.checkItemIdsExistBulk(
      newItems.map(i => i.item_id),
      zodu_id,
      branch_id,
      client
    );
    if (missing.length > 0) {
      await client.query("ROLLBACK");
      return { success: false, message: `Item(s) not found in menu: ${missing.join(", ")}` };
    }

    // ── NORMALIZE QUANTITIES ──────
    // Convert all qty values to numbers to ensure proper comparison
    const normalizedOldItems = oldItems.map(i => ({
      ...i,
      qty: Number(i.qty),
    }));
    const normalizedNewItems = newItems.map(i => ({
      ...i,
      qty: Number(i.qty),
    }));

    // ── SMART STOCK ADJUSTMENT: Only adjust what changed ──────
    // Create maps for quick lookup
    const oldItemsMap = new Map(normalizedOldItems.map(i => [i.item_uuid, i]));
    const newItemsMap = new Map(normalizedNewItems.map(i => [i.item_uuid, i]));

    // Process old items: Remove or adjust quantity if it existed
    for (const oldItem of normalizedOldItems) {
      if (!oldItem.item_uuid) {
        console.warn("Skipping old item without item_uuid:", oldItem);
        continue;
      }

      const newItem = newItemsMap.get(oldItem.item_uuid);

      if (!newItem) {
        // Item was REMOVED: Subtract full quantity
        console.log(
          `Item ${oldItem.item_uuid} REMOVED - reverting ${oldItem.qty} units`
        );
        await adjustStockWithLedger(client, {
          item_uuid:       oldItem.item_uuid,
          item_id:         oldItem.item_id,
          item_name:       oldItem.item_name,
          zodu_id:         oldPurchase.zodu_id,
          branch_id:       oldPurchase.branch_id,
          adjustment_type: "subtract",
          adjustment_qty:  oldItem.qty,
          reason:          "purchase_item_removed",
          reference_id:    oldPurchase.id,
        });
      } else if (newItem.qty !== oldItem.qty) {
        // Item QUANTITY CHANGED: Adjust the difference
        const qtyDifference = newItem.qty - oldItem.qty;
        const adjustment_type = qtyDifference > 0 ? "add" : "subtract";
        
        console.log(
          `Item ${oldItem.item_uuid} QTY CHANGED: ${oldItem.qty} → ${newItem.qty} (diff: ${qtyDifference})`
        );
        
        await adjustStockWithLedger(client, {
          item_uuid:       oldItem.item_uuid,
          item_id:         oldItem.item_id,
          item_name:       oldItem.item_name,
          zodu_id:         oldPurchase.zodu_id,
          branch_id:       oldPurchase.branch_id,
          adjustment_type: adjustment_type,
          adjustment_qty:  Math.abs(qtyDifference),
          reason:          "purchase_item_qty_updated",
          reference_id:    oldPurchase.id,
        });
      }
      // If quantity hasn't changed, do nothing
    }

    // Process new items: Add items that didn't exist before
    for (const newItem of normalizedNewItems) {
      if (!newItem.item_uuid) {
        console.warn("Skipping new item without item_uuid:", newItem);
        continue;
      }

      const oldItem = oldItemsMap.get(newItem.item_uuid);

      if (!oldItem) {
        // Item was ADDED: Add full quantity
        console.log(
          `Item ${newItem.item_uuid} ADDED - adding ${newItem.qty} units`
        );
        await adjustStockWithLedger(client, {
          item_uuid:       newItem.item_uuid,
          item_id:         newItem.item_id,
          item_name:       newItem.item_name,
          zodu_id:         zodu_id,
          branch_id:       branch_id,
          adjustment_type: "add",
          adjustment_qty:  newItem.qty,
          reason:          "purchase_item_added",
          reference_id:    oldPurchase.id,
        });
      }
      // If item existed in old list, it was already processed above
    }

    // Update database records
    await repo.deletePurchaseItems(client, purchase_id);
    await repo.updatePurchase(client, purchase_id, data);
    
    if (newItems.length > 0) {
      await repo.createPurchaseItems(client, newItems, purchase_id);
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
        payment_date:     data.payment_date || new Date(),
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
    if (purchase.cancelled_purchase) {
      await client.query("ROLLBACK");
      return { success: false, message: "Purchase already cancelled" };
    }

    // Bulk-reverse inventory + write stock ledger entries for every item
    await repo.reversePurchaseStock(client, {
      purchase_id,
      reference_id: purchase.id,
      zodu_id:      purchase.zodu_id,
      branch_id:    purchase.branch_id,
    });

    // Soft-delete: mark as cancelled instead of removing rows, so stock
    // ledger history and payment records stay intact
    await repo.deletePurchase(client, purchase_id);

    await client.query("COMMIT");
    return {
      success: true,
      message: "Deleted successfully. Inventory stock reversed.",
    };
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
