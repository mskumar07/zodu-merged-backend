const conn = require("../database/connection");

exports.addin_Inventory = async (data) => {
  try {
    await conn.query("BEGIN");

    const prefix = "INDIR-INV-";
    const { rows } = await conn.query(`
      SELECT MAX(
        CAST(REGEXP_REPLACE(item_id, '^${prefix}', '') AS INTEGER)
      ) AS max_num
      FROM tbl_inventory
      WHERE inventory_type = 'indirect'
      AND item_id ~ '^${prefix}[0-9]+$'
    `);

    const maxNum = rows[0]?.max_num || 0;
    const itemId = `${prefix}${String(maxNum + 1).padStart(3, "0")}`;

    await conn.query(
      `INSERT INTO tbl_inventory (
        zodu_id, branch_id, item_id, category_id, item_name,
        item_unit, stock_qty, stock_alert, purchase_price, selling_price,
        last_purchase_date, inventory_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'indirect')`,
      [
        data.zodu_id,
        data.branch_id,
        itemId,
        data.category_id,
        data.item_name,
        data.item_unit,
        data.stock_qty,
        data.stock_alert,
        data.purchase_price,
        0,
        data.purchase_date,
      ]
    );

    await conn.query("COMMIT");
    return { success: true, message: "Indirect inventory added successfully", item_id: itemId };
  } catch (err) {
    await conn.query("ROLLBACK");
    throw new Error("Unable to add indirect inventory: " + err.message);
  }
};

exports.updateInventory = async (items) => {
  try {
    await conn.query("BEGIN");
    const { inventory_id, stock_qty, stock_alert, selling_price, purchase_price, last_purchase_date } = items;

    if (!inventory_id) throw new Error("Missing inventory_id");

    await conn.query(
      `UPDATE tbl_inventory
       SET
         stock_qty = stock_qty + COALESCE($1, 0),
         stock_alert = COALESCE($2, stock_alert),
         selling_price = COALESCE($3, selling_price),
         purchase_price = COALESCE($4, purchase_price),
         last_purchase_date = COALESCE($5, last_purchase_date),
         updated_at = NOW()
       WHERE inventory_id = $6`,
      [stock_qty, stock_alert, selling_price, purchase_price, last_purchase_date, inventory_id]
    );

    await conn.query("COMMIT");
    return { success: true, message: "Inventory updated successfully" };
  } catch (err) {
    await conn.query("ROLLBACK");
    throw new Error("Unable to update Inventory: " + err.message);
  }
};

exports.get_inventory_list = async (branch_id, type, category) => {
  try {
    const inventoryType = !type || type === "null" || type === "undefined" ? null : type;
    const categoryId =
      !category || category === "0" || category === "null" || category === "undefined"
        ? null
        : Number(category);

    const query = `
      SELECT
        i.*,
        c.name AS category_name,
        m.gst_tax,
        u.name       AS unit_name,
        u.short_name AS unit_short_name
      FROM tbl_inventory i
      LEFT JOIN tbl_category c   ON i.category_id = c.id
      LEFT JOIN tbl_menu_item m  ON i.item_id = m.menu_id
      LEFT JOIN tbl_units u      ON i.item_unit = u.id
      WHERE i.branch_id = $1
        AND ($2::text IS NULL OR i.inventory_type = $2::text)
        AND ($3::int  IS NULL OR i.category_id::int = $3::int)
      ORDER BY i.updated_at DESC;
    `;

    const result = await conn.query(query, [branch_id, inventoryType, categoryId]);
    return result.rows;
  } catch (err) {
    throw new Error("Unable to fetch inventory data: " + err.message);
  }
};
