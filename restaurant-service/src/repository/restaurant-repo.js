const moment = require('moment/moment');
const { get, search } = require('../api/restaurant-controller');
const conn = require('../database/connection');

// ========== Company Repository Functions ==========


exports.createCompany = async (companyData) => {
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

exports.get_category_data = async (type,branch_id) => {
  try {

    const query = `
      SELECT *
      FROM tbl_category
      WHERE type = $1 AND branch_id = $2
      ORDER BY id ASC
    `;

    const result = await conn.query(query, [type, branch_id]);

    return result.rows;
  } catch (err) {
    throw new Error("Unable to fetch category data: " + err.message);
  }
}

exports.deleteMenuItem = async (menuId) => {
  try {
    await conn.query("BEGIN");

    // Get menu_type before delete
    const menu = await conn.query(
      `SELECT menu_type FROM tbl_menu_item WHERE menu_id = $1`,
      [menuId]
    );

    if (menu.rows.length === 0) {
      throw new Error("Menu item not found");
    }

    const menuType = menu.rows[0].menu_type;

    // Delete menu item
    await conn.query(`DELETE FROM tbl_menu_item WHERE menu_id = $1`, [menuId]);

    // If product → delete from inventory table
    if (menuType && menuType.toLowerCase() === "product") {      await conn.query(
        `DELETE FROM tbl_inventory WHERE item_id = $1`,
        [menuId]
      );
    }

    await conn.query("COMMIT");
    return { success: true, message: "Menu deleted successfully" };

  } catch (err) {
    await conn.query("ROLLBACK");
    throw new Error("Unable to delete menu: " + err.message);
  }
};

exports.get_expense_category_data = async (branch_id) => {
  try {
    const query = `
  SELECT category_name AS name, zodu_id, branch_id,id
  FROM tbl_expense_category
  WHERE branch_id = $1
`;

    const result = await conn.query(query, [branch_id]);

    return result.rows;
  } catch (err) {
    throw new Error("Unable to fetch category data: " + err.message);
  }

}



exports.get_purchase_category_data = async (branch_id) => {
  try {
    const query = `
  SELECT category_name AS name, zodu_id, branch_id
  FROM tbl_purchase_category
  WHERE branch_id = $1
`;

    const result = await conn.query(query, [branch_id]);

    return result.rows;
  } catch (err) {
    throw new Error("Unable to fetch category data: " + err.message);
  }
}

exports.updateMenuItem = async (menuId, data) => {
  try {
    await conn.query("BEGIN");
const query = `
  UPDATE tbl_menu_item
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
  data.menu_category_id,           // $1
  data.menu_name,               // $2
  data.menu_type,               // $3
  data.food_type,               // $4
  JSON.stringify(data.variants),// $5
  data.sell_price,              // $6
  data.purchase_price,          // $7
  data.hsn_code,                // $8
  data.gst_tax,                 // $9
  data.tax_include_or_exclude,  // $10
  data.menu_image,              // $11 (URL or null)
  data.menu_code,               // $12
  data.menu_unit,               // $13 (unit id)
  data.favorites ?? null,       // $14
  menuId                       // $15 (WHERE menu_id = ?)
];


    const result = await conn.query(query, values);
    const updatedMenu = result.rows[0];

    if (!updatedMenu) throw new Error("Menu item not found");

    // ============================
    //  UPDATE INVENTORY (if product)
    // ============================
    if (updatedMenu.menu_type.toLowerCase() === "product") {
      const invCheck = await conn.query(
        `SELECT * FROM tbl_inventory WHERE item_id = $1`,
        [menuId]
      );

      if (invCheck.rows.length > 0) {
        // Update inventory fields
        await conn.query(
          `UPDATE tbl_inventory
           SET 
             item_name = $1,
             purchase_price = $2,
             selling_price = $3,
             item_unit = $4
           WHERE item_id = $5`,
          [
            updatedMenu.menu_name,
            updatedMenu.purchase_price,
            updatedMenu.sell_price,
            updatedMenu.menu_unit,
            menuId,
          ]
        );
      } else {
        // Insert fresh inventory row
        await conn.query(
  `INSERT INTO tbl_inventory 
    (zodu_id, branch_id, item_id, category_id, item_name, item_unit,
     stock_qty, stock_alert, purchase_price, selling_price, last_purchase_date)
    VALUES ($1,$2,$3,$4,$5,$6,0,$7,$8,$9,NOW())`,
  [
    updatedMenu.zodu_id,
    updatedMenu.branch_id,
    updatedMenu.menu_id,
    updatedMenu.menu_category_id,
    updatedMenu.menu_name,
    updatedMenu.menu_unit,
    0,                       // stock_alert
    updatedMenu.purchase_price,
    updatedMenu.sell_price
  ]
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


exports.get_inventory_list = async (branch_id, type, category) => {
  try {
    // Normalize all possible bad values → null
    const inventoryType =
      type === undefined ||
      type === null ||
      type === "" ||
      type === "null" ||
      type === "undefined"
        ? null
        : type;

    const categoryId =
      category === undefined ||
      category === null ||
      category === "" ||
      category === "0" ||
      category === "null" ||
      category === "undefined"
        ? null
        : Number(category);


    const query = `
      SELECT 
        i.*, 
        c.name AS category_name,
        m.gst_tax AS gst_tax,
        u.short_name AS item_unit
      FROM tbl_inventory i
      LEFT JOIN tbl_category c ON i.category_id = c.id
      LEFT JOIN tbl_menu_item m ON i.item_id = m.menu_id
      LEFT JOIN tbl_units u ON i.item_unit = u.id
      WHERE i.branch_id = $1
        AND ($2::text IS NULL OR i.inventory_type = $2)
        AND ($3::int IS NULL OR i.category_id = $3)
      ORDER BY i.updated_at DESC;
    `;

    const result = await conn.query(query, [
      branch_id,
      inventoryType,
      categoryId,
    ]);

    return result.rows;
  } catch (err) {
    throw new Error("Unable to fetch inventory data: " + err.message);
  }
};



exports.get_purchase = async (
  branch_id,
  page,
  limit,
  search,
  status,
  start_date,
  end_date,
  category_id
) => {
  try {
    const offset = (page - 1) * limit;

    const query = `
      WITH filtered_purchase AS (
        SELECT p.*
        FROM tbl_purchase p
        WHERE p.branch_id = $1
        AND ($2 = '' OR p.purchase_id ILIKE '%' || $2 || '%' OR p.notes ILIKE '%' || $2 || '%')
        AND (
          $3 = '' OR EXISTS (
            SELECT 1 
            FROM tbl_purchase_items pi
            WHERE pi.purchase_id = p.purchase_id
            AND pi.category_id = $3::int
          )
        )
        AND (($4 = '' AND $5 = '') OR (p.purchase_date BETWEEN $4::date AND $5::date))
        AND (
          $6 = 'all'
          OR ($6 = 'paid' AND p.balance_amount = 0)
          OR ($6 = 'unpaid' AND p.balance_amount > 0)
        )
        ORDER BY p.created_at DESC
        LIMIT $7 OFFSET $8
      ),

      purchase_data AS (
        SELECT
          p.purchase_id,
          p.branch_id,
          p.payment_type,
          p.attachment_url,
          p.notes,
          p.vendor_id,

          v.vendor_name,
          v.vendor_phone,
          v.vendor_email,
          v.company_name,

          p.purchase_date,
          p.purchase_type,
          p.total_amount,
          p.paid_amount,
          p.balance_amount,
          p.created_at,
          p.updated_at,

          COALESCE(
            JSON_AGG(
              JSON_BUILD_OBJECT(
                'item_id', pi.item_id,
                'item_name', pi.item_name,
                'quantity', pi.qty,
                'unit', pi.unit,
                'price', pi.purchase_price,
                'total', pi.total_price,
                'image', m.menu_image,
                'category', c.name,
                'category_id', pi.category_id
              )
            ) FILTER (WHERE pi.purchase_id IS NOT NULL),
            '[]'
          ) AS items

        FROM filtered_purchase p
        LEFT JOIN tbl_purchase_items pi ON p.purchase_id = pi.purchase_id
        LEFT JOIN tbl_category c ON pi.category_id = c.id
        LEFT JOIN tbl_vendor v ON p.vendor_id = v.vendor_id
        LEFT JOIN tbl_menu_item m ON pi.item_id = m.menu_id

        GROUP BY
          p.purchase_id,
          p.branch_id,
          p.payment_type,
          p.attachment_url,
          p.notes,
          p.vendor_id,
          p.purchase_date,
          p.purchase_type,
          p.total_amount,
          p.paid_amount,
          p.balance_amount,
          p.created_at,
          p.updated_at,
          v.vendor_name,
          v.vendor_phone,
          v.vendor_email,
          v.company_name
      )

      SELECT
        JSON_AGG(purchase_data) AS purchases,

        (SELECT COUNT(*)
         FROM tbl_purchase p
         WHERE p.branch_id = $1
           AND ($2 = '' OR p.purchase_id ILIKE '%' || $2 || '%' OR p.notes ILIKE '%' || $2 || '%')
           AND (
             $3 = '' OR EXISTS (
               SELECT 1 FROM tbl_purchase_items pi
               WHERE pi.purchase_id = p.purchase_id
               AND pi.category_id = $3::int
             )
           )
           AND (($4 = '' AND $5 = '') OR (p.purchase_date BETWEEN $4::date AND $5::date))
           AND (
             $6 = 'all'
             OR ($6 = 'paid' AND p.balance_amount = 0)
             OR ($6 = 'unpaid' AND p.balance_amount > 0)
           )
        ) AS total_purchase_count,

        COALESCE(SUM(paid_amount), 0) AS total_spent_amount,
        COALESCE(SUM(paid_amount), 0) AS total_paid_amount,
        COALESCE(SUM(balance_amount), 0) AS total_unpaid_amount,

        COALESCE(SUM(CASE 
          WHEN DATE_TRUNC('month', purchase_date) = DATE_TRUNC('month', CURRENT_DATE)
          THEN paid_amount ELSE 0 END), 0) AS this_month_spent,

        COALESCE(SUM(CASE 
          WHEN DATE_TRUNC('month', purchase_date)
            = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
          THEN paid_amount ELSE 0 END), 0) AS last_month_spent

      FROM purchase_data;
    `;

    const result = await conn.query(query, [
      branch_id,   // $1
      search,      // $2
      category_id, // $3
      start_date,  // $4
      end_date,    // $5
      status,      // $6
      limit,       // $7
      offset       // $8
    ]);

    return result.rows[0];

  } catch (err) {
    throw new Error("Unable to fetch purchase data: " + err.message);
  }
};






// exports.get_Expense = async ({
//   branch_id,
//   page = 1,
//   limit = 10,
//   search = "",
//   filter = "All",
//   start_date,
//   end_date,
//   category_id
// }) => {
//   try {
//     const offset = (page - 1) * limit;
//     const searchQuery = `%${search}%`;

//     let filterConditions = [];
//     filterConditions.push(`e.branch_id = $1`);

//     filterConditions.push(`
//       (
//          c.category_name ILIKE $2
//       OR e.description ILIKE $2
//       OR ei.item_name ILIKE $2
//       OR e.expense_id::text ILIKE $2
//       )
//     `);

//     if (category_id) filterConditions.push(`e.category_id = '${category_id}'`);

//     if (filter === "Paid") filterConditions.push(`e.balance_amount = 0`);
//     if (filter === "Unpaid") filterConditions.push(`e.balance_amount > 0`);

//     if (start_date && end_date) {
//       filterConditions.push(`
//         e.expense_date::date BETWEEN '${start_date}' AND '${end_date}'
//       `);
//     }

//     const whereClause = filterConditions.join(" AND ");

//     const query = `
//       WITH filtered_expenses AS (
//         SELECT DISTINCT e.expense_id
//         FROM tbl_expense e
//         LEFT JOIN tbl_expense_items ei ON e.expense_id = ei.expense_id
//         LEFT JOIN tbl_expense_category c ON e.category_id = c.id
//         WHERE ${whereClause}
//       ),

//       total_count AS (
//         SELECT COUNT(*) AS count FROM filtered_expenses
//       ),

//       expense_data AS (
//         SELECT 
//           e.expense_id,
//           e.branch_id,
//           e.category_id,
//           c.category_name AS expense_name,
//           e.attachment_url,
//           e.description,
//           e.expense_date,
//           e.payment_type,
//           e.total_amount,
//           e.paid_amount,
//           e.balance_amount,
//           e.created_at,
//           e.updated_at,

//           COALESCE(
//             JSON_AGG(
//               JSON_BUILD_OBJECT(
//                 'item_id', ei.item_id,
//                 'item_name', ei.item_name,
//                 'quantity', ei.qty,
//                 'price', ei.price,
//                 'total', ei.total
//               )
//             ) FILTER (WHERE ei.expense_id IS NOT NULL), '[]'
//           ) AS items

//         FROM filtered_expenses fe
//         JOIN tbl_expense e ON fe.expense_id = e.expense_id
//         LEFT JOIN tbl_expense_items ei ON e.expense_id = ei.expense_id
//         LEFT JOIN tbl_expense_category c ON e.category_id = c.id

//         GROUP BY 
//           e.expense_id,
//           e.category_id,
//           c.category_name,
//           e.attachment_url,
//           e.description,
//           e.expense_date,
//           e.payment_type,
//           e.total_amount,
//           e.paid_amount,
//           e.balance_amount,
//           e.created_at,
//           e.updated_at

//         ORDER BY e.expense_date DESC
//         LIMIT ${limit} OFFSET ${offset}
//       )

//       SELECT
//         (SELECT JSON_AGG(ed) FROM expense_data ed) AS expenses,
//         (SELECT count FROM total_count) AS total_count,

//         -- summaries
//         (SELECT COALESCE(SUM(total_amount), 0)
//          FROM tbl_expense 
//          WHERE branch_id = $1) AS total_expense,

//         (SELECT COALESCE(SUM(paid_amount), 0)
//          FROM tbl_expense 
//          WHERE branch_id = $1) AS total_paid_all,

//         (SELECT COALESCE(SUM(balance_amount), 0)
//          FROM tbl_expense 
//          WHERE branch_id = $1) AS total_unpaid_all,

//         (SELECT COALESCE(SUM(paid_amount), 0)
//          FROM tbl_expense
//          WHERE branch_id = $1
//          AND DATE_TRUNC('month', expense_date) = DATE_TRUNC('month', CURRENT_DATE)
//         ) AS total_paid_this_month,

//         (SELECT COALESCE(SUM(paid_amount), 0)
//          FROM tbl_expense
//          WHERE branch_id = $1
//          AND DATE_TRUNC('month', expense_date) = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
//         ) AS total_paid_last_month;
//     `;

//     const result = await conn.query(query, [
//       branch_id,
//       searchQuery
//     ]);

//     return {
//       expenses: result.rows[0].expenses || [],
//       total_count: result.rows[0].total_count || 0,
//       summary: {
//         total_expense: result.rows[0].total_expense || 0,
//         total_paid: result.rows[0].total_paid_all || 0,
//         total_unpaid: result.rows[0].total_unpaid_all || 0,
//         this_month: result.rows[0].total_paid_this_month || 0,
//         last_month: result.rows[0].total_paid_last_month || 0,
//       },
//       page: Number(page),
//       limit: Number(limit)
//     };

//   } catch (err) {
//     throw new Error("Unable to fetch expense data: " + err.message);
//   }
// };

exports.get_Expense = async ({
  branch_id,
  page = 1,
  limit = 10,
  search = "",
  filter = "All",
  start_date,
  end_date,
  category_id
}) => {
  try {
    const offset = (page - 1) * limit;
    const searchQuery = `%${search}%`;

    let filterConditions = [];
    filterConditions.push(`e.branch_id = $1`);

    filterConditions.push(`
      (
         c.category_name ILIKE $2
      OR e.description ILIKE $2
      OR ei.item_name ILIKE $2
      OR e.expense_id::text ILIKE $2
      )
    `);

    if (category_id) filterConditions.push(`e.category_id = '${category_id}'`);

    if (filter === "Paid") filterConditions.push(`e.balance_amount = 0`);
    if (filter === "Unpaid") filterConditions.push(`e.balance_amount > 0`);

    if (start_date && end_date) {
      filterConditions.push(`
        e.expense_date::date BETWEEN '${start_date}' AND '${end_date}'
      `);
    }

    const whereClause = filterConditions.join(" AND ");

    console.log(branch_id,searchQuery)

    const query = `
      WITH filtered_expenses AS (
        SELECT DISTINCT e.expense_id
        FROM tbl_expense e
        LEFT JOIN tbl_expense_items ei ON e.expense_id = ei.expense_id
        LEFT JOIN tbl_expense_category c ON e.category_id = c.id
        WHERE ${whereClause}
      ),

      total_count AS (
        SELECT COUNT(*) AS count FROM filtered_expenses
      ),

      expense_data AS (
        SELECT 
          e.expense_id,
          e.branch_id,
          e.category_id,
          c.category_name AS expense_name,
          e.attachment_url,
          e.description,
          e.expense_date,
          e.payment_type,
          e.total_amount,
          e.paid_amount,
          e.balance_amount,
          e.created_at,
          e.updated_at,

          COALESCE(
            JSON_AGG(
              JSON_BUILD_OBJECT(
                'item_id', ei.item_id,
                'item_name', ei.item_name,
                'quantity', ei.qty,
                'price', ei.price,
                'total', ei.total
              )
            ) FILTER (WHERE ei.expense_id IS NOT NULL), '[]'
          ) AS items

        FROM filtered_expenses fe
        JOIN tbl_expense e ON fe.expense_id = e.expense_id
        LEFT JOIN tbl_expense_items ei ON e.expense_id = ei.expense_id
        LEFT JOIN tbl_expense_category c ON e.category_id = c.id

        GROUP BY 
          e.expense_id,
          e.category_id,
          c.category_name,
          e.attachment_url,
          e.description,
          e.expense_date,
          e.payment_type,
          e.total_amount,
          e.paid_amount,
          e.balance_amount,
          e.created_at,
          e.updated_at

        ORDER BY e.expense_date DESC
        LIMIT ${limit} OFFSET ${offset}
      )

      SELECT
        (SELECT JSON_AGG(ed) FROM expense_data ed) AS expenses,
        (SELECT count FROM total_count) AS total_count,

        -- summaries
        (SELECT COALESCE(SUM(total_amount), 0)
         FROM tbl_expense 
         WHERE branch_id = $1) AS total_expense,

        (SELECT COALESCE(SUM(paid_amount), 0)
         FROM tbl_expense 
         WHERE branch_id = $1) AS total_paid_all,

        (SELECT COALESCE(SUM(balance_amount), 0)
         FROM tbl_expense 
         WHERE branch_id = $1) AS total_unpaid_all,

        (SELECT COALESCE(SUM(paid_amount), 0)
         FROM tbl_expense
         WHERE branch_id = $1
         AND DATE_TRUNC('month', expense_date) = DATE_TRUNC('month', CURRENT_DATE)
        ) AS total_paid_this_month,

        (SELECT COALESCE(SUM(paid_amount), 0)
         FROM tbl_expense
         WHERE branch_id = $1
         AND DATE_TRUNC('month', expense_date) = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
        ) AS total_paid_last_month;
    `;

    const result = await conn.query(query, [
      branch_id,
      searchQuery
    ]);


    return {
      expenses: result.rows[0].expenses || [],
      total_count: result.rows[0].total_count || 0,
      summary: {
        total_expense: result.rows[0].total_expense || 0,
        total_paid: result.rows[0].total_paid_all || 0,
        total_unpaid: result.rows[0].total_unpaid_all || 0,
        this_month: result.rows[0].total_paid_this_month || 0,
        last_month: result.rows[0].total_paid_last_month || 0,
      },
      page: Number(page),
      limit: Number(limit)
    };

  } catch (err) {
    throw new Error("Unable to fetch expense data: " + err.message);
  }
};


exports.getUnits = async (branch_id) => {
  console.log(branch_id)
  try {
    const query = `
      SELECT id, zodu_id, branch_id, name, short_name, created_at, updated_at
      FROM tbl_units
      WHERE branch_id = $1
      ORDER BY id DESC
    `;
    const { rows } = await conn.query(query, [branch_id]);
    return rows;
  } catch (err) {
    console.error(err);
    throw new Error("Database error while fetching units");
  }
};

// ADD UNIT
exports.addUnit = async (zodu_id, branch_id, name, short_name) => {
  try {
    const query = `
      INSERT INTO tbl_units (zodu_id, branch_id, name, short_name)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    const { rows } = await conn.query(query, [zodu_id, branch_id, name, short_name]);
    return rows[0];
  } catch (err) {
    console.log(err)
    throw new Error("Database error while adding unit");
  }
};

// UPDATE UNIT
exports.updateUnit = async (id, name, short_name) => {
  try {
    const query = `
      UPDATE tbl_units
      SET name = $1, short_name = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
    `;
    const { rows } = await conn.query(query, [name, short_name, id]);

    if (!rows[0]) throw new Error("Unit not found");
    return rows[0];
  } catch (err) {
    if (err.message === "Unit not found") throw err;
    throw new Error("Database error while updating unit");
  }
};

exports.deleteUnit = async (id, branch_id) => {
  try {
    // 1️⃣ Count usage in menu table (ID based)
    const countMenu = await conn.query(
      `SELECT COUNT(*) FROM tbl_menu_item 
       WHERE menu_unit = $1 AND branch_id = $2`,
      [id, branch_id]
    );

    // 2️⃣ Count usage in inventory table (ID based)
    const countInv = await conn.query(
      `SELECT COUNT(*) FROM tbl_inventory 
       WHERE item_unit = $1 AND branch_id = $2`,
      [id, branch_id]
    );

    const total =
      Number(countMenu.rows[0].count) + Number(countInv.rows[0].count);

    // 3️⃣ If used → return info
    if (total > 0) {
      return {
        success: false,
        used: true,
        count: total,
        message: "Unit is used and cannot be deleted",
      };
    }

    // 4️⃣ Delete unit
    const deleteQuery =
      `DELETE FROM tbl_units 
       WHERE id = $1 AND branch_id = $2 
       RETURNING id`;

    const { rows } = await conn.query(deleteQuery, [id, branch_id]);

    if (!rows.length) {
      throw new Error("Unit not found");
    }

    return {
      success: true,
      used: false,
      message: "Unit deleted successfully",
    };

  } catch (err) {
    console.log(err);
    throw new Error("Database error while deleting unit: " + err.message);
  }
};


exports.replaceUnit = async (oldUnitId, newUnitId, branch_id) => {
  try {
    await conn.query("BEGIN");

    // 1️⃣ Ensure old unit exists
    const oldUnit = await conn.query(
      `SELECT id FROM tbl_units WHERE id = $1 AND branch_id = $2`,
      [oldUnitId, branch_id]
    );

    if (oldUnit.rows.length === 0) {
      throw new Error("Old unit not found");
    }

    // 2️⃣ Ensure new unit exists
    const newUnit = await conn.query(
      `SELECT id FROM tbl_units WHERE id = $1 AND branch_id = $2`,
      [newUnitId, branch_id]
    );

    if (newUnit.rows.length === 0) {
      throw new Error("New unit not found");
    }

    // 3️⃣ Replace unit in menu items
    await conn.query(
      `UPDATE tbl_menu_item 
       SET menu_unit = $1 
       WHERE menu_unit = $2 AND branch_id = $3`,
      [newUnitId, oldUnitId, branch_id]
    );

    // 4️⃣ Replace unit in inventory
    await conn.query(
      `UPDATE tbl_inventory 
       SET unit = $1 
       WHERE unit = $2 AND branch_id = $3`,
      [newUnitId, oldUnitId, branch_id]
    );

    // 5️⃣ Delete the old unit
    await conn.query(
      `DELETE FROM tbl_units WHERE id = $1 AND branch_id = $2`,
      [oldUnitId, branch_id]
    );

    await conn.query("COMMIT");

    return { success: true };

  } catch (err) {
    await conn.query("ROLLBACK");
    throw new Error("Unable to replace unit: " + err.message);
  }
};


exports.getGST = async (branch_id) => {
  try {
    const query = `
      SELECT * FROM tbl_gst
      WHERE branch_id = $1
      ORDER BY id DESC
    `;
    const { rows } = await conn.query(query, [branch_id]);
    return rows;
  } catch (err) {
    throw new Error("Database error while fetching GST list");
  }
};

// ADD GST
exports.addGST = async (zodu_id, branch_id, gst_rate) => {
  try {
    const query = `
      INSERT INTO tbl_gst (zodu_id, branch_id,  gst_rate)
      VALUES ($1, $2, $3)
      RETURNING *
    `;
    const { rows } = await conn.query(query, [
      zodu_id,
      branch_id,
      gst_rate,
    ]);
    return rows[0];
  } catch (err) {
    throw new Error("Database error while adding GST");
  }
};

// UPDATE GST
exports.updateGST = async (id, gst_rate) => {
  try {
    const query = `
      UPDATE tbl_gst
      SET gst_rate = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `;
    const { rows } = await conn.query(query, [gst_rate, id]);

    if (!rows[0]) throw new Error("GST record not found");

    return rows[0];
  } catch (err) {
    if (err.message === "GST record not found") throw err;
    throw new Error("Database error while updating GST");
  }
};

// DELETE GST
exports.deleteGST = async (id) => {
  try {
    const query = `DELETE FROM tbl_gst WHERE id = $1 RETURNING id`;
    const { rows } = await conn.query(query, [id]);

    if (!rows.length) throw new Error("GST record not found");

    return true;
  } catch (err) {
    if (err.message === "GST record not found") throw err;
    throw new Error("Database error while deleting GST");
  }
};

exports.get_pos_data = async (branch_id) => {
  return await conn.query(
    `
    SELECT
      c.id AS id,
      c.name AS name,
      json_agg(
        json_build_object(
          'zodu_id', m.zodu_id,
          'branch_id', m.branch_id,
          'menu_id', m.menu_id,
          'menu_name', m.menu_name,
          'variants', m.variants,
          'qr_code', q.qr_code,
          'sell_price', m.sell_price,
          'purchase_price', m.purchase_price,
          'hsn_code', m.hsn_code,

          -- GST (Correct column)
          'gst_tax' , g.gst_rate,

          -- Units (Correct column)
 'menu_unit', u.short_name,

          'food_type', m.food_type,
          'tax_include_or_exclude', m.tax_include_or_exclude,
          'count', 10,
          'menu_image', m.menu_image,
          'menu_type', m.menu_type,
          'favorites', m.favorites
        )
        ORDER BY m.menu_name
      ) AS items
    FROM tbl_category c
    JOIN tbl_menu_item m 
      ON c.id = m.menu_category_id 
     AND m.active = true
     AND m.branch_id = $1

    LEFT JOIN tbl_qr_code q 
      ON q.id = m.qr_code_id

    LEFT JOIN tbl_gst g 
      ON g.id = m.gst_tax   -- correct column

    LEFT JOIN tbl_units u
      ON u.id = m.menu_unit -- correct column

    GROUP BY c.id, c.name
    ORDER BY c.name ASC;
    `,
    [branch_id]
  );
};





exports.get_menuItem_data = async (branch_id, page, limit, search) => {
  const offset = (page - 1) * limit;

  const totalCountResult = await conn.query(
    `SELECT COUNT(*) AS total
     FROM tbl_menu_item m
     JOIN tbl_category c ON c.id = m.menu_category_id
     WHERE m.branch_id = $1
       AND (m.menu_name ILIKE '%' || $2 || '%' OR c.name ILIKE '%' || $2 || '%')`,
    [branch_id, search]
  );

  const total_count = Number(totalCountResult.rows[0].total);
  const total_pages = Math.ceil(total_count / limit);

  const dataResult = await conn.query(
    `SELECT 
        m.zodu_id,
        m.branch_id,
        m.menu_name,
        m.variants,
        m.sell_price,
        m.purchase_price,
        m.hsn_code,

        -- GST JOIN (correct column)
        m.gst_tax AS gst_id,
        g.gst_rate AS gst_tax,

        m.active,
        m.food_type,
        m.tax_include_or_exclude,
        10 AS count,
        m.menu_image,
        m.menu_type,
        m.menu_code,

        -- UNIT JOIN (correct column)
        m.menu_unit AS unit_id,
        u.name AS unit_name,
        u.short_name AS menu_unit,

        m.favorites,
        m.menu_id,
        c.name AS category,
        m.menu_category_id AS category_id

     FROM tbl_menu_item m
     JOIN tbl_category c ON c.id = m.menu_category_id

     LEFT JOIN tbl_gst g ON g.id = m.gst_tax
     LEFT JOIN tbl_units u ON u.id = m.menu_unit

     WHERE m.branch_id = $1
       AND (m.menu_name ILIKE '%' || $2 || '%' OR c.name ILIKE '%' || $2 || '%')
     ORDER BY c.name, m.menu_name
     LIMIT $3 OFFSET $4`,
    [branch_id, search, limit, offset]
  );

  return {
    total_count,
    total_pages,
    current_page: Number(page),
    limit: Number(limit),
    rows: dataResult.rows
  };
};





exports.updateFinalPayment = async (data) => {
  try {
    const { order_id, table_no, final_payment, items, zodu_id, branch_id,total_amt } = data;

    await conn.query("BEGIN");

    // 1️⃣ UPDATE FINAL PAYMENT
  const noOfItems = Array.isArray(items) ? items.length : 0;

    // ✅ 3. UPDATE FINAL PAYMENT + TOTAL AMT + NO OF ITEMS
    const updateQuery = `
      UPDATE tbl_orders
      SET final_payment = $1,
          total_amt = $2,
          no_of_items = $3
      WHERE order_id = $4 AND table_no = $5
      RETURNING *;
    `;
    
    const result = await conn.query(updateQuery, [
      final_payment, 
      total_amt, 
      noOfItems, 
      order_id, 
      table_no
    ]);


    // 2️⃣ SYNC ORDERED ITEMS
    if (Array.isArray(items)) {

      // Fetch existing items from DB
      const dbItemsQuery = `
        SELECT * FROM tbl_ordered_items
        WHERE order_id = $1
      `;
      const dbItems = await conn.query(dbItemsQuery, [order_id]);

      // Convert to map for quick lookup
      const dbMap = new Map();
      dbItems.rows.forEach((x) => {
        // Create a unique key for lookup
        const key = `${x.item_id}-${x.variant_id || "null"}`;
        dbMap.set(key, x);
      });

      // Process incoming items
      for (const item of items) {
        const variantKey = `${item.menu_id}-${item.variant_id || "null"}`;
        const existsInDB = dbMap.get(variantKey);

        if (existsInDB) {
          // 🔵 ITEM EXISTS → OMIT DATA (DO NOTHING)
          // We remove it from the map so it doesn't get deleted in the next step,
          // but we skip the UPDATE query entirely.
          dbMap.delete(variantKey);
        } 
        else {
          // 🟢 NEW ITEM → INSERT
          // (If an item was added at the payment screen that wasn't there before)
          const insertQuery = `
            INSERT INTO tbl_ordered_items (
              zodu_id, branch_id, order_id,
              item_id, item_name, qty, price,
              item_unit, variant_id, variant_name
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          `;

          await conn.query(insertQuery, [
            zodu_id,
            branch_id,
            order_id,
            item.menu_id,
            item.name,
            item.qty,
            item.price,
            item.menu_unit,
            item.variant_id || null,
            item.variant_name || null
          ]);
        }
      }

      // 🔴 DELETE ITEMS (If removed from frontend)
      // Any item left in dbMap was present in DB but NOT in the incoming 'items' array
      for (const leftover of dbMap.values()) {
        const deleteQuery = `
          DELETE FROM tbl_ordered_items
          WHERE order_id = $1 AND item_id = $2 
            AND (${leftover.variant_id ? "variant_id = $3" : "variant_id IS NULL"})
        `;
        const deleteValues = leftover.variant_id
          ? [order_id, leftover.item_id, leftover.variant_id]
          : [order_id, leftover.item_id];

        await conn.query(deleteQuery, deleteValues);
      }
    }


    // 3️⃣ DELETE KOT ITEMS WHEN PAYMENT CLEARED
    if (final_payment === true && table_no) {
      const deleteKOT = `
        DELETE FROM tbl_kot_list
        WHERE table_no = $1 AND order_id = $2
      `;
      await conn.query(deleteKOT, [table_no, order_id]);
    }

    await conn.query("COMMIT");

    return {
      success: true,
      message: "Final payment updated & items synced (Existing ignored, missing deleted)",
      order: result.rows[0],
    };

  } catch (err) {
    await conn.query("ROLLBACK");
    throw new Error("Unable to update final payment: " + err.message);
  }
};



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
            'item_unit', i.item_unit,
            'item_image', mi.menu_image,
            'variant_name', i.variant_name,
            'variant_id', i.variant_id
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
    LEFT JOIN tbl_menu_item mi ON i.item_id = mi.menu_id 
    LEFT JOIN tbl_kot_list k ON o.order_id = k.order_id
    WHERE o.branch_id = $1
      AND o.final_payment = false
    GROUP BY 
      o.order_id, o.table_no, o.order_type, 
      o.customer_name, o.customer_phone, 
      o.total_amt, o.final_payment, 
      o.order_date, o.order_time, o.branch_id;
  `;

  const values = [branch_id];

  try {
    const { rows } = await conn.query(query, values);
    // ✅ If no results, return an empty array instead of throwing
    return rows || [];
  } catch (error) {
    console.error("Error fetching ordered data:", error.message);
    throw new Error("Failed to fetch ordered data");
  }
};




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

exports.createCategory = async (zodu_id, branch_id, name, type) => {
  try {
    // 1️⃣ Check if category already exists in this branch
    const checkQuery = `
      SELECT * FROM tbl_category
      WHERE zodu_id = $1 AND branch_id = $2 AND name = $3 AND type = $4
      LIMIT 1;
    `;
    const checkValues = [zodu_id, branch_id, name, type];
    const checkResult = await conn.query(checkQuery, checkValues);

    if (checkResult.rows.length > 0) {
      // ✅ Category already exists → return existing
      return checkResult.rows[0];
    }

    // 2️⃣ Otherwise, insert new category
    const insertQuery = `
      INSERT INTO tbl_category (zodu_id, branch_id, name, type)
      VALUES ($1, $2, $3, $4)
      RETURNING *;
    `;
    const insertValues = [zodu_id, branch_id, name, type];
    const insertResult = await conn.query(insertQuery, insertValues);

    if (insertResult.rows.length === 0) {
      throw new Error("Category not created");
    }

    return insertResult.rows[0];
  } catch (err) {
    throw new Error("Unable to create Category: " + err.message);
  }
}

exports.updateCategory = async (id, name, type, branch_id) => {
  try {
    const query = `
      UPDATE tbl_category
      SET name = $1,type = $3,updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND branch_id = $4
      RETURNING *;
    `;
    const values = [name, id, type, branch_id];
    const result = await conn.query(query, values);
    return result.rows[0];
  } catch (err) {
    throw new Error("Unable to update category: " + err.message);
  }
}

exports.deleteCategory = async (id, branch_id) => {
  try {
    // 1️⃣ Check usage in tbl_menu_item
    const menuCheckQuery = `
      SELECT COUNT(*) AS used_in_menu
      FROM tbl_menu_item
      WHERE menu_category_id = $1 AND branch_id = $2
    `;
    const menuRes = await conn.query(menuCheckQuery, [id, branch_id]);
    const usedInMenu = parseInt(menuRes.rows[0].used_in_menu, 10);

    // 2️⃣ Check usage in tbl_inventory
    const inventoryCheckQuery = `
      SELECT COUNT(*) AS used_in_inventory
      FROM tbl_inventory
      WHERE category_id = $1 AND branch_id = $2
    `;
    const invRes = await conn.query(inventoryCheckQuery, [id, branch_id]);
    const usedInInventory = parseInt(invRes.rows[0].used_in_inventory, 10);

    // 3️⃣ If category is used → THROW ERROR
    if (usedInMenu > 0 || usedInInventory > 0) {
      throw new Error(
        `Category cannot be deleted. It is used in ${usedInMenu} menu items and ${usedInInventory} inventory items.`
      );
    }

    // 4️⃣ Safe to delete
    const deleteQuery = `
      DELETE FROM tbl_category
      WHERE id = $1 AND branch_id = $2
      RETURNING id;
    `;
    const result = await conn.query(deleteQuery, [id, branch_id]);

    return {
      success: true,
      message: "Category deleted successfully",
    };

  } catch (err) {
    throw new Error("Unable to delete category: " + err.message);
  }
};





exports.createExpenseCategory = async (zodu_id, branch_id, name) => {
  try {
    // 1️⃣ Check if category already exists in this branch
    

    // 2️⃣ Otherwise, insert new category
    const insertQuery = `
      INSERT INTO tbl_expense_category (zodu_id, branch_id, category_name)
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

exports.updateExpenseCategory = async (name, id, branch_id) => {
  try {
    const updateQuery = `
      UPDATE tbl_expense_category
      SET category_name = $1
      WHERE id = $2 AND branch_id = $3
      RETURNING *;
    `;
    const values = [name, id, branch_id];
        console.log(values);
    const result = await conn.query(updateQuery, values);

    if (result.rows.length === 0) {
      throw new Error("Category not found or not updated");
    }

    return result.rows[0];
  } catch (err) {
    throw new Error("Unable to update category: " + err.message);
  }
};

exports.deleteExpenseCategory = async (id) => {

  try {
    const deleteQuery = `
      DELETE FROM tbl_expense_category
      WHERE id = $1 
      RETURNING *;
    `;

    const values = [id];
    const result = await conn.query(deleteQuery, values);

    if (result.rows.length === 0) {
      throw new Error("Category not found or not deleted");
    }

    console.log(result.rows)

    return result.rows[0];
  } catch (err) {
    throw new Error("Unable to delete category: " + err.message);
  }
};


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

exports.editVendor = async (vendorData) => {
  try {
    const {
      vendor_id,
      vendor_name,
      vendor_phone,
      vendor_email,
      vendor_address,
      company_name
    } = vendorData;

    if (!vendor_id) {
      throw new Error("vendor_id is required for update");
    }

    const updateQuery = `
      UPDATE tbl_vendor
      SET 
        vendor_name = $1,
        vendor_phone = $2,
        vendor_email = $3,
        vendor_address = $4,
        company_name = $5
      WHERE vendor_id = $6
      RETURNING *;
    `;

    const updateValues = [
      vendor_name,
      vendor_phone,
      vendor_email,
      vendor_address,
      company_name,
      vendor_id
    ];

    const result = await conn.query(updateQuery, updateValues);

    if (result.rows.length === 0) {
      throw new Error("Vendor not found");
    }

    return result.rows[0]; // updated vendor

  } catch (err) {
    throw new Error("Unable to update Vendor: " + err.message);
  }
};

exports.deleteVendor = async (id) => {
  try {
    await conn.query("BEGIN");

    // Get menu_type before delete
    const check = await conn.query(
      `SELECT vendor_id FROM tbl_vendor WHERE vendor_id = $1`,
      [id]
    );

    if (check.rows.length === 0) {
      throw new Error("vendor not found");
    }
    // Delete menu item
    await conn.query(`DELETE FROM tbl_vendor WHERE vendor_id = $1`, [id]);

    

    await conn.query("COMMIT");
    return { success: true, message: "Vendor deleted successfully" };

  } catch (err) {
    if (err.message.includes("violates foreign key constraint")) {
      throw new Error("Cannot delete vendor: Vendor is used in purchase data");
    }

    throw new Error("Unable to delete Vendor: " + err.message);
  }
};


exports.getVendor = async (branch_id) => {
  try {
    const query = `
      SELECT *
      FROM tbl_vendor
      WHERE branch_id = $1
    `;
    const result = await conn.query(query, [branch_id]);
    return result.rows;
  } catch (err) {
    throw new Error("Unable to fetch vendor data: " + err.message);
  }
}

exports.getVendorId = async (zoduId, branchId, vendor) => {
  try {
    const query = `
      SELECT * FROM tbl_vendor
      WHERE zodu_id = $1 AND branch_id = $2 AND company_name = $3
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

    // Select the last numeric part of menu_id, sorted numerically
    const result = await conn.query(
      `
      SELECT menu_id
      FROM tbl_menu_item
      WHERE zodu_id = $1 AND branch_id = $2
      ORDER BY (regexp_replace(menu_id, '[^0-9]', '', 'g'))::int DESC
      LIMIT 1
      FOR UPDATE;
      `,
      [zoduId, branchId]
    );

    let nextNumber = 1;

    if (result.rows.length > 0) {
      const lastId = result.rows[0].menu_id;

      // Extract numeric part from something like "zodu-branch-320"
      const match = lastId.match(/(\d+)$/);
      const lastNum = match ? parseInt(match[1], 10) : 0;
      console.log(lastNum);

      nextNumber = lastNum + 1;
    }

    await conn.query("COMMIT");

    // Return zero-padded ID part (e.g., "001", "320")
    return String(nextNumber).padStart(3, "0");
  } catch (err) {
    await conn.query("ROLLBACK");
    throw new Error("Error generating next menu ID: " + err.message);
  }
};


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
      console.log(lastId)
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
        hsn_code, gst_tax, tax_include_or_exclude, menu_image, menu_code, menu_id, menu_unit, favorites
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
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
    const createdMenu = result.rows[0];
console.log(createdMenu.menu_type)
    // ✅ If menu_type is 'Product', add it to inventory
    if (createdMenu.menu_type && createdMenu.menu_type.toLowerCase() === 'product') {
      const existing = await conn.query(
        `SELECT item_id FROM tbl_inventory WHERE item_id = $1`,
        [createdMenu.menu_id]
      );

      if (existing.rows.length > 0) {
        // Update quantity if already exists
        await conn.query(
          `UPDATE tbl_inventory
           SET stock_qty = stock_qty + 0
           WHERE item_id = $1`,
          [createdMenu.menu_id]
        );
      } else {
        // Insert new inventory item
        await conn.query(
          `INSERT INTO tbl_inventory (
            zodu_id, branch_id, item_id, category_id, item_name, item_unit,
            stock_qty, stock_alert, purchase_price, selling_price,inventory_type,last_purchase_date
          ) VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9,$10, NOW())`,
          [
            createdMenu.zodu_id,
            createdMenu.branch_id,
            createdMenu.menu_id,
            createdMenu.menu_category_id,
            createdMenu.menu_name,
            createdMenu.menu_unit,
            0, // default stock = 0
            createdMenu.purchase_price,
            createdMenu.sell_price,
            "direct"
          ]
        );
      }
    }

    await conn.query('COMMIT');
    return createdMenu;

  } catch (err) {
    await conn.query('ROLLBACK');
    throw new Error("Unable to create menu: " + err.message);
  }
};


// ✅ Create or Update Order
exports.createOrder = async (orderData) => {
  try {
    await conn.query("BEGIN");

    let result;

    // 🟢 Check if Dine-In and order already exists
    if (orderData.order_type === "Dine-In") {
      const checkQuery = `
        SELECT * FROM tbl_orders
        WHERE order_id = $1 AND table_no = $2
      `;
      const checkValues = [orderData.order_id, orderData.table_no];
      const existing = await conn.query(checkQuery, checkValues);

      if (existing.rows.length > 0) {
        // 🔁 Update existing Dine-In order
        const updateQuery = `
          UPDATE tbl_orders
          SET 
            total_amt = total_amt + $1,
            no_of_items = no_of_items + $2,
            final_payment = $3,
            payment_type = $4,
            order_time = CURRENT_TIMESTAMP
          WHERE order_id = $5 AND table_no = $6
          RETURNING *;
        `;
        const updateValues = [
          orderData.total_amt,      // $1 new added total
          orderData.no_of_items,    // $2 new added item count
          orderData.final_payment,  // $3 final payment flag
          orderData.payment_type,   // $4 payment type
          orderData.order_id,       // $5
          orderData.table_no        // $6
        ];
        result = await conn.query(updateQuery, updateValues);
      } else {
        // 🆕 Insert new Dine-In order
        const insertQuery = `
          INSERT INTO tbl_orders (
            zodu_id, branch_id, table_no, no_of_items, order_type,
            customer_name, customer_phone, total_amt, final_payment,
            payment_type, order_id, order_date, order_time
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
          orderData.payment_type,    // $10
          orderData.order_id,        // $11
          orderData.order_date,      // $12
          orderData.order_time       // $13
        ];
        result = await conn.query(insertQuery, insertValues);
      }
    } else {
      // 🚫 Not Dine-In → Always insert new order
      const insertQuery = `
        INSERT INTO tbl_orders (
          zodu_id, branch_id, no_of_items, order_type,
          customer_name, customer_phone, total_amt, final_payment,
          payment_type, order_id, order_date, order_time
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *;
      `;
      const insertValues = [
        orderData.zodu_id,         // $1
        orderData.branch_id,       // $2
        orderData.no_of_items,     // $4
        orderData.order_type,      // $5
        orderData.customer_name,   // $6
        orderData.customer_phone,  // $7
        orderData.total_amt,       // $8
        orderData.final_payment,   // $9
        orderData.payment_type,    // $10
        orderData.order_id,        // $11
        orderData.order_date,      // $12
        orderData.order_time       // $13
      ];
      result = await conn.query(insertQuery, insertValues);
    }

    await conn.query("COMMIT");
    return result.rows[0];
  } catch (err) {
    await conn.query("ROLLBACK");
    throw new Error("Unable to create or update order: " + err.message);
  }
};




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
      // ✅ Use variant_name if present, else fallback to item.name
      const itemName = item.variant_name && item.variant_name.trim() !== ''
        ? item.variant_name
        : item.name;

      const query = `
        INSERT INTO tbl_kot_list (
          zodu_id, branch_id, order_id, kot_no, item_id, item_name, qty, table_no
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *;
      `;

      const values = [
        orderData.zodu_id,   // $1
        orderData.branch_id, // $2
        orderData.order_id,  // $3
        orderData.kot_no,    // $4
        item.menu_id,        // $5
        itemName,            // $6 ✅ dynamically set
        item.qty,            // $7
        orderData.table_no,  // $8
      ];

      const result = await conn.query(query, values);
      insertedItems.push(result.rows[0]);
    }

    await conn.query('COMMIT');

    // ✅ Return all inserted rows after loop completes
    return insertedItems;

  } catch (err) {
    await conn.query('ROLLBACK');
    throw new Error('Unable to create KOT: ' + err.message);
  }
};

// services/purchaseService.js
exports.createPurchaseOrder = async (orderData) => {
  try {
    await conn.query('BEGIN');
    const {
      zodu_id,
      branch_id,
      vendor,
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
        notes
      )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        purchase_id,
        vendor,
        zodu_id,
        branch_id,
        purchase_date,
        purchase_type,
        total_amount,
        paid_amount,
       JSON.stringify(attachment_url || null),
        payment_type,
        notes,
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
      await conn.query(
        `INSERT INTO tbl_purchase_items 
        (purchase_id, item_id, item_name, category_id, qty, unit, purchase_price)
        VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          purchase_id,       // $1
          item.id,           // $2
          item.name,         // $3
          item.category_id,  // $4  ✅ correct
          item.qty,          // $5  ✅ correct
          item.unit,         // $6
          item.purchase_price // $7
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


exports.updateInventory = async (items) => {
  try {
    await conn.query('BEGIN');
    const {
      inventory_id,
      stock_qty,
      stock_alert,
      selling_price,
      purchase_price,
      last_purchase_date,
    } = items;

    if (!inventory_id) {
      throw new Error("Missing inventory_id for one or more items");
    }

    await conn.query(
      `
        UPDATE tbl_inventory
        SET 
           stock_qty = stock_qty + COALESCE($1, 0),
          stock_alert = COALESCE($2, stock_alert),
          selling_price = COALESCE($3, selling_price),
          purchase_price = COALESCE($4, purchase_price),
          last_purchase_date = COALESCE($5, last_purchase_date),
          updated_at = NOW()
        WHERE inventory_id = $6
        `,
      [
        stock_qty,
        stock_alert,
        selling_price,
        purchase_price,
        last_purchase_date,
        inventory_id,
      ]
    );


    await conn.query('COMMIT');
    return { success: true, message: "Inventory updated successfully" };
  } catch (err) {
    await conn.query('ROLLBACK');
    throw new Error("Unable to update Inventory: " + err.message);
  }
};


exports.addin_Inventory = async (data) => {
  try {
    await conn.query("BEGIN");

    const prefix = "INDIR-INV-";
    let itemId;

    // 🔹 Get the maximum numeric suffix from existing indirect inventory IDs
    const { rows } = await conn.query(`
      SELECT MAX(
        CAST(REGEXP_REPLACE(item_id, '^${prefix}', '') AS INTEGER)
      ) AS max_num
      FROM tbl_inventory
      WHERE inventory_type = 'indirect'
      AND item_id ~ '^${prefix}[0-9]+$'
    `);

    const maxNum = rows[0]?.max_num || 0;
    const nextNum = maxNum + 1;
    itemId = `${prefix}${String(nextNum).padStart(3, "0")}`;

    // 🔹 Insert into tbl_inventory (always indirect)
    await conn.query(
      `INSERT INTO tbl_inventory (
        zodu_id,
        branch_id,
        item_id,
        category_id,
        item_name,
        item_unit,
        stock_qty,
        stock_alert,
        purchase_price,
        selling_price,
        last_purchase_date,
        inventory_type
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
        0, // selling_price default
        data.purchase_date,
      ]
    );

    await conn.query("COMMIT");

    return {
      success: true,
      message: "Indirect inventory added successfully",
      item_id: itemId,
    };
  } catch (err) {
    await conn.query("ROLLBACK");
    throw new Error("Unable to add indirect inventory: " + err.message);
  } 
};



exports.addInventory = async (items, branch_id, zodu_id, purchase_date, category_id, purchase_type) => {
  try {
    await conn.query('BEGIN');

    // ✅ Determine inventory type
    const inventory_type = purchase_type === "Product" ? "direct" : "indirect";

    for (const item of items) {
      // ⚠️ Skip items without a valid ID
      if (!item.id || item.id === null || item.id.trim() === '') {
        console.warn(`⚠️ Skipped item without ID: ${item.name}`);
        continue;
      }

      // 🔍 Check if item already exists
      const existing = await conn.query(
        `SELECT item_id FROM tbl_inventory WHERE item_id = $1`,
        [item.id]
      );

      if (existing.rows.length > 0) {
        // ✅ Update existing item quantity & last purchase date
        await conn.query(
          `UPDATE tbl_inventory
           SET 
             stock_qty = stock_qty + $1,
             last_purchase_date = $2,
             inventory_type = $3
           WHERE item_id = $4`,
          [item.qty, purchase_date, inventory_type, item.id]
        );
      } else {
        // 🆕 Insert new item into inventory
        await conn.query(
          `INSERT INTO tbl_inventory (
            zodu_id, branch_id, item_id, category_id, item_name, item_unit,
            stock_qty, stock_alert, purchase_price, selling_price, last_purchase_date, inventory_type, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())`,
          [
            zodu_id,
            branch_id,
            item.id,
            category_id,
            item.name,
            item.unit || 'unit',
            item.qty,
            item.stock_alert || 5,
            item.purchase_price || 0,
            item.selling_price || 0,
            purchase_date,
            inventory_type
          ]
        );
      }
    }

    await conn.query('COMMIT');
    return { success: true, message: "Inventory updated successfully" };

  } catch (err) {
    await conn.query('ROLLBACK');
    console.error("❌ Error in addInventory:", err.message);
    throw new Error("Unable to update Inventory: " + err.message);
  }
};



exports.addExpense = async (orderData) => {

  try {
    await conn.query('BEGIN');

    // 🔍 1️⃣ Check if expense already exists
    const existing = await conn.query(
      `SELECT expense_id 
       FROM tbl_expense 
       WHERE expense_id = $1 
         AND branch_id = $2`,
      [orderData.expense_id || null, orderData.branch_id]
    );

    // 🔢 2️⃣ Generate new expense_id if needed
    if (existing.rows.length === 0) {
      const result = await conn.query(
        `SELECT MAX(CAST(SPLIT_PART(expense_id, '-EXP-', 2) AS INTEGER)) AS max_num
         FROM tbl_expense
         WHERE branch_id = $1`,
        [orderData.branch_id]
      );

      let nextNumber = 1;
      if (result.rows.length > 0 && result.rows[0].max_num !== null) {
        nextNumber = result.rows[0].max_num + 1;
      }

      

      orderData.expense_id = `${orderData.branch_id}-EXP-${String(nextNumber).padStart(3, '0')}`;
    }

console.log(orderData);
    // 📅 3️⃣ Ensure expense_date is set
    if (!orderData.expense_date) {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      orderData.expense_date = `${year}-${month}-${day}`;
    }

      // 🆕 Insert new expense
    await conn.query(
  `INSERT INTO tbl_expense 
    (zodu_id, branch_id, category_id, expense_id, expense_date, total_amount, 
     paid_amount, description, attachment_url, payment_type, created_at)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, NOW())`,
  [
    orderData.zodu_id,
    orderData.branch_id,
    Number(orderData.category),
    orderData.expense_id,
    orderData.expense_date,
    orderData.total_amount,
    orderData.paid_amount || 0,
    orderData.description || `Purchase Order ${orderData.expense_id}`,
    JSON.stringify(orderData.attachment_url || null),  // correct JSON
    orderData.payment_type || "Cash"                 // only ONE payment param
  ]
);


    // 🧩 5️⃣ Insert expense items
    if (Array.isArray(orderData.items) && orderData.items.length > 0) {
      const insertItemQuery = `
        INSERT INTO tbl_expense_items 
          (expense_id, item_id, item_name, qty, price, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
      `;

      for (const item of orderData.items) {
        // ⚙️ Auto-generate item_id if missing
        let itemId = item.id;
        if (!itemId || itemId === null || itemId === '' || itemId === 'null') {
          const cleanName = (item.name || 'Unnamed').replace(/\s+/g, '-').toUpperCase();
          itemId = `${orderData.branch_id}-ITEM-${cleanName}`;
        }

        await conn.query(insertItemQuery, [
          orderData.expense_id,
          itemId,
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
    console.error("❌ Error in addExpense:", error.message);
    return {
      success: false,
      message: "Failed to add or update expense: " + error.message,
    };
  }
};

exports.getExpenseById = async (expense_id) => {
  try {
    const result = await conn.query(
      `SELECT 
        e.expense_id,
        e.zodu_id,
        e.branch_id,
        e.category_id,
        e.expense_date,
        e.total_amount,
        e.paid_amount,
        e.balance_amount,
        e.description,
        e.attachment_url,
        e.payment_type,
        e.created_at,
        e.updated_at,
        c.name AS category_name
      FROM tbl_expense e
      LEFT JOIN tbl_category c ON e.category_id = c.id
      WHERE e.expense_id = $1`,
      [expense_id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    // Also fetch expense items
    const itemsResult = await conn.query(
      `SELECT 
        item_id,
        item_name,
        qty,
        price
      FROM tbl_expense_items
      WHERE expense_id = $1`,
      [expense_id]
    );

    const expense = result.rows[0];
    expense.items = itemsResult.rows;


    return expense;
  } catch (err) {
    console.error(" Error in getExpenseById:", err.message);
    throw new Error("Unable to fetch expense: " + err.message);
  }
};

exports.edit_expense = async (data) => {
  try {
    await conn.query("BEGIN");

    // ======================================================
    // 1️⃣ UPDATE MAIN EXPENSE  (expense_name removed)
    // ======================================================
    const updateExpenseQuery = `
      UPDATE tbl_expense 
      SET 
        branch_id = $1,
        category_id = $2,
        expense_date = $3,
        attachment_url = $4,
        total_amount = $5,
        description = $6,
        zodu_id = $7,
        paid_amount = $8,
        payment_type = $9,
        updated_at = CURRENT_TIMESTAMP
      WHERE expense_id = $10
      RETURNING *;
    `;

    const updatedExpense = await conn.query(updateExpenseQuery, [
      data.branch_id,
      Number(data.category),
      data.expense_date,
      JSON.stringify(data.attachment_url || null),
      data.total_amount,
      data.description,
      data.zodu_id,
      data.paid_amount,
      data.payment_type,
      data.expenseId,
    ]);

    // ======================================================
    // 2️⃣ FETCH EXISTING ITEMS
    // ======================================================
    const existingItems = await conn.query(
      `SELECT id FROM tbl_expense_items WHERE expense_id = $1`,
      [data.expenseId]
    );

    const oldItemIds = existingItems.rows.map(r => String(r.id));
    const newItemIds = (data.items || [])
      .map(i => i.id != null ? String(i.id) : null)
      .filter(id => id !== null);

    const itemsToDelete = oldItemIds.filter(oldId => !newItemIds.includes(oldId));

    for (const deleteId of itemsToDelete) {
      await conn.query(
        `DELETE FROM tbl_expense_items WHERE id = $1`,
        [deleteId]
      );
    }

    // ======================================================
    // 3️⃣ INSERT / UPDATE EXPENSE ITEMS
    // ======================================================
   // 4️⃣ INSERT / UPDATE ITEMS
for (const item of data.items || []) {
  const rowId = item.id ? Number(item.id) : null;

  // Update existing row (database id)
  if (rowId) {
    await conn.query(
      `
        UPDATE tbl_expense_items
        SET 
          item_name = $1, 
          qty = $2, 
          price = $3,
          item_id = $5
        WHERE id = $4
      `,
      [
        item.name,
        item.qty,
        item.purchase_price,
        rowId,
        item.item_id || item.id || null   // ⭐ item_code support
      ]
    );
  }

  // Insert new row
  else {
    await conn.query(
      `
        INSERT INTO tbl_expense_items
        (expense_id, item_name, qty, price, item_id)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [
        data.expenseId,
        item.name,
        item.qty,
        item.purchase_price,
        item.item_id || item.id || null   // ⭐ item_code support
      ]
    );
  }
}


    // ======================================================
    // 4️⃣ COMMIT
    // ======================================================
    await conn.query("COMMIT");
    return updatedExpense.rows[0];

  } catch (err) {
    await conn.query("ROLLBACK");
    console.error("❌ ERROR Edit Expense:", err);
    throw err;
  }
};





// CREATE ITEM
// CREATE ITEM
exports.createItem = async (input) => {
  const { name, branch_id, zodu_id } = input;


  const query = `
    INSERT INTO tbl_expitem (name, branch_id, zodu_id)
    VALUES ($1, $2, $3)
    RETURNING *;
  `;

  const result = await conn.query(query, [name, branch_id, zodu_id]);
  return result.rows;
};


// GET ITEMS BY BRANCH + ZODU
exports.getItems = async (branch_id) => {
  const query = `
    SELECT *
    FROM tbl_expitem
    WHERE branch_id = $1
    ORDER BY id ASC;
  `;
  const result = await conn.query(query, [branch_id]);
  return result.rows;
};

// UPDATE ITEM (SECURED BY BRANCH & ZODU)
exports.updateItem = async (id, branch_id,name) => {
  const query = `
    UPDATE tbl_expitem
    SET name = $3, updated_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND branch_id = $2
    RETURNING *;
  `;
  const result = await conn.query(query, [id, branch_id,name]);
  return result.rows;
};

// DELETE ITEM (SECURED BY BRANCH & ZODU)
exports.deleteItem = async (id) => {
  const query = `
    DELETE FROM tbl_expitem
    WHERE id = $1
    RETURNING *;
  `;
  const result = await conn.query(query, [id]);
  return result.rows;
};

exports.getPurchaseById = async (purchase_id) => {
  try {
    const result = await conn.query(
      `SELECT 
        p.purchase_id,
        p.zodu_id,
        p.branch_id,
        p.vendor_id,
        p.purchase_date,
        p.purchase_type,
        p.total_amount,
        p.paid_amount,
        p.balance_amount,
        p.attachment_url,
        p.payment_type,
        p.notes,
        p.created_at,
        p.updated_at,
        v.vendor_name
      FROM tbl_purchase p
      LEFT JOIN tbl_vendor v ON p.vendor_id = v.vendor_id
      WHERE p.purchase_id = $1`,
      [purchase_id]
    );

    if (result.rows.length === 0) {
      return null;
    }

   const itemsResult = await conn.query(
  `SELECT 
      pi.item_id,
      pi.item_name,
      pi.qty,
      pi.unit,
      pi.purchase_price,
      c.name AS category_name
   FROM tbl_purchase_items pi
   LEFT JOIN tbl_category c ON pi.category_id = c.id
   WHERE pi.purchase_id = $1`,
  [purchase_id]
);


    const purchase = result.rows[0];
    purchase.items = itemsResult.rows;

    return purchase;
  } catch (err) {
    console.error(" Error in getPurchaseById:", err.message);
    throw new Error("Unable to fetch purchase: " + err.message);
  }
};

exports.updatePurchase = async (purchaseData) => {
  try {
    await conn.query("BEGIN");

    const purchase_id = purchaseData.purchase_id;
    if (!purchase_id) throw new Error("purchase_id is required");

    const totalAmount = Number(purchaseData.total_amount) || 0;
    const paidAmount = Number(purchaseData.paid_amount) || 0;

    // -----------------------------------------
    // 1️⃣ UPDATE MAIN PURCHASE TABLE
    // -----------------------------------------
    const updateQuery = `
      UPDATE tbl_purchase
      SET 
        vendor_id = $1,
        purchase_date = $2,
        purchase_type = $3,
        total_amount = $4,
        paid_amount = $5,
        attachment_url = $6,
        payment_type = $7,
        notes = $8,
        updated_at = NOW()
      WHERE purchase_id = $9
      RETURNING *
    `;

    const updatedPurchase = await conn.query(updateQuery, [
      purchaseData.vendor,                          // vendor_id
      purchaseData.purchase_date,                   // yyyy-mm-dd
      purchaseData.purchase_type,                   
      totalAmount,
      paidAmount,
      JSON.stringify(purchaseData.attachment_url || []),
      purchaseData.payment_type,
      purchaseData.notes || null,
      purchase_id
    ]);

    // -----------------------------------------
    // 2️⃣ DELETE OLD ITEMS (ONLY IF NEW PROVIDED)
    // -----------------------------------------
    if (purchaseData.items && Array.isArray(purchaseData.items)) {
      await conn.query(
        `DELETE FROM tbl_purchase_items WHERE purchase_id = $1`,
        [purchase_id]
      );

      const insertQuery = `
        INSERT INTO tbl_purchase_items
        (purchase_id, item_id, item_name, qty, unit, purchase_price,category_id)
        VALUES ($1, $2, $3, $4, $5, $6,$7)
      `;

      for (const item of purchaseData.items) {
        let itemId = item.id || item.item_id;

        // Re-generate if missing
        if (!itemId) {
          const cleanName = (item.name || item.item_name || "ITEM")
            .replace(/\s+/g, "-")
            .toUpperCase();

          itemId = `${purchaseData.branch_id}-ITEM-${cleanName}`;
        }

        await conn.query(insertQuery, [
          purchase_id,
          itemId,
          item.name || item.item_name,
          Number(item.qty || item.quantity || 0),
          item.unit || "",
          Number(item.purchase_price || item.price || 0),
          item.category_id
        ]);
      }
    }

    await conn.query("COMMIT");
    return updatedPurchase.rows[0];

  } catch (err) {
    await conn.query("ROLLBACK");
    console.error("❌ Error in updatePurchase:", err);
    throw new Error("Unable to update purchase: " + err.message);
  }
};



exports.getHold = async (branch_id) => {
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
      WHERE h.branch_id = $1
      GROUP BY h.hold_id
      ORDER BY h.created_at DESC;
      `,
      [String(branch_id)]
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

exports.deleteExpenseWithItems = async (expenseId) => {

  try {
    await conn.query("BEGIN");

    // 1) Delete all items for this expense
    await conn.query(
      `DELETE FROM tbl_expense_items
       WHERE expense_id = $1`,
      [expenseId]
    );

    // 2) Delete the expense itself
    const { rows } = await conn.query(
      `DELETE FROM tbl_expense
       WHERE expense_id = $1
       RETURNING *`,
      [expenseId]
    );

    await conn.query("COMMIT");

    // if nothing deleted, return null (controller will return 404)
    if (rows.length === 0) return null;

    return rows[0];
  } catch (err) {
    await conn.query("ROLLBACK");
    console.error("❌ deleteExpenseWithItems error:", err);
    throw err;
  } 
};

exports.deletePurchaseWithItems = async (purchaseId) => {

  try {
    await conn.query("BEGIN");

    // 1) Delete all items for this expense
    await conn.query(
      `DELETE FROM tbl_purchase_items
       WHERE purchase_id = $1`,
      [purchaseId]
    );

    // 2) Delete the expense itself
    const { rows } = await conn.query(
      `DELETE FROM tbl_purchase
       WHERE purchase_id = $1
       RETURNING *`,
      [purchaseId]
    );

    await conn.query("COMMIT");

    // if nothing deleted, return null (controller will return 404)
    if (rows.length === 0) return null;

    return rows[0];
  } catch (err) {
    await conn.query("ROLLBACK");
    console.error("❌ deleteExpenseWithItems error:", err);
    throw err;
  } 
};

exports.getDashboard = async (zodu_id, branch_id, options = {}) => {
  try {
    // Extract pagination options
    const {
      page = 1,
      limit = 10,
      sortBy = "created_at",
      sortOrder = "desc"
    } = options;

    const offset = (page - 1) * limit;
    const order = sortOrder.toLowerCase() === "asc" ? "ASC" : "DESC";

  const startDate = moment().startOf("day");
    const endDate = moment().endOf("day");

    const params = [zodu_id, branch_id, startDate.toDate(), endDate.toDate()];

    // 🔹 Summary (today)
    const dashboardQuery = `
      WITH
      orders_summary AS (
        SELECT 
          COUNT(o.order_id) AS total_orders,
          COALESCE(SUM(o.total_amt), 0) AS total_sales
        FROM tbl_orders o
        WHERE o.zodu_id = $1
          AND o.branch_id = $2
          AND o.final_payment = true
      ),
   expense_summary AS (
  SELECT 
    COALESCE(SUM(total_amount), 0) AS total_expense
  FROM tbl_expense
  WHERE zodu_id = $1
    AND branch_id = $2
),
      stock_summary AS (
        SELECT COUNT(i.inventory_id) AS low_stocks
        FROM tbl_inventory i
        WHERE i.zodu_id = $1
          AND i.branch_id = $2
          AND i.stock_qty <= i.stock_alert
      )
      SELECT 
        o.total_orders,
        o.total_sales,
        e.total_expense,
        s.low_stocks
      FROM orders_summary o, expense_summary e, stock_summary s;
    `;

const dashboardRes = await conn.query(dashboardQuery, [zodu_id, branch_id]);
    const dash = dashboardRes.rows[0] || {};

    // 🔹 1️⃣ Orders List (with pagination)
    const ordersQuery = `
  SELECT 
    o.order_id,
    o.total_amt,
    o.no_of_items,                              -- total distinct items
    COALESCE(SUM(oi.qty), 0) AS total_qty,      -- total quantity from ordered_items
    o.order_type,
    o.order_time,
    TO_CHAR(
      o.order_date + o.order_time::interval, 
      'Dy, DD Mon YYYY, HH12:MI AM'
    ) AS formatted_date
  FROM tbl_orders o
  LEFT JOIN tbl_ordered_items oi 
    ON oi.order_id = o.order_id
  WHERE o.zodu_id = $1
    AND o.branch_id = $2
    AND o.final_payment = true
  GROUP BY 
    o.order_id, 
    o.total_amt, 
    o.no_of_items, 
    o.order_type, 
    o.order_date, 
    o.order_time
  ORDER BY o.order_date ${order}, o.order_time ${order}
  LIMIT $3 OFFSET $4;
`;

    const ordersRes = await conn.query(ordersQuery, [zodu_id, branch_id, limit, offset]);

    const orders = ordersRes.rows.map((o) => ({
      order_no: `#${o.order_id}`,
      amount: Number(o.total_amt),
      type: o.order_type || "Dine-in",
      items: Number(o.no_of_items),   // ✅ total items count from tbl_orders
      qty: Number(o.total_qty),       // ✅ total quantity sum from tbl_ordered_items
      date: o.formatted_date,         // ✅ formatted datetime
    }));

    // Count total orders for pagination
    const ordersCountQuery = `
      SELECT COUNT(*) AS total
      FROM tbl_orders
      WHERE zodu_id = $1
        AND branch_id = $2
        AND final_payment = true
    `;
    const ordersCountRes = await conn.query(ordersCountQuery, [zodu_id, branch_id]);
    const totalOrders = parseInt(ordersCountRes.rows[0]?.total || 0);

    // 🔹 2️⃣ Top Items
    const topItemsQuery = `
  SELECT 
    m.menu_name,
    c.name AS category_name,                     -- 🆕 Category name from tbl_category
    m.menu_unit,                                 -- 🆕 Unit from tbl_menu_item
    SUM(i.qty) AS total_qty,
    SUM(i.price) AS total_amount
  FROM tbl_ordered_items i
  JOIN tbl_menu_item m 
    ON m.zodu_id = i.zodu_id 
    AND m.branch_id = i.branch_id 
    AND m.menu_id = i.item_id
  LEFT JOIN tbl_category c                       -- 🆕 Link category name
    ON m.menu_category_id = c.id
  JOIN tbl_orders o 
    ON o.order_id = i.order_id
  WHERE o.zodu_id = $1
    AND o.branch_id = $2
    AND o.final_payment = true
  GROUP BY 
    m.menu_name, c.name, m.menu_unit             -- 🧩 include these in GROUP BY
  ORDER BY total_qty DESC
  LIMIT 20;
`;

    const topItemsRes = await conn.query(topItemsQuery, [zodu_id, branch_id]);

    const top_items = topItemsRes.rows.map((r, index) => ({
      name: r.menu_name,
      category: r.category_name || "Uncategorized",   // ✅ fallback if category is null
      qty: `${r.total_qty} ${r.menu_unit || ""}`.trim(),  // ✅ Add unit to quantity
      price: `${Number(r.total_amount).toFixed(2)}`  // ✅ Proper formatting
    }));


    // 🔹 3️⃣ Datewise Sales (last 7–30 days)
    const dateWiseQuery = `
      WITH date_series AS (
        SELECT generate_series(
          (CURRENT_DATE - interval '29 days')::date,
          CURRENT_DATE::date,
          interval '1 day'
        )::date AS date
      ),
      sales_data AS (
        SELECT 
          order_date::date AS date,
          SUM(total_amt) AS total_amount,
          COUNT(order_id) AS total_orders
        FROM tbl_orders
        WHERE zodu_id = $1
          AND branch_id = $2
          AND final_payment = true
        GROUP BY order_date::date
      )
      SELECT 
        TO_CHAR(d.date, 'Month DD, YYYY') AS full_date,
        TO_CHAR(d.date, 'Dy') AS day_name,
        COALESCE(s.total_amount, 0) AS total_amount,
        COALESCE(s.total_orders, 0) AS total_orders
      FROM date_series d
      LEFT JOIN sales_data s ON d.date = s.date
      ORDER BY d.date DESC;
    `;
    const datewiseRes = await conn.query(dateWiseQuery, [zodu_id, branch_id]);
    const datewise_sales = datewiseRes.rows.map((r) => ({
      date: `${r.full_date.trim()} ${r.day_name}`,
      amount: Number(r.total_amount),
      bills: r.total_orders,
    }));

    // 🔹 4️⃣ Expense List (with pagination)
    const expenseQuery = `
SELECT 
  e.expense_id,
  c.category_name AS expense_name,
  c.category_name AS category_name,           
  e.total_amount,
  e.balance_amount,
  e.expense_date,
  COUNT(i.id) AS item_count
FROM tbl_expense e
LEFT JOIN tbl_expense_category c 
  ON e.category_id = c.id 
LEFT JOIN tbl_expense_items i
  ON e.expense_id = i.expense_id
WHERE e.zodu_id = $1
  AND e.branch_id = $2
GROUP BY 
  e.expense_id, 
  c.category_name, 
  e.total_amount, 
  e.balance_amount, 
  e.expense_date
ORDER BY e.expense_date ${order}
LIMIT $3 OFFSET $4;
`;


    const expenseRes = await conn.query(expenseQuery, [zodu_id, branch_id, limit, offset]);
    const expenses = expenseRes.rows.map((e) => ({

      id: e.expense_id,
      title: e.category_name,
      category: e.category_name,
      amount: e.total_amount,
      due: e.balance_amount,
      item_count: e.item_count,
      expense_date: e.expense_date
    }));

    // Count total expenses for pagination
    const expensesCountQuery = `
      SELECT COUNT(*) AS total
      FROM tbl_expense
      WHERE zodu_id = $1
        AND branch_id = $2
    `;
    const expensesCountRes = await conn.query(expensesCountQuery, [zodu_id, branch_id]);
    const totalExpenses = parseInt(expensesCountRes.rows[0]?.total || 0);

    return {
      data: {
        summary: {
          total_orders: Number(dash.total_orders || 0),
          total_amount: Number(dash.total_sales || 0),
          total_expense: Number(dash.total_expense || 0),
          low_stocks: Number(dash.low_stocks || 0),
        },
        orders,
        top_items,
        datewise_sales,
        expenses,
      },
      pagination: {
        page,
        limit,
        totalOrders,
        totalExpenses,
        totalPagesOrders: Math.ceil(totalOrders / limit),
        totalPagesExpenses: Math.ceil(totalExpenses / limit)
      }
    };
  } catch (error) {
    console.error("Dashboard error:", error);
    throw new Error(`Unable to fetch dashboard data: ${error.message}`);
  }
};

exports.getOrdersSummary = async (
  zodu_id,
  branch_id,
  start_date,
  end_date,
  options = {}
) => {
  try {
    const {
      page = 1,
      limit = 10,
      sortBy = "order_date",
      sortOrder = "desc",
    } = options;

    const offset = (page - 1) * limit;
    const order = sortOrder.toLowerCase() === "asc" ? "ASC" : "DESC";

    const allowedSort = ["order_date", "total_amt", "no_of_items"];
    const sortColumn = allowedSort.includes(sortBy) ? sortBy : "order_date";

    const query = `
WITH summary AS (
    SELECT
        COUNT(*) AS total_orders,
        COALESCE(SUM(total_amt), 0) AS total_amount,
        COALESCE(SUM(no_of_items), 0) AS total_quantity
    FROM tbl_orders
    WHERE zodu_id = $1
      AND branch_id = $2
      AND final_payment = TRUE
      AND order_date BETWEEN $3 AND $4
),

order_list AS (
    SELECT
        o.order_id,
        o.order_date,
        o.order_time,
        o.order_type,
        o.payment_type,
        o.customer_name,
        o.no_of_items,
        o.total_amt,

        -- 🔥 TOTAL QTY PER ORDER (sum of all ordered items)
        (
            SELECT COALESCE(SUM(oi.qty), 0)
            FROM tbl_ordered_items oi
            WHERE oi.order_id = o.order_id
        ) AS total_qty,

        -- 🔥 ITEM DETAILS PER ORDER
        (
            SELECT json_agg(
                json_build_object(
                    'item_name', oi.item_name,
                    'qty', oi.qty,
                    'price', oi.price,
                    'amount', (oi.qty * oi.price)
                )
            )
            FROM tbl_ordered_items oi
            WHERE oi.order_id = o.order_id
        ) AS items

    FROM tbl_orders o
    WHERE o.zodu_id = $1
      AND o.branch_id = $2
      AND o.final_payment = TRUE
      AND o.order_date BETWEEN $3 AND $4
    ORDER BY ${sortColumn} ${order}
    LIMIT $5 OFFSET $6
),

category_item_agg AS (
    SELECT
        COALESCE(c.name, 'Others') AS category_name,
        mi.menu_name AS item_name,
        SUM(oi.qty) AS total_qty,
        SUM(oi.qty * oi.price) AS total_amount
    FROM tbl_ordered_items oi
    JOIN tbl_orders o 
        ON o.order_id = oi.order_id
    LEFT JOIN tbl_menu_item mi 
        ON mi.menu_id = oi.item_id
    LEFT JOIN tbl_category c 
        ON c.id = mi.menu_category_id
       AND c.zodu_id = o.zodu_id
       AND c.branch_id = o.branch_id
    WHERE o.zodu_id = $1
      AND o.branch_id = $2
      AND o.final_payment = TRUE
      AND o.order_date BETWEEN $3 AND $4
    GROUP BY category_name, mi.menu_name
),

category_wise_summary AS (
    SELECT
        category_name,
        SUM(total_qty) AS total_qty,
        SUM(total_amount) AS total_amount,
        JSON_AGG(
            json_build_object(
                'item_name', item_name,
                'qty', total_qty,
                'amount', total_amount
            )
            ORDER BY total_amount DESC
        ) AS items
    FROM category_item_agg
    GROUP BY category_name
    ORDER BY total_amount DESC
)

SELECT
    s.*,
    COALESCE((SELECT json_agg(ol) FROM order_list ol), '[]') AS orders,
    COALESCE((SELECT json_agg(cws) FROM category_wise_summary cws), '[]') AS category_wise_summary
FROM summary s;
`;


    const result = await conn.query(query, [
      zodu_id,
      branch_id,
      start_date,
      end_date,
      limit,
      offset,
    ]);

    // ------ Pagination ------
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM tbl_orders
      WHERE zodu_id = $1
        AND branch_id = $2
        AND final_payment = TRUE
        AND order_date BETWEEN $3 AND $4
    `;

    const countResult = await conn.query(countQuery, [
      zodu_id,
      branch_id,
      start_date,
      end_date,
    ]);

    const total = parseInt(countResult.rows[0]?.total || 0);
    const totalPages = Math.ceil(total / limit);

    return {
      success: true,
      data: result.rows[0],
      pagination: { page, limit, total, totalPages },
    };
  } catch (error) {
    console.error("Repository Error (getOrdersSummary):", error);
    return {
      success: false,
      message: "Database error while fetching orders summary",
    };
  }
};





exports.getPurchaseSummary = async (
  zodu_id,
  branch_id,
  start_date,
  end_date,
  options = {}
) => {
  const {
    page = 1,
    limit = 10,
    sortBy = "purchase_date",
    sortOrder = "desc",
  } = options;

  const offset = (page - 1) * limit;

  const query = `
    WITH summary AS (
      SELECT
        COUNT(*) AS total_purchase_count,
        COALESCE(SUM(total_amount), 0) AS total_amount,
        COALESCE(SUM(paid_amount), 0) AS total_paid,
        COALESCE(SUM(balance_amount), 0) AS total_balance
      FROM tbl_purchase
      WHERE zodu_id = $1
        AND branch_id = $2
        AND purchase_date BETWEEN $3 AND $4
    ),

    purchase_list AS (
      SELECT
        p.purchase_id,
        p.purchase_date,
        p.total_amount,
        p.paid_amount,
        p.balance_amount,
        v.vendor_name,
        (
          SELECT json_agg(
            json_build_object(
              'item_name', pi.item_name,
              'qty', pi.qty,
              'unit', pi.unit,
              'price', pi.purchase_price,
              'total', pi.total_price,
              'category_name', COALESCE(c.name, 'Others')
            ) ORDER BY pi.purchase_item_id
          )
          FROM tbl_purchase_items pi
          LEFT JOIN tbl_category c ON c.id = pi.category_id
          WHERE pi.purchase_id = p.purchase_id
        ) AS items
      FROM tbl_purchase p
      LEFT JOIN tbl_vendor v ON v.vendor_id = p.vendor_id
      WHERE p.zodu_id = $1
        AND p.branch_id = $2
        AND p.purchase_date BETWEEN $3 AND $4
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT $5 OFFSET $6
    ),

    -- per (category, item)
    category_item_agg AS (
      SELECT
        COALESCE(c.name, 'Others') AS category_name,
        i.item_name,
        SUM(i.qty) AS total_qty,
        SUM(i.total_price) AS total_amount
      FROM tbl_purchase_items i
      JOIN tbl_purchase p
        ON p.purchase_id = i.purchase_id
      LEFT JOIN tbl_category c
        ON c.id = i.category_id
      WHERE p.zodu_id = $1
        AND p.branch_id = $2
        AND p.purchase_date BETWEEN $3 AND $4
      GROUP BY COALESCE(c.name, 'Others'), i.item_name
    ),

    category_wise_summary AS (
      SELECT
        category_name,
        SUM(total_qty) AS total_qty,
        SUM(total_amount) AS total_amount,
        JSON_AGG(
          json_build_object(
            'item_name', item_name,
            'qty', total_qty,
            'amount', total_amount
          ) ORDER BY total_amount DESC
        ) AS items
      FROM category_item_agg
      GROUP BY category_name
      ORDER BY total_amount DESC
    )

    SELECT
      s.*,
      COALESCE((SELECT json_agg(pl) FROM purchase_list pl), '[]') AS purchases,
      COALESCE((SELECT json_agg(cws) FROM category_wise_summary cws), '[]') AS category_wise_summary
    FROM summary s;
  `;

  const result = await conn.query(query, [
    zodu_id,
    branch_id,
    start_date,
    end_date,
    limit,
    offset,
  ]);

  const countQuery = `
    SELECT COUNT(*) AS total
    FROM tbl_purchase
    WHERE zodu_id = $1
      AND branch_id = $2
      AND purchase_date BETWEEN $3 AND $4
  `;
  const countResult = await conn.query(countQuery, [
    zodu_id,
    branch_id,
    start_date,
    end_date,
  ]);

  const total = parseInt(countResult.rows[0]?.total || 0);
  const totalPages = Math.ceil(total / limit);

  return {
    success: true,
    data: result.rows[0],
    pagination: { page, limit, total, totalPages },
  };
};


exports.getExpenseSummary = async (
  zodu_id,
  branch_id,
  start_date,
  end_date,
  options = {}
) => {
  try {
    const {
      page = 1,
      limit = 10,
      sortBy = "expense_date",
      sortOrder = "desc",
    } = options;

    const offset = (page - 1) * limit;

    // Sorting whitelist
    const allowedSortColumns = [
      "expense_date",
      "total_amount",
      "paid_amount",
      "balance_amount",
    ];
    const sortColumn = allowedSortColumns.includes(sortBy)
      ? sortBy
      : "expense_date";
    const order = sortOrder.toLowerCase() === "asc" ? "ASC" : "DESC";

    const query = `
      WITH summary AS (
        SELECT
          COUNT(*) AS total_expense_count,
          COALESCE(SUM(total_amount), 0) AS total_amount,
          COALESCE(SUM(paid_amount), 0) AS total_paid,
          COALESCE(SUM(balance_amount), 0) AS total_balance
        FROM tbl_expense
        WHERE zodu_id = $1
          AND branch_id = $2
          AND expense_date BETWEEN $3 AND $4
      ),
expense_list AS (
  SELECT
    e.expense_id,
    e.expense_date,
    e.total_amount,
    e.paid_amount,
    e.balance_amount,
    ec.category_name AS expense_name,
    ec.category_name AS category_name,

    -- total items
    (
      SELECT COUNT(*)
      FROM tbl_expense_items i
      WHERE i.expense_id = e.expense_id
    ) AS total_items,

    -- list of items for this expense
    (
      SELECT JSON_AGG(
               json_build_object(
                 'item_name', i.item_name,
                 'qty', i.qty,
                 'amount', i.total
               )
               ORDER BY i.total DESC
             )
      FROM tbl_expense_items i
      WHERE i.expense_id = e.expense_id
    ) AS items

  FROM tbl_expense e
  LEFT JOIN tbl_expense_category ec
       ON ec.id = e.category_id
  WHERE e.zodu_id = $1
    AND e.branch_id = $2
    AND e.expense_date BETWEEN $3 AND $4
  ORDER BY ${sortColumn} ${order}
  LIMIT $5 OFFSET $6
),


      category_item_agg AS (
        SELECT
          COALESCE(ec.category_name, 'Others') AS category_name,
          i.item_name,
          SUM(i.qty) AS total_qty,
          SUM(i.total) AS total_amount
        FROM tbl_expense_items i
        JOIN tbl_expense e
          ON e.expense_id = i.expense_id
        LEFT JOIN tbl_expense_category ec
          ON ec.id = e.category_id
        WHERE e.zodu_id = $1
          AND e.branch_id = $2
          AND e.expense_date BETWEEN $3 AND $4
        GROUP BY COALESCE(ec.category_name, 'Others'), i.item_name
      ),

      category_wise_summary AS (
        SELECT
          category_name,
          SUM(total_qty) AS total_qty,
          SUM(total_amount) AS total_amount,
          JSON_AGG(
            json_build_object(
              'item_name', item_name,
              'qty', total_qty,
              'amount', total_amount
            )
            ORDER BY total_amount DESC
          ) AS items
        FROM category_item_agg
        GROUP BY category_name
        ORDER BY total_amount DESC
      )

      SELECT
        s.*,
        COALESCE((SELECT json_agg(el) FROM expense_list el), '[]') AS expenses,
        COALESCE((SELECT json_agg(cws) FROM category_wise_summary cws), '[]') AS category_wise_summary
      FROM summary s;
    `;

    const result = await conn.query(query, [
      zodu_id,
      branch_id,
      start_date,
      end_date,
      limit,
      offset,
    ]);

    const countResult = await conn.query(
      `
        SELECT COUNT(*) AS total
        FROM tbl_expense
        WHERE zodu_id = $1
          AND branch_id = $2
          AND expense_date BETWEEN $3 AND $4
      `,
      [zodu_id, branch_id, start_date, end_date]
    );

    const total = parseInt(countResult.rows[0]?.total || 0);
    const totalPages = Math.ceil(total / limit);

    return {
      success: true,
      data: result.rows[0],
      pagination: { page, limit, total, totalPages },
    };
  } catch (error) {
    console.error("Repository Error (getExpenseSummary):", error);
    return {
      success: false,
      message: "Database error while fetching expense summary",
    };
  }
};


exports.getInventorySummary = async (
  zodu_id,
  branch_id,
  start_date,
  end_date,
  options = {}
) => {
  try {
    const {
      page = 1,
      limit = 10,
      sortBy = "updated_at",
      sortOrder = "desc",
    } = options;

    const offset = (page - 1) * limit;

    const allowedSortColumns = ["item_name", "stock_qty", "updated_at"];
    const sortColumn = allowedSortColumns.includes(sortBy)
      ? sortBy
      : "updated_at";
    const order = sortOrder.toLowerCase() === "asc" ? "ASC" : "DESC";

    const query = `
      WITH summary AS (
        SELECT
          COUNT(*) AS total_items,
          COALESCE(SUM(stock_qty), 0) AS total_stock_qty,
          COALESCE(SUM(stock_qty * purchase_price), 0) AS total_stock_value
        FROM tbl_inventory
        WHERE zodu_id = $1
          AND branch_id = $2
          AND updated_at BETWEEN $3 AND $4
      ),

      inventory_list AS (
        SELECT
          i.inventory_id,
          i.item_id,
          i.item_name,
          i.stock_qty,
          i.stock_alert,
          i.purchase_price,
          i.updated_at,
          i.category_id,
          COALESCE(c.name, 'Others') AS category_name,
          COALESCE(u.short_name, '-') AS unit_name,
          (i.stock_qty * i.purchase_price) AS total_amount
        FROM tbl_inventory i
        LEFT JOIN tbl_category c ON c.id = i.category_id
        LEFT JOIN tbl_units u ON u.id = i.item_unit
        WHERE i.zodu_id = $1
          AND i.branch_id = $2
          AND i.updated_at BETWEEN $3 AND $4
        ORDER BY ${sortColumn} ${order}
        LIMIT $5 OFFSET $6
      ),

      category_item_agg AS (
        SELECT
          COALESCE(c.name, 'Others') AS category_name,
          i.item_name,
          SUM(i.stock_qty) AS total_qty,
          SUM(i.stock_qty * i.purchase_price) AS total_amount,
          COALESCE(u.short_name, '-') AS unit_name
        FROM tbl_inventory i
        LEFT JOIN tbl_category c ON c.id = i.category_id
        LEFT JOIN tbl_units u ON u.id = i.item_unit
        WHERE i.zodu_id = $1
          AND i.branch_id = $2
          AND i.updated_at BETWEEN $3 AND $4
        GROUP BY COALESCE(c.name, 'Others'), i.item_name, u.short_name
      ),

      category_wise_summary AS (
        SELECT
          category_name,
          SUM(total_qty) AS total_qty,
          SUM(total_amount) AS total_amount,
          JSON_AGG(
            json_build_object(
              'item_name', item_name,
              'qty', total_qty,
              'unit', unit_name,
              'amount', total_amount
            )
            ORDER BY total_amount DESC
          ) AS items
        FROM category_item_agg
        GROUP BY category_name
        ORDER BY total_amount DESC
      )

      SELECT
        s.*,
        COALESCE((SELECT json_agg(il) FROM inventory_list il), '[]') AS inventory_list,
        COALESCE((SELECT json_agg(cws) FROM category_wise_summary cws), '[]') AS category_wise_summary
      FROM summary s;
    `;

    const result = await conn.query(query, [
      zodu_id,
      branch_id,
      start_date,
      end_date,
      limit,
      offset,
    ]);

    const countResult = await conn.query(
      `
        SELECT COUNT(*) AS total
        FROM tbl_inventory
        WHERE zodu_id = $1
          AND branch_id = $2
          AND updated_at BETWEEN $3 AND $4
      `,
      [zodu_id, branch_id, start_date, end_date]
    );

    const total = parseInt(countResult.rows[0]?.total || 0);
    const totalPages = Math.ceil(total / limit);

    return {
      success: true,
      data: result.rows[0],
      pagination: { page, limit, total, totalPages },
    };
  } catch (error) {
    console.error("Repository Error (getInventorySummary):", error);
    return {
      success: false,
      message: "Database error while fetching inventory summary",
    };
  }
};


exports.createHold = async (zodu_id, branch_id, orderType, table_no, customerName, customerPhone) => {
  console.log(zodu_id);
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

  return result.rows[0].hold_id;
}

exports.insertHoldItem = async (hold_id, zodu_id, branch_id, item) => {

  const query = `
    INSERT INTO tbl_hold_items 
      (zodu_id, branch_id, hold_id, item_name, item_id, item_unit, qty, price, variant_name, variant_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  `;

  await conn.query(query, [
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
  ]);
}






// exports.getReport = async ({
//   zodu_id,
//   branch_id,
//   type,
//   filter,
//   wiseData,
//   start_date,
//   end_date
// }) => {
//   try {
//     let dateField = "created_at";
//     let query = "";
//     let params = [zodu_id, branch_id];
//     let startDate, endDate;

//     // 🔹 Date range filters
//     switch (filter) {
//       case "daily":
//         startDate = moment().startOf("day");
//         endDate = moment().endOf("day");
//         break;
//       case "weekly":
//         startDate = moment().startOf("week");
//         endDate = moment().endOf("week");
//         break;
//       case "monthly":
//         startDate = moment().startOf("month");
//         endDate = moment().endOf("month");
//         break;
//       case "yearly":
//         startDate = moment().startOf("year");
//         endDate = moment().endOf("year");
//         break;
//       case "custom":
//         startDate = start_date ? moment(start_date) : moment().startOf("day");
//         endDate = end_date ? moment(end_date) : moment().endOf("day");
//         break;
//       default:
//         startDate = moment().startOf("day");
//         endDate = moment().endOf("day");
//     }

//     params.push(startDate.toDate(), endDate.toDate());

//     console.log(params)

//     // 🔹 ORDER REPORT
//     if (type === "order") {
//       if (wiseData === "category") {
//         query = `
//           SELECT
//             COALESCE(i.item_name, 'Unknown') AS category,
//             SUM(i.price * i.qty) AS total_amount,
//             COUNT(DISTINCT o.order_id) AS total_count
//           FROM tbl_orders o
//           LEFT JOIN tbl_ordered_items i ON o.order_id = i.order_id
//           WHERE o.zodu_id = $1
//             AND o.branch_id = $2
//             AND o.final_payment = true
//             AND o.${dateField} BETWEEN $3 AND $4
//           GROUP BY i.item_name
//           ORDER BY total_amount DESC;
//         `;
//       } else if (wiseData === "item") {
//         query = `
//           SELECT
//             COALESCE(i.item_name, 'Unknown') AS item_name,
//             SUM(i.qty) AS total_qty,
//             SUM(i.price * i.qty) AS total_amount,
//             COUNT(DISTINCT o.order_id) AS total_count
//           FROM tbl_orders o
//           LEFT JOIN tbl_ordered_items i ON o.order_id = i.order_id
//           WHERE o.zodu_id = $1
//             AND o.branch_id = $2
//             AND o.final_payment = true
//             AND o.${dateField} BETWEEN $3 AND $4
//           GROUP BY i.item_name
//           ORDER BY total_amount DESC;
//         `;
//       } else {
//         query = `
//           WITH order_data AS (
//             SELECT
//               o.order_id,
//               o.table_no,
//               o.order_type,
//               o.customer_name,
//               o.customer_phone,
//               o.total_amt,
//               o.final_payment,
//               o.order_date,
//               o.order_time,
//               COALESCE(
//                 JSON_AGG(
//                   DISTINCT JSONB_BUILD_OBJECT(
//                     'item_id', i.item_id,
//                     'item_name', i.item_name,
//                     'qty', i.qty,
//                     'price', i.price,
//                     'item_unit', i.item_unit
//                   )
//                 ) FILTER (WHERE i.item_id IS NOT NULL), '[]'
//               ) AS ordered_items
//             FROM tbl_orders o
//             LEFT JOIN tbl_ordered_items i ON o.order_id = i.order_id
//             WHERE o.zodu_id = $1
//               AND o.branch_id = $2
//               AND o.final_payment = true
//               AND o.${dateField} BETWEEN $3 AND $4
//             GROUP BY o.order_id
//           )
//           SELECT
//             JSON_AGG(order_data) AS data,
//             COUNT(*) AS total_count,
//             COALESCE(SUM(total_amt), 0) AS total_amount,
//             0 AS total_unpaid
//           FROM order_data;
//         `;
//       }
//     }

//     // 🔹 EXPENSE REPORT
//    else if (type === "expense") {
//   if (wiseData === "category") {
//     // 🔹 CATEGORY-WISE EXPENSE REPORT
//     query = `
//       SELECT
//         c.name AS category_name,
//         COUNT(e.expense_id) AS total_count,
//         COALESCE(SUM(e.total_amount), 0) AS total_amount,
//         COALESCE(SUM(e.paid_amount), 0) AS total_paid,
//         COALESCE(SUM(e.balance_amount), 0) AS total_balance
//       FROM tbl_expense e
//       LEFT JOIN tbl_category c ON e.category_id = c.id
//       WHERE
//         e.zodu_id = $1
//         AND e.branch_id = $2
//         AND e.expense_date BETWEEN $3 AND $4
//       GROUP BY c.name
//       ORDER BY total_amount DESC;
//     `;

//   } else if (wiseData === "item") {
//     // 🔹 ITEM-WISE EXPENSE REPORT
//     query = `
//       SELECT
//         ei.item_name,
//         c.name AS category_name,
//         COALESCE(SUM(ei.qty), 0) AS total_qty,
//         COALESCE(SUM(ei.total), 0) AS total_value,
//         COUNT(DISTINCT e.expense_id) AS expense_count
//       FROM tbl_expense e
//       LEFT JOIN tbl_expense_items ei ON e.expense_id = ei.expense_id
//       LEFT JOIN tbl_category c ON e.category_id = c.id
//       WHERE
//         e.zodu_id = $1
//         AND e.branch_id = $2
//         AND e.expense_date BETWEEN $3 AND $4
//       GROUP BY ei.item_name, c.name
//       ORDER BY total_value DESC;
//     `;

//   } else {
//     // 🔹 FULL EXPENSE REPORT (WITH ITEM DETAILS)
//     query = `
//       SELECT
//         e.expense_id,
//         e.zodu_id,
//         e.branch_id,
//         e.category_id,
//         e.expense_name,
//         e.attachment_url,
//         e.description,
//         c.name AS category_name,
//         e.expense_date,
//         e.total_amount,
//         e.paid_amount,
//         e.balance_amount,
//         e.created_at,
//         e.updated_at,
//         COALESCE(
//           JSON_AGG(
//             JSON_BUILD_OBJECT(
//               'item_id', ei.item_id,
//               'item_name', ei.item_name,
//               'quantity', ei.qty,
//               'price', ei.price,
//               'total', ei.total
//             )
//           ) FILTER (WHERE ei.expense_id IS NOT NULL),
//           '[]'
//         ) AS items
//       FROM tbl_expense e
//       LEFT JOIN tbl_expense_items ei ON e.expense_id = ei.expense_id
//       LEFT JOIN tbl_category c ON e.category_id = c.id
//       WHERE
//         e.zodu_id = $1
//         AND e.branch_id = $2
//         AND e.expense_date BETWEEN $3 AND $4
//       GROUP BY
//         e.expense_id,
//         e.zodu_id,
//         e.branch_id,
//         e.category_id,
//         e.expense_name,
//         e.attachment_url,
//         e.description,
//         c.name,
//         e.expense_date,
//         e.total_amount,
//         e.paid_amount,
//         e.balance_amount,
//         e.created_at,
//         e.updated_at
//       ORDER BY e.expense_date DESC;
//     `;
//   }
// }


//     // 🔹 INVENTORY REPORT
// else if (type === "inventory") {
//   if (wiseData === "category") {
//     // 🔹 CATEGORY-WISE INVENTORY REPORT
//     query = `
//       SELECT
//         c.name AS category,
//         COALESCE(SUM(i.stock_qty * i.purchase_price), 0) AS total_amount,
//         COUNT(i.inventory_id) AS total_count
//       FROM tbl_inventory i
//       LEFT JOIN tbl_category c ON i.category_id = c.id
//       WHERE i.zodu_id = $1
//         AND i.branch_id = $2
//         AND i.last_purchase_date BETWEEN $3 AND $4
//       GROUP BY c.name
//       ORDER BY total_amount DESC;
//     `;
//   } else if (wiseData === "item") {
//     // 🔹 ITEM-WISE INVENTORY REPORT
//     query = `
//       SELECT
//         i.item_name,
//         c.name AS category,
//         COALESCE(SUM(i.stock_qty), 0) AS total_qty,
//         COALESCE(SUM(i.purchase_price * i.stock_qty), 0) AS total_amount,
//         COUNT(i.inventory_id) AS total_count,
//         COALESCE(AVG(m.gst_tax::numeric), 0) AS gst_tax
//       FROM tbl_inventory i
//       LEFT JOIN tbl_category c ON i.category_id = c.id
//       LEFT JOIN tbl_menu_item m ON i.item_id = m.menu_id
//       WHERE i.zodu_id = $1
//         AND i.branch_id = $2
//         AND i.last_purchase_date BETWEEN $3 AND $4
//       GROUP BY i.item_name, c.name
//       ORDER BY total_amount DESC;
//     `;
//   } else {
//     // 🔹 DEFAULT INVENTORY LIST REPORT (with summary support)
//     query = `
//       WITH inventory_data AS (
//         SELECT
//           i.inventory_id,
//           i.item_name,
//           c.name AS category,
//           COALESCE(i.stock_qty, 0) AS stock_qty,
//           COALESCE(i.purchase_price, 0) AS purchase_price,
//           COALESCE(i.selling_price, 0) AS selling_price,
//           i.inventory_type,
//           i.last_purchase_date,
//           i.updated_at,
//           COALESCE(m.gst_tax::numeric, 0) AS gst_tax,
//           (COALESCE(i.stock_qty, 0) * COALESCE(i.purchase_price, 0)) AS total_value
//         FROM tbl_inventory i
//         LEFT JOIN tbl_category c ON i.category_id = c.id
//         LEFT JOIN tbl_menu_item m ON i.item_id = m.menu_id
//         WHERE i.zodu_id = $1
//           AND i.branch_id = $2
//           AND i.last_purchase_date BETWEEN $3 AND $4
//       )
//       SELECT
//         JSON_AGG(inventory_data) AS data,
//         COUNT(*) AS total_count,
//         COALESCE(SUM(total_value), 0) AS total_amount
//       FROM inventory_data;
//     `;
//   }
// }



//     // 🔹 PURCHASE REPORT
//     else if (type === "purchase") {
//       if (wiseData === "category") {
//         query = `
//           SELECT
//             c.name AS category_name,
//             SUM(p.total_amount) AS total_amount,
//             SUM(p.balance_amount) AS total_unpaid,
//             COUNT(p.purchase_id) AS total_count
//           FROM tbl_purchase p
//           LEFT JOIN tbl_category c ON p.category_id = c.id
//           WHERE p.zodu_id = $1
//             AND p.branch_id = $2
//             AND p.purchase_date BETWEEN $3 AND $4
//           GROUP BY c.name
//           ORDER BY total_amount DESC;
//         `;
//       } else if (wiseData === "item") {
//         query = `
//           SELECT
//             pi.item_name,
//             SUM(pi.qty) AS total_qty,
//             SUM(pi.total_price) AS total_amount,
//             COUNT(pi.item_id) AS total_count,
//             COALESCE(SUM(p.balance_amount), 0) AS total_unpaid
//           FROM tbl_purchase p
//           LEFT JOIN tbl_purchase_items pi ON p.purchase_id = pi.purchase_id
//           WHERE p.zodu_id = $1
//             AND p.branch_id = $2
//             AND p.purchase_date BETWEEN $3 AND $4
//           GROUP BY pi.item_name
//           ORDER BY total_amount DESC;
//         `;
//       } else {
//         query = `
//           WITH purchase_data AS (
//             SELECT
//               p.purchase_id,
//               p.branch_id,
//               p.category_id,
//               p.payment_type,
//               p.attachment_url,
//               p.notes,
//               c.name AS category_name,
//               p.vendor_id,
//               v.vendor_name,
//               v.vendor_phone,
//               v.vendor_email,
//               v.company_name,
//               p.purchase_date,
//               p.total_amount,
//               p.paid_amount,
//               p.balance_amount,
//               p.created_at,
//               p.updated_at,
//               COALESCE(
//                 JSON_AGG(
//                   JSON_BUILD_OBJECT(
//                     'item_id', pi.item_id,
//                     'item_name', pi.item_name,
//                     'quantity', pi.qty,
//                     'unit', pi.unit,
//                     'price', pi.purchase_price,
//                     'total', pi.total_price,
//                     'image', m.menu_image
//                   )
//                 ) FILTER (WHERE pi.purchase_id IS NOT NULL),
//                 '[]'
//               ) AS items
//             FROM tbl_purchase p
//             LEFT JOIN tbl_purchase_items pi ON p.purchase_id = pi.purchase_id
//             LEFT JOIN tbl_category c ON p.category_id = c.id
//             LEFT JOIN tbl_vendor v ON p.vendor_id = v.vendor_id
//             LEFT JOIN tbl_menu_item m ON pi.item_id = m.menu_id
//             WHERE p.zodu_id = $1
//               AND p.branch_id = $2
//               AND p.purchase_date BETWEEN $3 AND $4
//             GROUP BY
//               p.purchase_id, p.branch_id, p.category_id, p.payment_type,
//               p.attachment_url, p.notes, c.name, p.vendor_id, v.vendor_name,
//               v.company_name, v.vendor_phone, v.vendor_email,
//               p.purchase_date, p.total_amount, p.paid_amount,
//               p.balance_amount, p.created_at, p.updated_at
//           )
//           SELECT
//             JSON_AGG(purchase_data) AS data,
//             COUNT(*) AS total_count,
//             COALESCE(SUM(total_amount), 0) AS total_amount,
//             COALESCE(SUM(balance_amount), 0) AS total_unpaid
//           FROM purchase_data;
//         `;
//       }
//     }

//     // 🔹 Execute query
//     const result = await conn.query(query, params);
//     const rows = result.rows || [];

//     // 🔹 Handle JSON aggregate queries (data, summary)
//     if (rows.length && rows[0].data) {
//       const { data, total_count, total_amount, total_unpaid } = rows[0];
//       return {
//         type,
//         filter,
//         wiseData,
//         summary: {
//           total_count: parseInt(total_count || 0),
//           total_amount: parseFloat(total_amount || 0),
//           total_unpaid: parseFloat(total_unpaid || 0)
//         },
//         data
//       };
//     }

//     // 🔹 For item/category reports
//     const total_amount = rows.reduce((sum, r) => sum + (Number(r.total_amount || r.total_value || 0)), 0);
//     const total_count = rows.reduce((sum, r) => sum + (Number(r.total_count || 0)), 0);
//     const total_unpaid = rows.reduce((sum, r) => sum + (Number(r.total_unpaid || 0)), 0);

//     return {
//       type,
//       filter,
//       wiseData,
//       summary: {
//         total_count,
//         total_amount,
//         total_unpaid
//       },
//       data: rows
//     };

//   } catch (error) {
//     console.error("Report error", error);
//     throw new Error(`Unable to generate report: ${error.message}`);
//   }
// };



