// ============================================================
//  menu_item_service.js
//  Business logic for menu item create / edit.
//  Orchestrates repository calls inside a single transaction.
// ============================================================

const repository = require("../repository/menu-repo");
const conn = require('../database/connection');

/**
 * Create a new menu item.
 *
 * Flow:
 *  1. Acquire a dedicated client from the pool
 *  2. Open transaction
 *  3. Generate next item_id (with FOR UPDATE lock)
 *  4. Insert row into tbl_menu_items
 *  5. Commit
 */
async function createMenuItem(input) {
  const client = await conn.connect();
  try {
    await client.query("BEGIN");
 
    const nextNum = await repository.getNextItemNumber(client, input.zodu_id, input.branch_id);
    const item_id = String(nextNum);
 
    const newItem = await repository.createMenuItem(client, {
      ...input,
      item_id,
    });
 
    // Create the matching inventory record in the same transaction
    await repository.createInventoryRecord(client, {
      item_uuid:     newItem.item_uuid,
      item_id:       newItem.item_id,
      zodu_id:       newItem.zodu_id,
      branch_id:     newItem.branch_id,
      item_name:     newItem.item_name,
      available_qty: input.opening_stock  ?? 0,   // from AddItemModal optional field
      reorder_level: input.reorder_level  ?? 0,   // low stock alert threshold
    });
 
    await client.query("COMMIT");
 
    return {
      success: true,
      message: "Menu item created successfully",
      data:    newItem,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[menu service] createMenuItem:", err.message);
    return { success: false, message: err.message };
  } finally {
    client.release();
  }
}

/**
 * Edit an existing menu item (partial update).
 *
 * Flow:
 *  1. Acquire client + open transaction
 *  2. Update only provided fields
 *  3. Commit and return updated row
 */
async function editMenuItem(item_uuid, input) {
  const client = await conn.connect();
  try {
    await client.query("BEGIN");

    const updated = await repository.updateMenuItem(client, item_uuid, input);

    await client.query("COMMIT");

    return {
      success: true,
      message: "Menu item updated successfully",
      data:    updated,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[menu service] editMenuItem:", err.message);
    return {
      success: false,
      message: err.message,
    };
  } finally {
    client.release();
  }
}

/**
 * Get paginated list of menu items with search + filters.
 */
async function getMenuItems(params) {
  const client = await conn.connect();
  try {
    await client.query("BEGIN");
    const { rows, total } = await repository.getMenuItems(client, params);
    await client.query("COMMIT");
 
    const page       = Number(params.page)  || 1;
    const limit      = Number(params.limit) || 20;
    const totalPages = Math.ceil(total / limit);
 
    return {
      success: true,
      total,
      page,
      limit,
      total_pages: totalPages,
      data: rows,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[menu service] getMenuItems:", err.message);
    return { success: false, message: err.message };
  } finally {
    client.release();
  }
}
 
/**
 * Soft-delete a menu item by item_uuid.
 */
async function deleteMenuItem(item_uuid) {
  const client = await conn.connect();
  try {
    await client.query("BEGIN");
    const deleted = await repository.deleteMenuItem(client, item_uuid);
    await client.query("COMMIT");
    return { success: true, message: "Menu item deleted successfully", data: deleted };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[menu service] deleteMenuItem:", err.message);
    return { success: false, message: err.message };
  } finally {
    client.release();
  }
}
 
async function getMenuItemById(item_uuid) {
  const client = await conn.connect();
  try {
    const item = await repository.getMenuItemByUuid(client, item_uuid);
    if (!item) return { success: false, message: "Menu item not found" };
    return { success: true, data: item };
  } catch (err) {
    console.error("[menu service] getMenuItemById:", err.message);
    return { success: false, message: err.message };
  } finally {
    client.release();
  }
}


async function getInventorySummary({ zodu_id, branch_id }) {
  const client = await conn.connect();
  try {
    const summary = await repository.getInventorySummary(client, { zodu_id, branch_id });
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
  } finally {
    client.release();
  }
}
 
// ─────────────────────────────────────────────────────────────
//  getInventoryList
//  Paginated list with search + filter.
// ─────────────────────────────────────────────────────────────
async function getInventoryList(params) {
  const client = await conn.connect();
  try {
    const page       = Number(params.page)  || 1;
    const limit      = Math.min(Number(params.limit) || 20, 100);
    const totalPages = (total) => Math.ceil(total / limit);
 
    const { rows, total } = await repository.getInventoryList(client, {
      ...params,
      page,
      limit,
    });
 
    return {
      success:     true,
      total,
      page,
      limit,
      total_pages: totalPages(total),
      data:        rows,
    };
  } catch (err) {
    console.error('[inventory service] getInventoryList:', err.message);
    return { success: false, message: err.message };
  } finally {
    client.release();
  }
}
 
// ─────────────────────────────────────────────────────────────
//  getInventoryDetail
//  Single inventory record by inventory_uuid.
// ─────────────────────────────────────────────────────────────
async function getInventoryDetail(inventory_uuid) {
  const client = await conn.connect();
  try {
    const item = await repository.getInventoryByUuid(client, inventory_uuid);
    if (!item) return { success: false, message: 'Inventory record not found' };
    return { success: true, data: item };
  } catch (err) {
    console.error('[inventory service] getInventoryDetail:', err.message);
    return { success: false, message: err.message };
  } finally {
    client.release();
  }
}
 
// ─────────────────────────────────────────────────────────────
//  adjustStock
//  ADD or SUBTRACT qty with reason + notes logging.
//
//  adjustment_type : "add" | "subtract"
//  adjustment_qty  : positive number
//  reason          : string (e.g. "Purchase", "Damage")
//  notes           : optional string
// ─────────────────────────────────────────────────────────────
async function adjustStock({
  inventory_uuid,
  adjustment_type,
  adjustment_qty,
  reason,
  notes,
}) {
  if (!['add', 'subtract'].includes(adjustment_type)) {
    return { success: false, message: 'adjustment_type must be "add" or "subtract"' };
  }
 
  if (isNaN(adjustment_qty) || Number(adjustment_qty) <= 0) {
    return { success: false, message: 'adjustment_qty must be a positive number' };
  }
 
  const client = await conn.connect();
  try {
    await client.query('BEGIN');
 
    // Get current record first (for subtract validation)
    const current = await repository.getInventoryByUuid(client, inventory_uuid);
    if (!current) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Inventory record not found' };
    }
 
    const qty = Number(adjustment_qty);
 
    // Prevent stock going negative
    if (adjustment_type === 'subtract' && qty > Number(current.available_qty)) {
      await client.query('ROLLBACK');
      return {
        success: false,
        message: `Cannot subtract ${qty} — only ${current.available_qty} available`,
      };
    }
 
    const updated = await repository.adjustStock(client, {
      inventory_uuid,
      adjustment_type,
      adjustment_qty: qty,
    });
 
    await client.query('COMMIT');
 
    return {
      success: true,
      message: 'Stock adjusted successfully',
      data: {
        inventory_uuid:    updated.inventory_uuid,
        item_id:           updated.item_id,
        item_name:         updated.item_name,
        previous_qty:      Number(current.available_qty),
        adjustment_type,
        adjustment_qty:    qty,
        new_qty:           Number(updated.available_qty),
        reason:            reason   || null,
        notes:             notes    || null,
        last_stock_update: updated.last_stock_update,
      },
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[inventory service] adjustStock:', err.message);
    return { success: false, message: err.message };
  } finally {
    client.release();
  }
}

module.exports = { createMenuItem, editMenuItem, getMenuItems, deleteMenuItem, getMenuItemById , getInventorySummary,
  getInventoryList,
  getInventoryDetail,
  adjustStock,};