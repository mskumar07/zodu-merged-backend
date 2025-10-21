const { get } = require('../api/restaurant-controller');
const conn = require('../database/connection');

// ========== Company Repository Functions ==========


exports.createCompany= async (companyData) => {
  const query = `
  INSERT INTO tbl_company_registration (
    zodu_id, restaurant_name, mobile_no, mail_id
  )
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (zodu_id) DO NOTHING
  RETURNING *;
`;


  const values = [
    companyData.zodu_id,
    companyData.restaurant_name,
    companyData.mobile_no,
    companyData.mail_id,
    // companyData.gst_no,
    // companyData.pincode,
    // companyData.city,
    // companyData.district,
    // companyData.state,
    // companyData.building_no,
    // companyData.area_street_name,
    // companyData.account_number,
    // companyData.account_type,
    // companyData.ifsc_code,
  ];

  const { rows } = await conn.query(query, values);
  if (rows) {
    return rows[0];
  }
  throw new Error('Unable to create company');
}

exports.updateCompany = async (zodu_id, fields) => {
  const keys = Object.keys(fields);
  if (keys.length === 0) return null;

  const values = Object.values(fields);
  const setQuery = keys.map((k, i) => `${k}=$${i + 1}`).join(', ');

  const res = await conn.query(
    `UPDATE tbl_company_registration
     SET ${setQuery}
     WHERE zodu_id=$${keys.length + 1}
     RETURNING *`,
    [...values, zodu_id]
  );
  return res.rows[0];
}

exports.getCompanyByZoduId = async (zodu_id) => {
  const res = await conn.query(
    `SELECT * FROM tbl_company_registration WHERE zodu_id=$1`,
    [zodu_id]
  );
  return res.rows[0];
}


exports.isEventProcessed = async (eventId) => {
  const res = await conn.query(`SELECT 1 FROM processed_events WHERE event_id=$1`, [eventId]);
  return res.rowCount > 0;
}

exports.markEventProcessed = async ({ eventId, topic, partition, offset }) => {
  await conn.query(
    `INSERT INTO processed_events (event_id, topic, partition, msg_offset)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT DO NOTHING`,
    [eventId, topic, partition, offset]
  );
}

exports.findMaxZoduId = async () => {
  return await conn.query(
    'SELECT max(zodu_id) FROM tbl_company_registration');
}

// exports.get_category_data() {
//   return await conn.query(
//     'SELECT name,zodu_id,branch_id,active FROM tbl_category');
// }

exports.get_category_data = async (branch_id) => {
  try {
    const query = `
      SELECT name, zodu_id, branch_id, active
      FROM tbl_category
      WHERE branch_id = $1
    `;
    const result = await conn.query(query, [branch_id]);
    return result.rows;
  } catch (err) {
    throw new Error("Unable to fetch category data: " + err.message);
  }
}


// exports.get_menuItem_data(branch_id) {
//   return await conn.query(
//     `SELECT 
//     c.name,
//     json_agg(
//         json_build_object(
// 		'zodu_id', m.zodu_id,
// 		'branch_id',m.branch_id,
//             'menu_name', m.menu_name,
// 			'variants', m.variants,
// 			'qr_code', q.qr_code,
//             'sell_price', m.sell_price,
// 			'purchase_price', m.purchase_price,
// 			'hsn_code', m.hsn_code,
// 			'gst_tax', m.gst_tax,
//             'food_type', m.food_type,
//             'tax_include_or_exclude', m.tax_include_or_exclude,
//             'count', 10,
//             'menu_image', m.menu_image,
// 			'menu_type',m.menu_type
//         )
//     ) AS items
// FROM tbl_category c
// JOIN tbl_menu_item m ON c.id = m.menu_category_id and m.active = true
// join tbl_qr_code q ON q.id = m.qr_code_id 
// GROUP BY c.name`
// );
// }

