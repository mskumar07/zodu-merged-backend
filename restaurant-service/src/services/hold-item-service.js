const repository = require("../repository/hold_item_repo");

async function addHoldMenu(data) {
  try {

    const {
      zodu_id,
      branch_id,
      orderType,
      table_no,
      customerName,
      customerPhone,
      items
    } = data;

    // 1️⃣ Create new hold
    const hold_id = await repository.createHold(
      zodu_id,
      branch_id,
      orderType,
      table_no,
      customerName,
      customerPhone
    );

    // 2️⃣ Insert all hold items
    await repository.bulkInsertHoldItems(hold_id, zodu_id, branch_id, items);


    return {
      success: true,
      message: "Hold saved successfully",
      hold_id,
    };

  } catch (error) {
    console.error("❌ Hold Add Failed:", error);
    return {
      success: false,
      message: error.message,
    };
  }
}

async function updateHoldMenu(data) {
  try {
    const {
      hold_id,
      zodu_id,
      branch_id,
      orderType,
      table_no,
      customerName,
      customerPhone,
      items
    } = data;

    const hold = { hold_id, zodu_id, branch_id };
    const found = await repository.updateHold(
      hold,
      orderType,
      table_no,
      customerName,
      customerPhone
    );
    if (!found) return { success: false, message: "Hold not found" };

    const itemsToUpdate = items.filter((item) => item.id);
    const itemsToInsert = items.filter((item) => !item.id);
    const keepIds = itemsToUpdate.map((item) => item.id);

    await Promise.all([
      repository.deleteHoldItemsExcept(hold, keepIds),
      repository.bulkUpdateHoldItems(hold, itemsToUpdate),
      repository.bulkInsertHoldItems(hold_id, zodu_id, branch_id, itemsToInsert),
    ]);

    return {
      success: true,
      message: "Hold updated successfully",
      hold_id,
    };
  } catch (error) {
    console.error("❌ Hold Update Failed:", error);
    return {
      success: false,
      message: error.message,
    };
  }
}

// hold: { hold_id, zodu_id, branch_id } — hold ids repeat across companies and branches.
async function deleteHoldMenu(hold) {

  try {
    const found = await repository.deleteHold(hold);
    if (!found) return { success: false, message: "Hold not found" };
    await repository.deleteHoldItems(hold);

    return {
      success: true,
      message: "Hold deleted successfully",
    };
  } catch (error) {
    console.error("❌ Hold Delete Failed:", error);
    return {
      success: false,
      message: error.message,
    };
  }
}
async function getHoldData(branch_id, zodu_id) {
  try {
    const allCategoryData = await repository.getHold(branch_id, zodu_id);
    return {
      success: true,
      data: allCategoryData,
    };
  } catch (error) {
    console.error("Category Data getting Error", error);
    return {
      success: false,
      message: error.message
    };
  }
}

module.exports = { addHoldMenu, updateHoldMenu, deleteHoldMenu, getHoldData };
