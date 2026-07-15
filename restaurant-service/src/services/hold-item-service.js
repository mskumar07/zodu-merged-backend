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
    for (const item of items) {
      await repository.insertHoldItem(hold_id, zodu_id, branch_id, item);
    }


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

    await repository.updateHold(
      hold_id,
      orderType,
      table_no,
      customerName,
      customerPhone
    );

    const itemsToUpdate = items.filter((item) => item.id);
    const itemsToInsert = items.filter((item) => !item.id);
    const keepIds = itemsToUpdate.map((item) => item.id);

    await Promise.all([
      repository.deleteHoldItemsExcept(hold_id, keepIds),
      repository.bulkUpdateHoldItems(hold_id, itemsToUpdate),
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

async function deleteHoldMenu(hold_id) {

  try {
    await repository.deleteHold(hold_id);
    await repository.deleteHoldItems(hold_id);

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