exports.get_menuItem_data = async (branch_id) =>  {
  return await conn.query(
    `SELECT 
        c.name,
        COALESCE(
          json_agg(
            json_build_object(
                'zodu_id', m.zodu_id,
                'branch_id', m.branch_id,
                'menu_name', m.menu_name,
                'variants', m.variants,
                'sell_price', m.sell_price,
                'purchase_price', m.purchase_price,
                'hsn_code', m.hsn_code,
                'gst_tax', m.gst_tax,
                'active', m.active,
                'food_type', m.food_type,
                'tax_include_or_exclude', m.tax_include_or_exclude,
                'count', 10,
                'menu_image', m.menu_image,
                'menu_type', m.menu_type,
                'menu_unit', m.menu_unit,
                'favorites', m.favorites,
                'menu_id', m.menu_id,
                'category', c.name
            )
          ) FILTER (WHERE m.id IS NOT NULL), '[]'
        ) AS items
    FROM tbl_category c
    LEFT JOIN tbl_menu_item m 
      ON c.id = m.menu_category_id 
     AND m.branch_id = $1
    WHERE c.branch_id = $1
    GROUP BY c.name`,
    [branch_id]
  );
}


exports.get_ordered_data = async (branch_id) => {
  const query = `
    SELECT 
      o.order_id,
      o.table_no,
      o.order_type,
      o.customer_name,
      o.customer_phone,
      o.total_amt,
      o.final_payment,
      o.branch_id,
      o.order_date,
      o.order_time,
      COALESCE(
        JSON_AGG(
          DISTINCT JSONB_BUILD_OBJECT(
            'item_id', i.item_id,
            'item_name', i.item_name,
            'qty', i.qty,
            'price', i.price,
            'item_unit', i.item_unit
          )
        ) FILTER (WHERE i.item_id IS NOT NULL), '[]'
      ) AS ordered_items,
      COALESCE(
        JSON_AGG(
          DISTINCT JSONB_BUILD_OBJECT(
            'kot_no', k.kot_no,
            'item_id', k.item_id,
            'item_name', k.item_name,
            'qty', k.qty,
            'table_no', k.table_no
          )
        ) FILTER (WHERE k.item_id IS NOT NULL), '[]'
      ) AS kot_items
    FROM tbl_orders o
    LEFT JOIN tbl_ordered_items i ON o.order_id = i.order_id
    LEFT JOIN tbl_kot_list k ON o.order_id = k.order_id
    WHERE o.branch_id = $1
      AND o.final_payment = false
    GROUP BY o.order_id, o.table_no, o.order_type, o.customer_name, 
             o.customer_phone, o.total_amt, o.final_payment, 
             o.order_date, o.order_time, o.branch_id;
  `;

  const values = [branch_id];

  const { rows } = await conn.query(query, values);

  if (rows.length === 0) {
    throw new Error('No active unpaid order found for this table');
  }

  return rows;
}



exports.findMaxBranchID = async (zodu_id) => {
  return await conn.query(
    'SELECT max(branch_id) FROM tbl_resturant_branch where zodu_id = $1', ['ZODU001']);
}

exports.FindExistingData = async (tbl_name, column_name, value) => {
  console.log("repository", tbl_name, column_name, value);
  return await conn.query(
    `SELECT * FROM ${tbl_name} where ${column_name} = $1`, [value]);
}

exports.createBranch = async (branchData) => {
  console.log("repository branchData", branchData);
  try {
    const query = `
      INSERT INTO tbl_resturant_branch (
        branch_id, zodu_id, qr_code_id, branch_name, branch_manager_or_admin,
        branch_mobile_no, branch_mail_id, branch_city, branch_pincode, branch_district,
        branch_state, branch_image, fssai, opening_hours, branch_floor_building_no,
        branch_area_street_name, branch_account_no, branch_ifsc, branch_account_type
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15,
        $16, $17, $18, $19
      )
      RETURNING *;
    `;

    const values = [
      branchData.branch_id,
      branchData.zodu_id,
      // branchData.qr_code_id,
      '3',
      branchData.branch_name,
      branchData.branch_manager_or_admin,
      branchData.branch_mobile_no,
      branchData.branch_mail_id,
      branchData.branch_city,
      branchData.branch_pincode,
      branchData.branch_district,
      branchData.branch_state,
      branchData.branch_image,
      branchData.fssai,
      branchData.opening_hours ? JSON.stringify(branchData.opening_hours) : null,
      branchData.branch_floor_building_no,
      branchData.branch_area_street_name,
      branchData.branch_account_no,
      branchData.branch_ifsc,
      branchData.branch_account_type,
    ];

    const { rows } = await conn.query(query, values);
    if (rows.length === 0) {
      throw new Error('No branch created');
    }
    return rows[0];
  } catch (err) {
    throw new Error('Unable to create branch: ' + err.message);
  }
}

