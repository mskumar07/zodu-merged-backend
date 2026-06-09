const conn = require("../database/connection");

exports.updateMenuItem = async (menuId, data) => {
  try {
    await conn.query("BEGIN");
    const query = `
      UPDATE tbl_menu_items
      SET
        menu_category_id = $1,
        menu_name = $2,
        menu_type = $3,
        food_type = $4,
        variants = $5,
        sell_price = $6,
        purchase_price = $7,
        hsn_code = $8,
        gst_tax = $9,
        tax_include_or_exclude = $10,
        menu_image = $11,
        menu_code = $12,
        menu_unit = $13,
        favorites = $14
      WHERE menu_id = $15
      RETURNING *;
    `;
    const values = [
      data.menu_category_id, data.menu_name, data.menu_type, data.food_type,
      JSON.stringify(data.variants), data.sell_price, data.purchase_price,
      data.hsn_code, data.gst_tax, data.tax_include_or_exclude,
      data.menu_image, data.menu_code, data.menu_unit, data.favorites ?? null,
      menuId
    ];
    const result = await conn.query(query, values);
    const updatedMenu = result.rows[0];
    if (!updatedMenu) throw new Error("Menu item not found");

    if (updatedMenu.menu_type && updatedMenu.menu_type.toLowerCase() === "product") {
      const stockQty = Number(data.opening_stock || 0);
      const stockAlert = Number(data.alert_stock || 0);
      const invCheck = await conn.query(`SELECT * FROM tbl_inventory WHERE item_id = $1`, [menuId]);
      if (invCheck.rows.length > 0) {
        await conn.query(
          `UPDATE tbl_inventory SET item_name=$1, purchase_price=$2, selling_price=$3, item_unit=$4,
           stock_qty=stock_qty+$5, stock_alert=$6, updated_at=NOW() WHERE item_id=$7`,
          [updatedMenu.menu_name, updatedMenu.purchase_price, updatedMenu.sell_price, updatedMenu.menu_unit, stockQty, stockAlert, menuId]
        );
      } else {
        await conn.query(
          `INSERT INTO tbl_inventory (zodu_id, branch_id, item_id, category_id, item_name, item_unit, stock_qty, stock_alert, purchase_price, selling_price, inventory_type, last_purchase_date, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())`,
          [updatedMenu.zodu_id, updatedMenu.branch_id, updatedMenu.menu_id, updatedMenu.menu_category_id, updatedMenu.menu_name, updatedMenu.menu_unit, stockQty, stockAlert, updatedMenu.purchase_price, updatedMenu.sell_price, "direct"]
        );
      }
    }
    await conn.query("COMMIT");
    return updatedMenu;
  } catch (err) {
    await conn.query("ROLLBACK");
    throw new Error("Unable to update menu: " + err.message);
  }
};

exports.deleteMenuItem = async (menuId) => {
  try {
    await conn.query("BEGIN");
    const menu = await conn.query(`SELECT menu_type FROM tbl_menu_items WHERE menu_id = $1`, [menuId]);
    if (menu.rows.length === 0) throw new Error("Menu item not found");
    const menuType = menu.rows[0].menu_type;
    await conn.query(`DELETE FROM tbl_menu_items WHERE menu_id = $1`, [menuId]);
    if (menuType && menuType.toLowerCase() === "product") {
      await conn.query(`DELETE FROM tbl_inventory WHERE item_id = $1`, [menuId]);
    }
    await conn.query("COMMIT");
    return { success: true, message: "Menu deleted successfully" };
  } catch (err) {
    await conn.query("ROLLBACK");
    throw new Error("Unable to delete menu: " + err.message);
  }
};

exports.createMenuItem = async (menuData) => {
  try {
    const query = `
      INSERT INTO tbl_menu_items (
        zodu_id, branch_id, menu_category_id, menu_name, menu_type, food_type,
        variants, qr_code_id, sell_price, purchase_price,
        hsn_code, gst_tax, tax_include_or_exclude, menu_image, menu_code, menu_id, menu_unit, favorites,opening_stock, alert_stock
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      RETURNING *;
    `;
    const values = [
      menuData.zodu_id, menuData.branch_id, menuData.menu_category_id, menuData.menu_name,
      menuData.menu_type, menuData.food_type,
      menuData.variants ? JSON.stringify(menuData.variants) : null,
      menuData.qr_code_id, menuData.sell_price, menuData.purchase_price,
      menuData.hsn_code, menuData.gst_tax, menuData.tax_include_or_exclude,
      menuData.menu_image, menuData.menu_code, menuData.menu_id, menuData.menu_unit, menuData.favorites, menuData.opening_stock, menuData.alert_stock
    ];
    const result = await conn.query(query, values);
    const createdMenu = result.rows[0];

    if (createdMenu.menu_type && createdMenu.menu_type.toLowerCase() === "product") {
      const existing = await conn.query(`SELECT item_id FROM tbl_inventory WHERE item_id = $1`, [createdMenu.menu_id]);
      const stockQty = Number(menuData.opening_stock || 0);
      const stockAlert = Number(menuData.alert_stock || 0);
      if (existing.rows.length > 0) {
        await conn.query(
          `UPDATE tbl_inventory SET stock_qty=stock_qty+$1, stock_alert=$2, updated_at=NOW() WHERE item_id=$3 AND branch_id=$4`,
          [stockQty, stockAlert, createdMenu.menu_id, createdMenu.branch_id]
        );
      } else {
        await conn.query(
          `INSERT INTO tbl_inventory (zodu_id, branch_id, item_id, category_id, item_name, item_unit, stock_qty, stock_alert, purchase_price, selling_price, inventory_type, last_purchase_date, created_at,item_uuid)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW(),$12)`,
          [createdMenu.zodu_id, createdMenu.branch_id, createdMenu.menu_id, createdMenu.menu_category_id, createdMenu.menu_name, createdMenu.menu_unit, stockQty, stockAlert, createdMenu.purchase_price, createdMenu.sell_price, "direct", createdMenu.item_uuid]
        );
      }
    }
    return createdMenu;
  } catch (err) {
    throw new Error("Unable to create menu: " + err.message);
  }
};

