const conn = require("../database/connection");
const { withDescription } = require("../utils/description");

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
        favorites = $14,
        opening_stock = $15,
        alert_stock = $16,
        description = $17
      WHERE menu_id = $18
      RETURNING *;
    `;
    const values = [
      data.menu_category_id, data.menu_name, data.menu_type, data.food_type,
      JSON.stringify(data.variants), data.sell_price, data.purchase_price,
      data.hsn_code, data.gst_tax, data.tax_include_or_exclude,
      data.menu_image, data.menu_code, data.menu_unit, data.favorites ?? null,data.opening_stock, data.alert_stock,
      data.description ?? data.item_description ?? null,
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
           stock_qty=$5, stock_alert=$6, updated_at=NOW(),category_id=$7 WHERE item_id=$8`,
          [updatedMenu.menu_name, updatedMenu.purchase_price, updatedMenu.sell_price, updatedMenu.menu_unit, stockQty, stockAlert, updatedMenu.menu_category_id, menuId]
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
        hsn_code, gst_tax, tax_include_or_exclude, menu_image, menu_code, menu_id, menu_unit, favorites,opening_stock, alert_stock,
        description
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      RETURNING *;
    `;
    const values = [
      menuData.zodu_id, menuData.branch_id, menuData.menu_category_id, menuData.menu_name,
      menuData.menu_type, menuData.food_type,
      menuData.variants ? JSON.stringify(menuData.variants) : null,
      menuData.qr_code_id, menuData.sell_price, menuData.purchase_price,
      menuData.hsn_code, menuData.gst_tax, menuData.tax_include_or_exclude,
      menuData.menu_image, menuData.menu_code, menuData.menu_id, menuData.menu_unit, menuData.favorites, menuData.opening_stock, menuData.alert_stock,
      menuData.description ?? menuData.item_description ?? null
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

// Bulk counterpart of createMenuItem, for the xlsx upload. Same table, same
// menu_id scheme and the same "only a Product gets an inventory row" rule —
// the difference is that everything is batched, and the max menu_id sequence
// is read once per branch instead of once per row.
//
// `client` must be a checked-out connection already inside a transaction: the
// caller owns BEGIN/COMMIT so a bad sheet leaves nothing behind.
//
// Accepts the retail-style column names as aliases (item_name, category_id,
// gst_type, ...) so a sheet exported from either product screen uploads
// unchanged.
const MENU_BATCH_SIZE = 1000;

const truthy = (v) =>
  v === true || v === 1 ||
  ["true", "yes", "inclusive", "1"].includes(String(v).trim().toLowerCase());

exports.bulkCreateMenuItems = async (rows, client) => {
  const db = client ?? conn;

  let inserted = 0;
  let inventoryProcessed = 0;
  const skipped = [];

  // One sequence counter per branch, advanced in memory across the whole upload.
  const seqByBranch = new Map();
  const nextMenuId = async (zodu_id, branch_id) => {
    const key = `${zodu_id}|${branch_id}`;
    if (!seqByBranch.has(key)) {
      await db.query(
        `SELECT 1 FROM tbl_menu_items WHERE zodu_id=$1 AND branch_id=$2 FOR UPDATE`,
        [zodu_id, branch_id]
      );
      const { rows: seqRows } = await db.query(
        `SELECT MAX((regexp_match(menu_id, '([0-9]+)$'))[1]::int) AS max_seq
           FROM tbl_menu_items WHERE zodu_id=$1 AND branch_id=$2`,
        [zodu_id, branch_id]
      );
      seqByBranch.set(key, seqRows[0].max_seq || 0);
    }
    const next = seqByBranch.get(key) + 1;
    seqByBranch.set(key, next);
    return `${zodu_id}-${branch_id}-${String(next).padStart(3, "0")}`;
  };

  for (let i = 0; i < rows.length; i += MENU_BATCH_SIZE) {
    const batch = rows.slice(i, i + MENU_BATCH_SIZE);

    const values = [];
    const placeholders = [];
    let index = 1;

    for (let b = 0; b < batch.length; b++) {
      const item = batch[b];
      const zodu_id = item.zodu_id;
      const branch_id = item.branch_id;
      const menu_name = item.menu_name ?? item.item_name;
      const menu_category_id = item.menu_category_id ?? item.category_id;

      // These four are NOT NULL on tbl_menu_items. Report the row and the
      // field rather than dropping it on the floor — a silently short import
      // is worse than a loud one.
      const missing = [];
      if (!zodu_id) missing.push("zodu_id");
      if (!branch_id) missing.push("branch_id");
      if (!menu_name) missing.push("item_name");
      if (menu_category_id === undefined || menu_category_id === null || menu_category_id === "") {
        missing.push("category_id");
      }
      if (missing.length) {
        // +2: one for the header row, one because sheet rows are 1-based.
        skipped.push({ row: i + b + 2, item_name: menu_name || null, missing });
        continue;
      }

      const menu_type = String(item.menu_type ?? item.item_type ?? "Food");

      values.push(
        zodu_id,
        branch_id,
        parseInt(menu_category_id, 10),
        menu_name,
        menu_type,
        item.food_type || null,
        // sell_price / purchase_price are varchar on this table
        item.sell_price != null ? String(item.sell_price) : null,
        (item.purchase_price ?? item.cost_price) != null
          ? String(item.purchase_price ?? item.cost_price)
          : null,
        item.hsn_code || null,
        item.gst_tax ?? item.gst_type ?? item.gst_percentage ?? 0,
        truthy(item.tax_include_or_exclude ?? item.tax_incl_type),
        item.menu_image || item.item_img || null,
        item.menu_code || item.sku || item.item_id || null,
        await nextMenuId(zodu_id, branch_id),
        (item.menu_unit ?? item.unit) != null && (item.menu_unit ?? item.unit) !== ""
          ? parseInt(item.menu_unit ?? item.unit, 10)
          : null,
        Number(item.opening_stock ?? item.available_qty ?? 0),
        Number(item.alert_stock ?? item.reorder_level ?? 0),
        item.description || null
      );

      placeholders.push(
        `($${index++}, $${index++}, $${index++}, $${index++},
          $${index++}, $${index++}, $${index++}, $${index++},
          $${index++}, $${index++}, $${index++}, $${index++},
          $${index++}, $${index++}, $${index++}, $${index++},
          $${index++}, $${index++}, false)`
      );
    }

    if (!values.length) continue;

    const { rows: created } = await db.query(
      `INSERT INTO tbl_menu_items (
         zodu_id, branch_id, menu_category_id, menu_name,
         menu_type, food_type, sell_price, purchase_price,
         hsn_code, gst_tax, tax_include_or_exclude, menu_image,
         menu_code, menu_id, menu_unit, opening_stock,
         alert_stock, description, favorites
       )
       VALUES ${placeholders.join(",")}
       RETURNING item_uuid, menu_id, zodu_id, branch_id, menu_name,
                 menu_type, menu_category_id, menu_unit,
                 purchase_price, sell_price, opening_stock, alert_stock`,
      values
    );
    inserted += created.length;

    // Only Products are stocked. The menu_ids were just generated, so no
    // inventory row can already exist — a plain insert is enough (and
    // tbl_inventory has no unique key to upsert against anyway).
    const products = created.filter(
      (r) => String(r.menu_type || "").toLowerCase() === "product"
    );
    if (!products.length) continue;

    const invValues = [];
    const invPlaceholders = [];
    let invIndex = 1;

    for (const row of products) {
      invValues.push(
        row.zodu_id,
        row.branch_id,
        row.menu_id,
        row.menu_category_id,
        row.menu_name,
        row.menu_unit,
        Number(row.opening_stock || 0),
        Number(row.alert_stock || 0),
        // numeric here, varchar on tbl_menu_items — "" would fail the cast
        row.purchase_price ? Number(row.purchase_price) : null,
        row.sell_price ? Number(row.sell_price) : null,
        row.item_uuid
      );
      invPlaceholders.push(
        `($${invIndex++}, $${invIndex++}, $${invIndex++}, $${invIndex++},
          $${invIndex++}, $${invIndex++}, $${invIndex++}, $${invIndex++},
          $${invIndex++}, $${invIndex++}, 'direct', NOW(), NOW(), $${invIndex++})`
      );
    }

    await db.query(
      `INSERT INTO tbl_inventory (
         zodu_id, branch_id, item_id, category_id,
         item_name, item_unit, stock_qty, stock_alert,
         purchase_price, selling_price, inventory_type,
         last_purchase_date, created_at, item_uuid
       )
       VALUES ${invPlaceholders.join(",")}`,
      invValues
    );
    inventoryProcessed += invPlaceholders.length;
  }

  return { inserted, inventoryProcessed, skipped };
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
  return withDescription(result.rows[0] || null);
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
  conditions.push(`(m.menu_name ILIKE '%' || $${searchIdx} || '%' OR m.menu_code ILIKE '%' || $${searchIdx} || '%' OR c.name ILIKE '%' || $${searchIdx} || '%')`);

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
      m.zodu_id, m.branch_id, m.menu_id, m.menu_name, m.description, m.menu_code, m.menu_type, m.menu_image,
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

  return { total_count, total_pages, current_page: Number(page), limit: Number(limit), rows: withDescription(dataResult.rows) };
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

// ─────────────────────────────────────────────────────────────
// KOT COUNTER (kitchen printer station) + item-to-counter assignment
// ─────────────────────────────────────────────────────────────

// counter_code (KOT1, KOT2, ...) is stamped by trg_set_kot_counter_code on
// insert (tbl_doc_id_seq, doc_type 'KOT') — never set from here.
exports.createKotCounter = async (zodu_id, branch_id, counter_name) => {
  try {
    const dupCheck = await conn.query(
      `SELECT id FROM tbl_kot_counter
       WHERE zodu_id = $1 AND branch_id = $2 AND LOWER(counter_name) = LOWER($3)
       LIMIT 1`,
      [zodu_id, branch_id, counter_name]
    );
    if (dupCheck.rows.length > 0) {
      throw new Error("Counter name already exists");
    }

    const result = await conn.query(
      `INSERT INTO tbl_kot_counter (zodu_id, branch_id, counter_name)
       VALUES ($1, $2, $3) RETURNING *`,
      [zodu_id, branch_id, counter_name]
    );
    return result.rows[0];
  } catch (err) {
    throw new Error("Unable to create KOT counter: " + err.message);
  }
};

exports.getKotCounters = async (zodu_id, branch_id) => {
  const result = await conn.query(
    `SELECT * FROM tbl_kot_counter
     WHERE zodu_id = $1 AND branch_id = $2 AND active = TRUE
     ORDER BY id ASC`,
    [zodu_id, branch_id]
  );
  return result.rows;
};

// Categories + items with each item's current kot_counter_id, so the UI can
// pre-check items already assigned to a counter and show per-category counts.
// menu_item_id here is item_uuid — the stable identifier the assign API takes
// back, instead of the internal serial id.
exports.getMenuItemsForKotAssignment = async (zodu_id, branch_id) => {
  const result = await conn.query(
    `SELECT
       c.id AS category_id, c.name AS category_name,
       m.item_uuid AS menu_item_id, m.menu_id, m.menu_name, m.kot_counter_id
     FROM tbl_category c
     JOIN tbl_menu_items m ON m.menu_category_id = c.id
     WHERE c.zodu_id = $1 AND c.branch_id = $2 AND m.active = TRUE
     ORDER BY c.name ASC, m.menu_name ASC`,
    [zodu_id, branch_id]
  );
  return result.rows;
};

// Sets menu_item_ids (item_uuid values) as the COMPLETE set of items on
// kot_counter_id — an item previously on this counter but left out of
// menu_item_ids (unchecked in the UI) is cleared back to unassigned, not left
// stuck on this counter. Both statements run in one transaction so a failure
// never leaves items cleared without the new assignment applied.
exports.assignItemsToKotCounter = async (zodu_id, branch_id, kot_counter_id, menu_item_ids) => {
  if (!Array.isArray(menu_item_ids) || menu_item_ids.length === 0) {
    throw new Error("menu_item_ids array is empty or invalid");
  }
  try {
    await conn.query("BEGIN");

    await conn.query(
      `UPDATE tbl_menu_items
       SET kot_counter_id = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE kot_counter_id = $1 AND zodu_id = $2 AND branch_id = $3
         AND NOT (item_uuid = ANY($4::uuid[]))`,
      [kot_counter_id, zodu_id, branch_id, menu_item_ids]
    );

    const result = await conn.query(
      `UPDATE tbl_menu_items
       SET kot_counter_id = $1, updated_at = CURRENT_TIMESTAMP
       WHERE item_uuid = ANY($2::uuid[]) AND zodu_id = $3 AND branch_id = $4
       RETURNING item_uuid AS menu_item_id, menu_id, menu_name, kot_counter_id`,
      [kot_counter_id, menu_item_ids, zodu_id, branch_id]
    );

    await conn.query("COMMIT");
    return result.rows;
  } catch (err) {
    await conn.query("ROLLBACK");
    throw new Error("Unable to assign items to KOT counter: " + err.message);
  }
};