exports.createQRCode = async (qr_code) => {
  try {
    const query = `
      INSERT INTO tbl_qr_code (
        qr_code
      ) VALUES ( $1 )
      RETURNING *;
    `;
    const values = [
      qr_code
    ];
    const { rows } = await conn.query(query, values);
    if (rows.length === 0) {
      throw new Error('QR Code not created');
    }
    return rows[0];
  } catch (err) {
    throw new Error('Unable to create QR Code: ' + err.message);
  }
}

exports.createCategory = async (zodu_id, branch_id, name) => {
  try {
    // 1️⃣ Check if category already exists in this branch
    const checkQuery = `
      SELECT * FROM tbl_category
      WHERE zodu_id = $1 AND branch_id = $2 AND name = $3
      LIMIT 1;
    `;
    const checkValues = [zodu_id, branch_id, name];
    const checkResult = await conn.query(checkQuery, checkValues);

    if (checkResult.rows.length > 0) {
      // ✅ Category already exists → return existing
      return checkResult.rows[0];
    }

    // 2️⃣ Otherwise, insert new category
    const insertQuery = `
      INSERT INTO tbl_category (zodu_id, branch_id, name)
      VALUES ($1, $2, $3)
      RETURNING *;
    `;
    const insertValues = [zodu_id, branch_id, name];
    const insertResult = await conn.query(insertQuery, insertValues);

    if (insertResult.rows.length === 0) {
      throw new Error("Category not created");
    }

    return insertResult.rows[0];
  } catch (err) {
    throw new Error("Unable to create Category: " + err.message);
  }
}


exports.createnewVendor = async (vendorData) => {
  try {
    const { zodu_id, branch_id, vendor_name, vendor_phone, vendor_email, vendor_address, company_name } = vendorData;

    const insertQuery = `
      INSERT INTO tbl_vendor (zodu_id, branch_id, vendor_name, vendor_phone, vendor_email, vendor_address,company_name)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *;
    `;
    const insertValues = [zodu_id, branch_id, vendor_name, vendor_phone, vendor_email, vendor_address, company_name];
    const insertResult = await conn.query(insertQuery, insertValues);

    if (insertResult.rows.length === 0) {
      throw new Error("Vendor not created");
    }

    return insertResult.rows[0];
  } catch (err) {
    throw new Error("Unable to create Vendor: " + err.message);
  }
}

exports.getVendor = async (branch_id) => {
  try {
    const query = `
      SELECT *
      FROM tbl_vendor
      WHERE branch_id = $1
    `;
    const result = await conn.query(query, [branch_id]);
    console.log(result)
    return result.rows;
  } catch (err) {
    throw new Error("Unable to fetch vendor data: " + err.message);
  }
}

exports.getVendorId = async (zoduId, branchId, vendor) => {
  try {
    const query = `
      SELECT * FROM tbl_vendor
      WHERE zodu_id = $1 AND branch_id = $2 AND vendor_name = $3
      LIMIT 1;
    `;
    const values = [zoduId, branchId, vendor];
    const result = await conn.query(query, values);
    return result.rows[0]; // return the vendor if found
  } catch (err) {
    throw new Error("Unable to get Vendor: " + err.message);
  }
}

exports.getNextMenuId = async (zoduId, branchId) => {
  try {
    await conn.query("BEGIN");

    // Lock all rows for this branch to prevent race condition
    const result = await conn.query(
      `SELECT menu_id 
       FROM tbl_menu_item
       WHERE zodu_id = $1 AND branch_id = $2
       ORDER BY menu_id DESC
       LIMIT 1
       FOR UPDATE`,
      [zoduId, branchId]
    );

    let nextNumber = 1;

    if (result.rows.length > 0) {
      // Extract last part (e.g. 003 from zodu-branch-003)
      const lastId = result.rows[0].menu_id;
      const lastNum = parseInt(lastId.split("-").pop(), 10);
      nextNumber = lastNum + 1;
    }

    await conn.query("COMMIT");

    return String(nextNumber).padStart(3, "0"); // 001, 002...
  } catch (err) {
    await conn.query("ROLLBACK");
    throw err;
  }
}

