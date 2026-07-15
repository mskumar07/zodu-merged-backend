const conn = require("../database/connection");


exports. getHold = async (branch_id, zodu_id) => {
  try {
    const result = await conn.query(
      `
      SELECT 
        h.hold_id,
        h.zodu_id,
        h.branch_id,
        h.order_type,
        h.table_no,
        h.customer_name,
        h.customer_phone,
        h.created_at,
        COALESCE(
          json_agg(
            json_build_object(
              'id', hi.id,
              'item_name', hi.item_name,
              'item_id', hi.item_id,
              'item_unit', hi.item_unit,
              'qty', hi.qty,
              'price', hi.price,
              'variant_name', hi.variant_name,
              'variant_id', hi.variant_id
            )
          ) FILTER (WHERE hi.hold_id IS NOT NULL),
          '[]'
        ) AS items
      FROM tbl_hold h
      LEFT JOIN tbl_hold_items hi ON h.hold_id = hi.hold_id
      WHERE h.branch_id = $1 AND h.zodu_id = $2
      GROUP BY h.hold_id,h.zodu_id,h.branch_id,h.order_type,h.table_no,h.customer_name,h.customer_phone,h.created_at
      ORDER BY h.created_at DESC;
      `,
      [String(branch_id), String(zodu_id)]
    );

    return {
      success: true,
      data: result.rows,
    };
  } catch (err) {
    console.error("❌ Error in getHold:", err.message);
    return { success: false, message: err.message };
  }
};


exports.createHold = async (zodu_id, branch_id, orderType, table_no, customerName, customerPhone) => {
  console.log(zodu_id,"--------------");
  const query = `
    INSERT INTO tbl_hold (zodu_id, branch_id, order_type, table_no, customer_name, customer_phone)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING hold_id
  `;

  const result = await conn.query(query, [
    zodu_id,
    branch_id,
    orderType,
    table_no,
    customerName,
    customerPhone
  ]);
  console.log("Hold created with ID:", result.rows[0]);
  return result.rows[0].hold_id;
}

exports.updateHold = async (hold_id, orderType, table_no, customerName, customerPhone) => {
  const query = `
    UPDATE tbl_hold
    SET order_type = $2, table_no = $3, customer_name = $4, customer_phone = $5
    WHERE hold_id = $1
  `;

  await conn.query(query, [
    hold_id,
    orderType,
    table_no,
    customerName,
    customerPhone
  ]);
}

exports.bulkUpdateHoldItems = async (hold_id, items) => {
  if (!items.length) return;

  const columns = ["id", "item_name", "item_id", "item_unit", "qty", "price", "variant_name", "variant_id"];
  const params = [hold_id];
  const rows = items.map((item, i) => {
    const base = i * columns.length;
    params.push(
      item.id,
      item.item_name,
      item.item_id,
      item.item_unit || null,
      item.qty || 0,
      item.price || 0,
      item.variant_name || null,
      item.variant_id || null
    );
    return `($${base + 2}::int, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}::numeric, $${base + 7}::numeric, $${base + 8}, $${base + 9})`;
  });

  const query = `
    UPDATE tbl_hold_items AS hi
    SET item_name = v.item_name,
        item_id = v.item_id,
        item_unit = v.item_unit,
        qty = v.qty,
        price = v.price,
        variant_name = v.variant_name,
        variant_id = v.variant_id
    FROM (VALUES ${rows.join(",")}) AS v(id, item_name, item_id, item_unit, qty, price, variant_name, variant_id)
    WHERE hi.id = v.id AND hi.hold_id = $1
  `;

  await conn.query(query, params);
}

exports.bulkInsertHoldItems = async (hold_id, zodu_id, branch_id, items) => {
  if (!items.length) return;

  const columns = ["zodu_id", "branch_id", "hold_id", "item_name", "item_id", "item_unit", "qty", "price", "variant_name", "variant_id"];
  const params = [];
  const rows = items.map((item, i) => {
    const base = i * columns.length;
    params.push(
      zodu_id,
      branch_id,
      hold_id,
      item.item_name,
      item.item_id,
      item.item_unit || null,
      item.qty || 0,
      item.price || 0,
      item.variant_name || null,
      item.variant_id || null
    );
    return `(${columns.map((_, idx) => `$${base + idx + 1}`).join(", ")})`;
  });

  const query = `
    INSERT INTO tbl_hold_items (${columns.join(", ")})
    VALUES ${rows.join(",")}
  `;

  await conn.query(query, params);
}

exports.deleteHoldItemsExcept = async (hold_id, keepIds) => {
  if (!keepIds.length) {
    const query = `DELETE FROM tbl_hold_items WHERE hold_id = $1`;
    await conn.query(query, [hold_id]);
    return;
  }

  const query = `
    DELETE FROM tbl_hold_items
    WHERE hold_id = $1 AND id NOT IN (${keepIds.map((_, i) => `$${i + 2}`).join(",")})
  `;

  await conn.query(query, [hold_id, ...keepIds]);
};

exports.deleteHoldItems = async (hold_id) => {
  const query = `
    DELETE FROM tbl_hold_items  
    WHERE hold_id = $1 
  `;

  await conn.query(query, [hold_id]);
};

exports.deleteHold = async (hold_id) => {
  const query = `
    DELETE FROM tbl_hold
    WHERE hold_id = $1 
  `;

  await conn.query(query, [hold_id]);
};
