const repository = require("../repository/inventory-repo");
const conn = require("../database/connection");

async function getInventoryListData(zodu_id, branch_id, type, category, search, page, limit) {
  try {
    const result = await repository.get_inventory_list(zodu_id, branch_id, type, category, search, page, limit);
    const totalPages = Math.ceil(result.totalCount / limit);
    return {
      success: true,
      data: result.data,
      pagination: {
        total_count: result.totalCount,
        total_pages: totalPages,
        current_page: page,
        limit,
      },
    };
  } catch (error) {
    console.error("Inventory Data getting Error", error);
    return { success: false, message: error.message };
  }
}

async function getInventorySummary({ zodu_id, branch_id }) {
  try {
    const summary = await repository.getInventorySummary({ zodu_id, branch_id });
    return {
      success: true,
      data: {
        total_stock_value:  parseFloat(summary.total_stock_value),
        low_stock_count:    parseInt(summary.low_stock_count,    10),
        out_of_stock_count: parseInt(summary.out_of_stock_count, 10),
        total_skus:         parseInt(summary.total_skus,         10),
      },
    };
  } catch (err) {
    console.error('[inventory service] getInventorySummary:', err.message);
    return { success: false, message: err.message };
  }
}

async function adjustStock({
  inventory_uuid,
  adjustment_type,
  adjustment_qty,
  reason,
  notes,
}) {
  if (!["add", "subtract"].includes(adjustment_type)) {
    return { success: false, message: 'adjustment_type must be "add" or "subtract"' };
  }

  if (isNaN(adjustment_qty) || Number(adjustment_qty) <= 0) {
    return { success: false, message: "adjustment_qty must be a positive number" };
  }

  const client = await conn.connect();

  try {
    await client.query("BEGIN");

    // 🔹 Lock row (important)
    const current = await repository.getInventoryByUuid(client, inventory_uuid);

    if (!current) {
      await client.query("ROLLBACK");
      return { success: false, message: "Inventory record not found" };
    }

    const qty = Number(adjustment_qty);

    // ❌ Prevent negative stock
    if (adjustment_type === "subtract" && qty > Number(current.stock_qty)) {
      await client.query("ROLLBACK");
      return {
        success: false,
        message: `Cannot subtract ${qty} — only ${current.stock_qty} available`,
      };
    }

    const stock_before = Number(current.stock_qty);

    // 🔹 Update inventory
    const updated = await repository.adjustStock(client, {
      inventory_uuid,
      adjustment_type,
      adjustment_qty: qty,
      reason: reason || null,
      notes: notes || null,
    });

    const stock_after = Number(updated.stock_qty);

    // 🔥 CALCULATE LEDGER QTY
    const qty_change = adjustment_type === "add" ? qty : -qty;

    // 🔥 STOCK LEDGER ENTRY
    await repository.createStockLedger(client, {
      item_uuid: current.item_uuid,
      item_id: current.item_id,
      zodu_id: current.zodu_id,
      branch_id: current.branch_id,
      item_name: current.item_name,
      transaction_type: "adjustment",
      reference_id: null,
      qty_change,
      stock_before,
      stock_after,
      notes: reason || notes || "Manual stock adjustment",
    });

    await client.query("COMMIT");

    return {
      success: true,
      message: "Stock adjusted successfully",
      data: {
        inventory_uuid: updated.inventory_uuid,
        item_id: updated.item_id,
        item_name: updated.item_name,
        previous_qty: stock_before,
        adjustment_type,
        adjustment_qty: qty,
        new_qty: stock_after,
        reason: reason || null,
        notes: notes || null,
        last_stock_update: updated.updated_at,
      },
    };

  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[inventory service] adjustStock:", err.message);

    return { success: false, message: err.message };
  } finally {
    client.release();
  }
}

async function getStockHistoryService({ item_uuid, zodu_id, branch_id }) {
  const result = await repository.getStockHistoryRepo({ item_uuid, zodu_id, branch_id });
  return result;
}

async function update_Inventory(data) {
  try {
    const updatedInventory = await repository.updateInventory(data);
    return { success: true, data: updatedInventory };
  } catch (error) {
    console.error("Inventory Update Error", error);
    return { success: false, message: error.message };
  }
}

async function addin_Inventory(data) {
  try {
    const InventoryData = await repository.addin_Inventory(data);
    return { success: true, data: InventoryData };
  } catch (err) {
    console.error("Inventory Add Failed", err);
    return { success: false, message: err.message };
  }
}

module.exports = {
  getInventoryListData, update_Inventory,
  addin_Inventory, getInventorySummary,
  adjustStock, getStockHistoryService
};