exports.getNextOrderId = async (branchId) => {
  try {
    await conn.query("BEGIN");

    // Lock all rows for this branch to prevent race condition
    const result = await conn.query(
      `SELECT order_id 
       FROM tbl_orders
       WHERE branch_id = $1
       ORDER BY order_id DESC
       LIMIT 1
       FOR UPDATE`,
      [branchId]
    );

    let nextNumber = 1;
    if (result.rows.length > 0) {
      const lastId = result.rows[0].order_id; // e.g. Z001-O012
      const lastNum = parseInt(lastId.split("-O")[1]);
      nextNumber = lastNum + 1;
    }

    await conn.query("COMMIT");

    return String(nextNumber).padStart(3, "0"); // 001, 002...
  } catch (err) {
    await conn.query("ROLLBACK");
    throw err;
  }
}

exports.getNextPurchaseId = async (branchId) => {
  try {
    await conn.query("BEGIN");

    // Lock all rows for this branch to prevent race condition
    const result = await conn.query(
      `SELECT purchase_id 
       FROM tbl_purchase
       WHERE branch_id = $1
       ORDER BY purchase_id DESC
       LIMIT 1
       FOR UPDATE`,
      [branchId]
    );

    let nextNumber = 1;
    if (result.rows.length > 0) {
      const lastId = result.rows[0].purchase_id; // e.g. Z001-O012
      const lastNum = parseInt(lastId.split("-PO")[1]);
      nextNumber = lastNum + 1;
    }

    await conn.query("COMMIT");

    return String(nextNumber).padStart(3, "0"); // 001, 002...
  } catch (err) {
    await conn.query("ROLLBACK");
    throw err;
  }
}

exports.updateFavorite = async (menuId, favoriteValue) => {
  try {
    await conn.query('BEGIN');

    const query = `
      UPDATE tbl_menu_item
      SET favorites = $1
      WHERE menu_id = $2
      RETURNING *;
    `;

    const values = [favoriteValue, menuId];
    const result = await conn.query(query, values);

    await conn.query('COMMIT');
    return result.rows[0]; // return the updated row
  } catch (error) {
    await conn.query('ROLLBACK');
    console.error("Error updating favorites:", error);
    throw error;
  }
}

exports.updateActive = async (menuId, active) => {
  try {
    await conn.query('BEGIN');

    const query = `
      UPDATE tbl_menu_item
      SET active = $1
      WHERE menu_id = $2
      RETURNING *;
    `;

    const values = [active, menuId];
    const result = await conn.query(query, values);
    await conn.query('COMMIT');
    return result.rows[0]; // return the updated row
  } catch (error) {
    await conn.query('ROLLBACK');
    console.error("Error updating favorites:", error);
    throw error;
  }
}




exports.createMenuItem = async (menuData) => {
  try {
    await conn.query('BEGIN');
    const query = `
      INSERT INTO tbl_menu_item (
        zodu_id, branch_id, menu_category_id, menu_name, menu_type, food_type,
        variants, qr_code_id, sell_price, purchase_price,
        hsn_code, gst_tax, tax_include_or_exclude, menu_image, menu_code, menu_id, menu_unit,favorites
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15, $16, $17,$18
      )
      RETURNING *;
    `;

    const values = [
      menuData.zodu_id,
      menuData.branch_id,
      menuData.menu_category_id,
      menuData.menu_name,
      menuData.menu_type,
      menuData.food_type,
      menuData.variants ? JSON.stringify(menuData.variants) : null,
      menuData.qr_code_id,
      menuData.sell_price,
      menuData.purchase_price,
      menuData.hsn_code,
      menuData.gst_tax,
      menuData.tax_include_or_exclude,
      menuData.menu_image,
      menuData.menu_code,
      menuData.menu_id,
      menuData.menu_unit,
      menuData.favorites
    ];

    const result = await conn.query(query, values);
    await conn.query('COMMIT');
    return result.rows[0];
  } catch (err) {
    await conn.query('ROLLBACK');
    throw new Error("Unable to create menu: " + err.message);
  }
}


