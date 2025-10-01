const conn = require('../database/connection');

// ========== Company Repository Functions ==========


async function createCompany(companyData) {
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

async function updateCompany(zodu_id, fields) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return null;

  const values = Object.values(fields);
  const setQuery = keys.map((k, i) => `${k}=$${i+1}`).join(', ');

  const res = await conn.query(
    `UPDATE tbl_company_registration
     SET ${setQuery}
     WHERE zodu_id=$${keys.length + 1}
     RETURNING *`,
    [...values, zodu_id]
  );
  return res.rows[0];
}

async function getCompanyByZoduId(zodu_id) {
  const res = await conn.query(
    `SELECT * FROM tbl_company_registration WHERE zodu_id=$1`,
    [zodu_id]
  );
  return res.rows[0];
}


async function isEventProcessed(eventId) {
  const res = await conn.query(`SELECT 1 FROM processed_events WHERE event_id=$1`, [eventId]);
  return res.rowCount > 0;
}

async function markEventProcessed({ eventId, topic, partition, offset }) {
  await conn.query(
    `INSERT INTO processed_events (event_id, topic, partition, msg_offset)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT DO NOTHING`,
    [eventId, topic, partition, offset]
  );
}

async function findMaxZoduId() {
  return await conn.query(
    'SELECT max(zodu_id) FROM tbl_company_registration');
}

// async function get_category_data() {
//   return await conn.query(
//     'SELECT name,zodu_id,branch_id,active FROM tbl_category');
// }

async function get_category_data(branch_id) {
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


// async function get_menuItem_data(branch_id) {
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

async function get_menuItem_data(branch_id) {
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
                'menu_id',m.menu_id
            )
          ) FILTER (WHERE m.id IS NOT NULL), '[]'
        ) AS items
    FROM tbl_category c
    LEFT JOIN tbl_menu_item m 
      ON c.id = m.menu_category_id 
     AND m.active = true
     AND m.branch_id = $1
    WHERE c.branch_id = $1
    GROUP BY c.name`,
    [branch_id]
  );
}




async function findMaxBranchID(zodu_id) {
  return await conn.query(
    'SELECT max(branch_id) FROM tbl_resturant_branch where zodu_id = $1',['ZODU001']);
}

async function FindExistingData(tbl_name, column_name, value) {
  console.log("repository", tbl_name, column_name, value);
  return await conn.query(
    `SELECT * FROM ${tbl_name} where ${column_name} = $1`,[value]);
}

async function createBranch(branchData) {
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

async function createQRCode(qr_code) {
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
  
async function createCategory(zodu_id, branch_id, name) {
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


async function getNextMenuId(zoduId, branchId) {
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

async function updateFavorite( menuId, favoriteValue) {
  try {
    const query = `
      UPDATE tbl_menu_item
      SET favorites = $1
      WHERE menu_id = $2
      RETURNING *;
    `;

    const values = [favoriteValue, menuId];
    const result = await conn.query(query, values);

    return result.rows[0]; // return the updated row
  } catch (error) {
    console.error("Error updating favorites:", error);
    throw error;
  }
}

async function updateActive( menuId, active) {
  try {
    const query = `
      UPDATE tbl_menu_item
      SET active = $1
      WHERE menu_id = $2
      RETURNING *;
    `;

    const values = [active, menuId];
    const result = await conn.query(query, values);

    return result.rows[0]; // return the updated row
  } catch (error) {
    console.error("Error updating favorites:", error);
    throw error;
  }
}




async function createMenuItem(menuData) {
  try {
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
    return result.rows[0];
  } catch (err) {
    throw new Error("Unable to create menu: " + err.message);
  }
}


module.exports = {
  createCompany,
  findMaxZoduId,
  FindExistingData,
  findMaxBranchID,
  createBranch,
  createQRCode,
  createCategory,
  createMenuItem,
  get_category_data,
  get_menuItem_data,
  isEventProcessed,
  markEventProcessed,
  updateCompany,
  getCompanyByZoduId,
  getNextMenuId,
  updateFavorite,
  updateActive
};