exports.getNextMenuId = async (zoduId, branchId) => {
  try {
    // Lock all rows for this branch so concurrent inserts serialize here
    await conn.query(
      `SELECT 1 FROM tbl_menu_items WHERE zodu_id=$1 AND branch_id=$2 FOR UPDATE`,
      [zoduId, branchId]
    );
    // Extract only the trailing numeric suffix and take the max
    const result = await conn.query(
      `SELECT MAX((regexp_match(menu_id, '([0-9]+)$'))[1]::int) AS max_seq
       FROM tbl_menu_items WHERE zodu_id=$1 AND branch_id=$2`,
      [zoduId, branchId]
    );
    const maxSeq = result.rows[0].max_seq;
    const nextNumber = maxSeq ? maxSeq + 1 : 1;
    return String(nextNumber).padStart(3, "0");
  } catch (err) {
    throw new Error("Error generating next menu ID: " + err.message);
  }
};

exports.getMenuById = async (menuId) => {
  const result = await conn.query(`SELECT * FROM tbl_menu_items WHERE menu_id = $1`, [menuId]);
  return result.rows[0] || null;
};

exports.createQRCode = async (qr_code) => {
  try {
    const { rows } = await conn.query(`INSERT INTO tbl_qr_code (qr_code) VALUES ($1) RETURNING *`, [qr_code]);
    if (rows.length === 0) throw new Error("QR Code not created");
    return rows[0];
  } catch (err) {
    throw new Error("Unable to create QR Code: " + err.message);
  }
};

exports.get_menuItem_data = async (zodu_id,branch_id, type, page, limit, search, category_ids = []) => {
  const offset = (page - 1) * limit;

  const params = [zodu_id,branch_id];
  const conditions = [`m.zodu_id = $1`, `m.branch_id = $2`];

  if (type && type.trim() !== "") {
    params.push(type);
    conditions.push(`LOWER(m.menu_type) = LOWER($${params.length})`);
  }

  if (category_ids.length > 0) {
    params.push(category_ids);
    conditions.push(`m.menu_category_id = ANY($${params.length})`);
  }

  params.push(search || "");
  const searchIdx = params.length;
  conditions.push(`(m.menu_name ILIKE '%' || $${searchIdx} || '%' OR c.name ILIKE '%' || $${searchIdx} || '%')`);

  const whereClause = conditions.join(" AND ");

  const totalCountResult = await conn.query(
    `SELECT COUNT(*) AS total FROM tbl_menu_items m
     JOIN tbl_category c ON c.id = m.menu_category_id
     WHERE ${whereClause}`,
    params
  );
  const total_count = Number(totalCountResult.rows[0].total);
  const total_pages = Math.ceil(total_count / limit);

  const dataResult = await conn.query(
    `SELECT
      m.zodu_id, m.branch_id, m.menu_id, m.menu_name, m.menu_code, m.menu_type, m.menu_image,
      m.variants, m.sell_price, m.purchase_price, m.hsn_code,m.item_uuid,m.opening_stock,m.alert_stock,
      m.gst_tax AS gst_id, g.gst_rate AS gst_tax,
      m.menu_unit AS unit_id, u.name AS unit_name, u.short_name AS menu_unit,
      c.name AS category, m.menu_category_id AS category_id,
      COALESCE(i.stock_qty, 0) AS stock_qty, COALESCE(i.stock_alert, 0) AS stock_alert,
      m.active, m.food_type, m.tax_include_or_exclude, m.favorites, 10 AS count
     FROM tbl_menu_items m
     JOIN tbl_category c ON c.id = m.menu_category_id
     LEFT JOIN tbl_gst g ON g.id = m.gst_tax
     LEFT JOIN tbl_units u ON u.id = m.menu_unit
     LEFT JOIN tbl_inventory i ON i.item_id = m.menu_id AND i.branch_id = m.branch_id
     WHERE ${whereClause}
     ORDER BY m.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  return { total_count, total_pages, current_page: Number(page), limit: Number(limit), rows: dataResult.rows };
};

exports.updateActive = async (menuId, active) => {
  try {
    await conn.query("BEGIN");
    const result = await conn.query(
      `UPDATE tbl_menu_items SET active=$1 WHERE menu_id=$2 RETURNING *`,
      [active, menuId]
    );
    await conn.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await conn.query("ROLLBACK");
    throw error;
  }
};

exports.checkItemIdExists = async (item_id, zodu_id, branch_id) => {
  const { rows } = await conn.query(
    `SELECT item_uuid, menu_id, menu_name, active
     FROM tbl_menu_items
     WHERE menu_code = $1 AND zodu_id = $2 AND branch_id = $3
     LIMIT 1`,
    [item_id, zodu_id, branch_id]
  );
  return rows[0] ?? null;
};

exports.AddFav = async (menuId, active) => {
  try {
    await conn.query("BEGIN");
    const result = await conn.query(
      `UPDATE tbl_menu_items SET favorites=$1 WHERE menu_id=$2 RETURNING *`,
      [active, menuId]
    );
    await conn.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await conn.query("ROLLBACK");
    throw error;
  }
};