// ✅ Create or Update Order
exports.createOrder = async (orderData) => {
  try {
    await conn.query('BEGIN');
    // Check if order already exists (same order_id & table_no)
    const checkQuery = `
      SELECT * FROM tbl_orders
      WHERE order_id = $1 AND table_no = $2
    `;
    const checkValues = [orderData.order_id, orderData.table_no];
    const existing = await conn.query(checkQuery, checkValues);

    let result;

    if (existing.rows.length > 0) {
      // 🟡 Existing order found → update total, item count & time
      const updateQuery = `
        UPDATE tbl_orders
        SET 
          total_amt = total_amt + $1,
          no_of_items = no_of_items + $2,
          final_payment = final_payment +3,
          order_time = CURRENT_TIMESTAMP
        WHERE order_id = $4 AND table_no = $5
        RETURNING *;
      `;
      const updateValues = [
        orderData.total_amt,      // new added total
        orderData.no_of_items,    // new added item count
        orderData.order_id,
        orderData.final_payment,
        orderData.table_no
      ];
      result = await conn.query(updateQuery, updateValues);

    } else {
      // 🟢 Create new order
      const insertQuery = `
        INSERT INTO tbl_orders (
          zodu_id, branch_id, table_no, no_of_items, order_type,
          customer_name, customer_phone, total_amt, final_payment,
          order_id, order_date, order_time
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *;
      `;
      const insertValues = [
        orderData.zodu_id,         // $1
        orderData.branch_id,       // $2
        orderData.table_no,        // $3
        orderData.no_of_items,     // $4
        orderData.order_type,      // $5
        orderData.customer_name,   // $6
        orderData.customer_phone,  // $7
        orderData.total_amt,       // $8
        orderData.final_payment,   // $9
        orderData.order_id,        // $10
        orderData.order_date,      // $11
        orderData.order_time       // $12
      ];

      result = await conn.query(insertQuery, insertValues);
    }
    await conn.query('COMMIT');
    return result.rows[0];
  } catch (err) {
    await conn.query('ROLLBACK');
    throw new Error("Unable to create or update order: " + err.message);
  }
}



// ✅ Create or Update Ordered Items
exports.createOrderedItems = async (orderData) => {
  try {
    await conn.query('BEGIN');
    const items = orderData.items;
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("Items array is empty or invalid");
    }

    const insertedItems = [];

    for (const item of items) {
      const hasVariant = !!item.variant_id;

      // ✅ Build dynamic check query based on variant existence
      const checkQuery = hasVariant
        ? `
          SELECT * FROM tbl_ordered_items
          WHERE order_id = $1 AND item_id = $2 AND variant_id = $3
        `
        : `
          SELECT * FROM tbl_ordered_items
          WHERE order_id = $1 AND item_id = $2 AND variant_id IS NULL
        `;

      const checkValues = hasVariant
        ? [orderData.order_id, item.menu_id, item.variant_id]
        : [orderData.order_id, item.menu_id];

      const existingItem = await conn.query(checkQuery, checkValues);

      if (existingItem.rows.length > 0) {
        // 🟡 Item exists → update qty and price
        const updateQuery = hasVariant
          ? `
            UPDATE tbl_ordered_items
            SET qty = qty + $1,
                price = price + $2
            WHERE order_id = $3 AND item_id = $4 AND variant_id = $5
            RETURNING *;
          `
          : `
            UPDATE tbl_ordered_items
            SET qty = qty + $1,
                price = price + $2
            WHERE order_id = $3 AND item_id = $4 AND variant_id IS NULL
            RETURNING *;
          `;

        const updateValues = hasVariant
          ? [item.qty, item.price, orderData.order_id, item.menu_id, item.variant_id]
          : [item.qty, item.price, orderData.order_id, item.menu_id];

        const result = await conn.query(updateQuery, updateValues);

        insertedItems.push(result.rows[0]);
      } else {
        // 🟢 New item → insert (with or without variant)
        const insertQuery = `
          INSERT INTO tbl_ordered_items (
            zodu_id,
            branch_id,
            order_id,
            item_id,
            item_name,
            qty,
            price,
            item_unit,
            variant_id,
            variant_name
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING *;
        `;

        const insertValues = [
          orderData.zodu_id,
          orderData.branch_id,
          orderData.order_id,
          item.menu_id,
          item.name,
          item.qty,
          item.price,
          item.menu_unit,
          hasVariant ? item.variant_id : null,
          hasVariant ? item.variant_name : null,
        ];

        const result = await conn.query(insertQuery, insertValues);
        insertedItems.push(result.rows[0]);
      }
    }
    await conn.query('COMMIT');
    return insertedItems;
  } catch (err) {
    await conn.query('ROLLBACK');
    throw new Error("Unable to create or update ordered items: " + err.message);
  }
}


