const conn = require("../database/connection");

const INV_COLS = `
  i.item_uuid,
  i.item_id,
  i.zodu_id,
  i.branch_id,
  COALESCE(m.menu_name, i.item_name) AS item_name,
  i.stock_qty,
  i.stock_alert,
  i.created_at,
  m.sell_price,
  m.purchase_price,
  m.menu_image,
  m.menu_type,
  m.active        AS item_status,
  m.hsn_code,
  m.qr_code_id,
  c.name          AS category_name,
  u.short_name    AS unit_short_name,
  g.gst_rate
`;
 
const INV_FROM = `
  FROM tbl_inventory i
  LEFT JOIN tbl_menu_items m  ON m.item_uuid  = i.item_uuid
  LEFT JOIN tbl_category   c  ON c.id         = m.menu_category_id
  LEFT JOIN tbl_units      u  ON u.id         = m.menu_unit
  LEFT JOIN tbl_gst        g  ON g.id         = m.gst_tax
`;
 
// ─────────────────────────────────────────────────────────────
//  Derived stock status — mirrors the UI badge logic
//    Out of Stock  : available_qty = 0
//    Low Stock     : available_qty > 0 AND available_qty <= reorder_level
//    In Stock      : available_qty > reorder_level
// ─────────────────────────────────────────────────────────────
const STOCK_STATUS_EXPR = `
  CASE
    WHEN i.stock_qty = 0                              THEN 'out_of_stock'
    WHEN i.stock_qty <= i.stock_alert               THEN 'low_stock'
    ELSE                                                       'in_stock'
  END
`;

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


exports.getStockHistoryRepo = async ({ item_uuid, zodu_id, branch_id }) => {
  // ✅ 1. Get Item + Inventory Details (Always)
  console.log(item_uuid)
  const itemQuery = `
    SELECT
      inv.item_uuid,
      inv.item_id,
      COALESCE(m.menu_name, inv.item_name, 'Unknown Item') AS item_name,
      inv.stock_qty,
      inv.stock_alert
    FROM tbl_inventory inv
    LEFT JOIN tbl_menu_items m
      ON m.item_uuid = inv.item_uuid
    WHERE inv.item_uuid = $1
      AND inv.zodu_id = $2
      AND inv.branch_id = $3
  `;

  const itemResult = await conn.query(itemQuery, [item_uuid, zodu_id, branch_id]);

  if (itemResult.rows.length === 0) {
    return {
      item: null,
      data: [],
      summary: null
    };
  }

  const itemData = itemResult.rows[0];

  // ✅ 2. Get Ledger History (ONLY if exists)
  const historyQuery = `
    SELECT 
      l.ledger_id,
      l.transaction_type,

      COALESCE(
        CASE
          WHEN l.transaction_type IN ('purchase', 'purchase_item_added', 'purchase_item_qty_updated', 'purchase_item_removed', 'purchase_delete')
            THEN p.purchase_id::TEXT
        END,
        l.reference_id::TEXT
      ) AS reference_id,

      l.qty_change,
      l.stock_before,
      l.stock_after,
      l.notes,

      TO_CHAR(l.created_at, 'DD Mon YYYY, HH12:MI AM') AS created_at,

      CASE
        WHEN l.qty_change > 0 THEN 'IN'
        WHEN l.qty_change < 0 THEN 'OUT'
        ELSE 'ADJUST'
      END as movement_type,

      CASE
        WHEN l.transaction_type = 'sale_deleted' THEN 'Reverse'
        WHEN l.transaction_type IN ('sale', 'sale_update') THEN 'Sale'
        WHEN l.transaction_type = 'sale_update_reverse' THEN 'Sale Adjust'
        WHEN l.transaction_type = 'purchase' THEN 'Purchase'
        WHEN l.transaction_type IN ('purchase_item_added', 'purchase_item_qty_updated') THEN 'Purchase Update'
        WHEN l.transaction_type = 'purchase_item_removed' THEN 'Purchase Remove'
        WHEN l.transaction_type = 'purchase_delete' THEN 'Purchase Delete'
        ELSE INITCAP(REPLACE(l.transaction_type, '_', ' '))
      END AS label

    FROM tbl_stock_ledger l
    LEFT JOIN tbl_purchase p
      ON p.id = l.reference_id

    WHERE l.item_uuid = $1
      AND l.zodu_id = $2
      AND l.branch_id = $3

    ORDER BY l.created_at DESC;
  `;
  const historyResult = await conn.query(historyQuery, [item_uuid, zodu_id, branch_id]);
  return {
    // ✅ Common item info (ALWAYS)
    item: {
      item_uuid: itemData.item_uuid,
      item_id: itemData.item_id,
      item_name: itemData.item_name
    },
    // ✅ History (empty if no ledger)
    data: historyResult.rows,
    // ✅ Summary
    summary: {
      current_stock: itemData.stock_qty,
      low_stock_alert: itemData.stock_alert,
      is_low: Number(itemData.stock_qty) <= Number(itemData.stock_alert)
    }
  };
};

