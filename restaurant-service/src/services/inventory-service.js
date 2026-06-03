const repository = require("../repository/inventory-repo");

async function getInventoryListData(branch_id, type, category) {
  try {
    const allInventoryData = await repository.get_inventory_list(branch_id, type, category);
    return { success: true, data: allInventoryData };
  } catch (error) {
    console.error("Inventory Data getting Error", error);
    return { success: false, message: error.message };
  }
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

module.exports = { getInventoryListData, update_Inventory, addin_Inventory };