exports.createKOT = async (orderData) => {
  try {
    await conn.query('BEGIN');
    const items = orderData.items;

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('Items array is empty or invalid');
    }
    const insertedItems = []; // 🧩 store all inserted item rows
    for (const item of items) {
      const query = `
    INSERT INTO tbl_kot_list (
      zodu_id, branch_id, order_id,kot_no, item_id, item_name, qty, table_no
    )
    VALUES ($1, $2, $3,$4, $5, $6, $7, $8)
    RETURNING *;
  `;

      const values = [
        orderData.zodu_id,   // $1
        orderData.branch_id, // $2
        orderData.order_id,  // $3
        orderData.kot_no,
        item.menu_id,        // $4  ✅ moved here (matches item_id)
        item.name,           // $5
        item.qty,            // $6
        orderData.table_no,  // $7  ✅ placed last to match SQL order
      ];

      const result = await conn.query(query, values);
      insertedItems.push(result.rows[0]);
    }

    await conn.query('COMMIT');

    // ✅ Return all inserted rows after loop completes
    return insertedItems;

  } catch (err) {
    await conn.query('ROLLBACK');
    throw new Error('Unable to create Kot: ' + err.message);
  }
}
// services/purchaseService.js
exports.createPurchaseOrder = async (orderData) => {
  try {
    await conn.query('BEGIN');
    const {
      zodu_id,
      branch_id,
      vendor,
      category,
      purchase_id,
      purchase_date,
      purchase_type,
      total_amount,
      paid_amount,
      attachment_url,
      payment_type,
      notes
    } = orderData;

    const result = await conn.query(
      `INSERT INTO tbl_purchase
      (
        purchase_id,
        vendor_id,
        zodu_id,
        branch_id,
        purchase_date,
        purchase_type,
        total_amount,
        paid_amount,
        attachment_url,
        payment_type,
        notes,
        category_id
      )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        purchase_id,
        vendor,
        zodu_id,
        branch_id,
        purchase_date,
        purchase_type,
        total_amount,
        paid_amount,
        attachment_url,
        payment_type,
        notes,
        category
      ]
    );
    await conn.query('COMMIT');
    return result.rows;
  } catch (err) {
    await conn.query('ROLLBACK');
    throw new Error("Unable to create Purchase Order: " + err.message);
  }
};

exports.insertPurchaseItems = async (purchase_id, items) => {
  try {
    await conn.query('BEGIN');
    for (const item of items) {
      console.log(item, purchase_id);
      await conn.query(
        `INSERT INTO tbl_purchase_items (purchase_id, item_id, item_name, qty, unit, purchase_price)
       VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          purchase_id,
          item.id,
          item.name,
          item.qty,
          item.unit,
          item.purchase_price,
        ]
      );
    }
    await conn.query('COMMIT');
    return { success: true, message: "Purchase Items inserted successfully" };
  } catch (err) {
    await conn.query('ROLLBACK');
    throw new Error("Unable to insert Purchase Items: " + err.message);
  }
}