exports.getInventorySummary = async ({ zodu_id, branch_id }) => {
  const { rows } = await conn.query(
    `SELECT
       COALESCE(SUM(i.stock_qty::numeric * i.purchase_price::numeric), 0) AS total_stock_value,
       COUNT(*) FILTER (
         WHERE i.stock_qty::numeric > 0 AND i.stock_qty::numeric <= i.stock_alert::numeric
       )                                                                    AS low_stock_count,
       COUNT(*) FILTER (
         WHERE i.stock_qty::numeric = 0
       )                                                                    AS out_of_stock_count,
       COUNT(*)                                                             AS total_skus
     FROM tbl_inventory i
     WHERE i.zodu_id = $1 AND i.branch_id = $2`,
    [zodu_id, branch_id]
  );
  return rows[0];
};

exports.getInventoryByUuid = async (client, inventory_uuid) => {
  const { rows } = await client.query(
    `SELECT
       ${INV_COLS},
       ${STOCK_STATUS_EXPR} AS stock_status,
       ROUND(i.stock_qty * COALESCE(NULLIF(m.purchase_price, 'NULL')::numeric, 0), 2) AS stock_value
     ${INV_FROM}
     WHERE i.inventory_uuid = $1`,
    [inventory_uuid]
  );
  return rows[0] ?? null;
};

exports.adjustStock = async (
  client,
  { inventory_uuid, adjustment_type, adjustment_qty, reason, notes }
) => {
  const qty = Math.abs(adjustment_qty);

  const operator = adjustment_type === 'subtract' ? '-' : '+';

  const { rows } = await client.query(
    `UPDATE tbl_inventory
     SET
       stock_qty             = stock_qty ${operator} $1,
       reason_for_adjustment = COALESCE($3, reason_for_adjustment),
       notes                 = COALESCE($4, notes),
       updated_at            = NOW()
     WHERE inventory_uuid = $2
     RETURNING *`,
    [qty, inventory_uuid, reason || null, notes || null]
  );

  if (rows.length === 0) throw new Error('Inventory record not found');
  return rows[0];
};


exports.createStockLedger = async (client, data) => {
  const { rows } = await client.query(
    `INSERT INTO tbl_stock_ledger (
      item_uuid, item_id, zodu_id, branch_id,
      item_name, transaction_type,
      reference_id, qty_change,
      stock_before, stock_after, notes
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING *`,
    [
      data.item_uuid,
      data.item_id,
      data.zodu_id,
      data.branch_id,
      data.item_name,
      data.transaction_type,
      data.reference_id,
      data.qty_change,
      data.stock_before,
      data.stock_after,
      data.notes,
    ]
  );
  return rows[0];
};

exports.get_inventory_list = async (zodu_id, branch_id, type, category, search, page, limit) => {
  try {
    const inventoryType = !type || type === "null" || type === "undefined" ? null : type;
    const categoryIds = Array.isArray(category) && category.length > 0 ? category.map(Number) : null;
    const searchTerm = search && search.trim() ? `%${search.trim()}%` : null;

    const offset = (page - 1) * limit;

    const countQuery = `
      SELECT COUNT(*) AS total
      FROM tbl_inventory i
      WHERE i.zodu_id = $1
        AND i.branch_id = $2
        AND ($3::text IS NULL OR i.inventory_type = $3::text)
        AND ($4::int[] IS NULL OR i.category_id::int = ANY($4::int[]))
        AND ($5::text IS NULL OR i.item_name ILIKE $5 OR i.item_id ILIKE $5)
    `;

    const dataQuery = `
      SELECT
        i.*,
        c.name AS category_name,
        m.gst_tax,
        u.name       AS unit_name,
        u.short_name AS unit_short_name
      FROM tbl_inventory i
      LEFT JOIN tbl_category c   ON i.category_id = c.id
      LEFT JOIN tbl_menu_items m  ON i.item_id = m.menu_id
      LEFT JOIN tbl_units u      ON i.item_unit = u.id
      WHERE i.zodu_id = $1
        AND i.branch_id = $2
        AND ($3::text IS NULL OR i.inventory_type = $3::text)
        AND ($4::int[] IS NULL OR i.category_id::int = ANY($4::int[]))
        AND ($5::text IS NULL OR i.item_name ILIKE $5 OR i.item_id ILIKE $5)
      ORDER BY i.updated_at DESC
      LIMIT $6 OFFSET $7
    `;

    const [countResult, dataResult] = await Promise.all([
      conn.query(countQuery, [zodu_id, branch_id, inventoryType, categoryIds, searchTerm]),
      conn.query(dataQuery, [zodu_id, branch_id, inventoryType, categoryIds, searchTerm, limit, offset]),
    ]);

    const totalCount = parseInt(countResult.rows[0].total, 10);
    return {
      data: dataResult.rows,
      totalCount,
    };
  } catch (err) {
    throw new Error("Unable to fetch inventory data: " + err.message);
  }
};
