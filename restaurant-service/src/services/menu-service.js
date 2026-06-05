const repository = require("../repository/menu-repo");

async function createMenuItem(menuData) {
  try {
    const CreateQr = await repository.createQRCode(menuData.item_code);
    menuData.qr_code_id = CreateQr.id;

    const nextNumber = await repository.getNextMenuId(menuData.zodu_id, menuData.branch_id);
    menuData.menu_id = `${menuData.zodu_id}-${menuData.branch_id}-${nextNumber}`;
    menuData.menu_code = menuData.item_code;
    menuData.favorites = false;

    const newMenu = await repository.createMenuItem(menuData);
    return { success: true, message: "Menu item created successfully", data: newMenu };
  } catch (err) {
    console.error("Error inserting menu item:", err);
    return { success: false, message: err.message };
  }
}

async function editMenuItem(menuId, menuData) {
  try {
    const existingMenu = await repository.getMenuById(menuId);
    if (!existingMenu) return { success: false, message: "Menu item not found" };

    if (menuData.item_code && menuData.item_code !== existingMenu.menu_code) {
      const qrResult = await repository.createQRCode(menuData.item_code);
      menuData.qr_code_id = qrResult.id;
    } else {
      menuData.qr_code_id = existingMenu.qr_code_id;
    }

    const updatedMenu = {
      ...existingMenu,
      ...menuData,
      menu_id: existingMenu.menu_id,
      menu_code: menuData.item_code || existingMenu.menu_code
    };

    const result = await repository.updateMenuItem(menuId, updatedMenu);
    return { success: true, message: "Menu item updated successfully", data: result };
  } catch (err) {
    console.error("Error updating menu item:", err);
    return { success: false, message: err.message };
  }
}

async function updateMenustaus(menu_id, active) {
  try {
    const updatestatus = await repository.updateActive(menu_id, active);
    return { success: true, data: updatestatus };
  } catch (err) {
    console.error("Error updating Menu:", err);
    return { success: false, message: err.message };
  }
}

async function updateMenusFav(menu_id, active) {
  try {
    const updatestatus = await repository.AddFav(menu_id, active);
    return { success: true, data: updatestatus };
  } catch (err) {
    console.error("Error updating Menu:", err);
    return { success: false, message: err.message };
  }
}

async function get_menuItem_data(zodu_id,branch_id, type, page, limit, search, category_ids = []) {
  try {
    const allMenuItemData = await repository.get_menuItem_data(zodu_id,branch_id, type, page, limit, search, category_ids);
    const { total_count, total_pages, current_page, limit: pageLimit, rows } = allMenuItemData;

    const categories = (rows || []).map((category) => {
      const items = (category.items || []).map((item) => {
        let variants = item.variants;
        try {
          if (typeof variants === "string") variants = JSON.parse(variants);
        } catch (err) {
          variants = [];
        }
        return { ...item, variants };
      });
      return { ...category, items };
    });

    return { success: true, pagination: { total_count, total_pages, current_page, limit: pageLimit }, data: categories };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function deleteMenuItem(menuId) {
  try {
    const data = await repository.deleteMenuItem(menuId);
    return { success: true, data };
  } catch (err) {
    console.error("Unable to delete menu item: " + err.message);
    return { success: false, message: err.message };
  }
}

async function updateMenuItem(menuId, menuData) {
  try {
    const updated = await repository.updateMenuItem(menuId, menuData);
    return { success: true, data: updated };
  } catch (err) {
    console.error("Unable to update menu item: " + err.message);
    return { success: false, message: err.message };
  }
}

module.exports = {
  createMenuItem, editMenuItem, updateMenustaus, updateMenusFav,
  get_menuItem_data, deleteMenuItem, updateMenuItem
};