exports.addInventory = async (items, branch_id, zodu_id, purchase_date, category_id) => {
  try {
    await conn.query('BEGIN');
    for (const item of items) {
      // Check if the item already exists in inventory
      const existing = await conn.query(
        `SELECT item_id FROM tbl_inventory WHERE item_id = $1`,
        [item.id]
      );

      if (existing.rows.length > 0) {
        // ✅ If exists → update quantity
        await conn.query(
          `UPDATE tbl_inventory
         SET stock_qty = stock_qty + $1
         WHERE item_id = $2`,
          [item.qty, item.id]
        );
      } else {
        // 🆕 If not exists → insert new item record
        await conn.query(
          `INSERT INTO tbl_inventory (zodu_id,branch_id, item_id, category_id, item_name,item_unit, stock_qty, stock_alert,purchase_price, selling_price,last_purchase_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [zodu_id, branch_id, item.id, category_id, item.name, item.unit, item.qty, item.stock_alert, item.purchase_price, item.selling_price, purchase_date]
        );
      }
    }
    await conn.query('COMMIT');
    return { success: true, message: "Inventory updated successfully" };
  } catch (err) {
    await conn.query('ROLLBACK');
    throw new Error("Unable to update Inventory: " + err.message);
  }
};

exports.addExpense = async (orderData) => {
  try {
    await conn.query('BEGIN');
    // 🔍 Check if expense already exists (by expense_id or purchase description)
    const existing = await conn.query(
      `SELECT expense_id 
       FROM tbl_expense 
       WHERE expense_id = $1 
         AND branch_id = $2`,
      [
        orderData.expense_id || null,
        orderData.branch_id
      ]
    );

    if (existing.rows.length > 0) {
      // ✅ Update existing expense
      await conn.query(
        `UPDATE tbl_expense
         SET 
           payment_amount = $1,
           expense_date = $2,
           balance_amount = $4,
           updated_at = NOW()
         WHERE expense_id = $3`,
        [orderData.total_amount, orderData.order_date, existing.rows[0].expense_id, orderData.balance_amount]
      );
    } else {
      // 🆕 Insert new expense record
      const result = await conn.query(
        `SELECT expense_id 
       FROM tbl_expense
       WHERE branch_id = $1
       ORDER BY expense_id DESC
       LIMIT 1
       FOR UPDATE`,
        [orderData.branch_id]
      );

      let nextNumber = 1;
      if (result.rows.length > 0) {
        const lastId = result.rows[0].expense_id; // e.g. Z001-O012
        const lastNum = parseInt(lastId.split("-EXP")[1]);
        nextNumber = lastNum + 1;
      }
      orderData.expense_id = orderData.branch_id + '-EXP-' + String(nextNumber).padStart(3, "0");

      const categoryName = await conn.query(
        `SELECT name FROM tbl_category WHERE branch_id = $1 AND id = $2 LIMIT 1`,
        [orderData.branch_id, orderData.category]
      );
      orderData.expense_name = categoryName.rows[0].name;

      if (!orderData.expense_date) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  orderData.expense_date = `${year}-${month}-${day}`;
}

if (!orderData.balance_amount) {
  orderData.balance_amount = orderData.total_amount - (orderData.paid_amount || 0);
}

      await conn.query(
  `INSERT INTO tbl_expense 
    (zodu_id, branch_id, category_id, expense_id, expense_name, expense_date, payment_amount, balance_amount, description,attachment_url, created_at)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
  [
    orderData.zodu_id,              // $1
    orderData.branch_id,            // $2
    orderData.category,          // $3
    orderData.expense_id,           // $4
    orderData.expense_name,         // $5
    orderData.expense_date,           // $6
    orderData.total_amount,         // $7
    orderData.balance_amount || 0,  // $8
    `Purchase Order ${orderData.expense_id}` ,// $9 ✅ fixed
    orderData.attachment_url || null // $10
  ]
);

    }
    if (Array.isArray(orderData.items) && orderData.items.length > 0) {
      const insertItemQuery = `
        INSERT INTO tbl_expense_items 
          ( expense_id,item_id, item_name, qty, price, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
      `;

      for (const item of orderData.items) {
        await conn.query(insertItemQuery, [
          orderData.expense_id,
          item.id,
          item.name,
          item.qty,
          item.purchase_price,
        ]);
      }
    }

    await conn.query('COMMIT');
    return { success: true, message: "Expense synced with purchase" };

  } catch (error) {
    await conn.query('ROLLBACK');
    console.error("Error in addExpenseFromPurchase:", error.message);
    return {
      success: false,
      message: "Failed to add or update expense: " + error.message
    };
  }
}





