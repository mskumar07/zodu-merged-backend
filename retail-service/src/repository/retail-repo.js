const moment = require('moment/moment');
const conn = require('../database/connection');
const { withDescription } = require('../utils/description');
const { randomUUID } = require("crypto");
const { deleteFileFromMinIO } = require('../services/retail-service');
// const { calculateItemTax } = require('../utils/gstcalcukator');
const { generatePublicOrderNo } = require('./generatePublicOrderNo');
const { calculateItemsWithDiscount } = require('../utils/gstcalcukator');
const sharp = require('sharp');
const authClient = require('../utils/authClient');


// ========== Company Repository Functions ==========

const orderSortFields = ["order_date", "order_id", "total_amt", "no_of_items"];

const round = (n) => Math.round(n * 100) / 100;

const getAddressLine1 = (data) => data.address_line_1 ?? data.building_no ?? null;
const getAddressLine2 = (data) => data.address_line_2 ?? null;
const getBranchAddressLine1 = (data) => data.branch_address_line_1 ?? null;
const getBranchAddressLine2 = (data) => data.branch_address_line_2 ?? null;

function toBoolean(value) {
  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }
  return Boolean(value);
}
 
// function generateSaleId(saleType) {
//   // e.g. "SALE-1716300000000"  – replace with your own scheme
//   if(saleType==="retail"){
//     return `SALE-${Date.now()}`;
//   } else {
//     return `${saleType.toUpperCase()}-${Date.now()}`;
//   } 
// }
 
function generateTransactionId() {
  return `TXN-${randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`;
}



// repository — normalised: tbl_business + tbl_address + tbl_bank_details
exports.createCompany = async (companyData) => {
  console.log(companyData);
  const client = await conn.connect();
  try {
    await client.query('BEGIN');

    // 1. Insert address
    let address_id = null;
    const addressLine1 = getAddressLine1(companyData);
    const addressLine2 = getAddressLine2(companyData);
    if (addressLine1 || addressLine2 || companyData.city ||
        companyData.district || companyData.state || companyData.pincode) {
      const addrRes = await client.query(
        `INSERT INTO tbl_address (zodu_id, address_line_1, address_line_2, city, district, state, pincode)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [companyData.zodu_id, addressLine1, addressLine2,
         companyData.city || null, companyData.district || null, companyData.state || null,
         companyData.pincode || null]
      );
      address_id = addrRes.rows[0].id;
    }

    // 2. Insert bank_details
    let bank_details_id = null;
    if (companyData.account_number) {
      const bankRes = await client.query(
        `INSERT INTO tbl_bank_details (zodu_id, bank_name, bank_branch, holder_name, account_number, account_type, ifsc_code)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [companyData.zodu_id, companyData.bank_name || null, companyData.bank_branch || null,
         companyData.holder_name || null, companyData.account_number,
         companyData.account_type || null, companyData.ifsc_code || null]
      );
      bank_details_id = bankRes.rows[0].id;
    }

    // 3. Insert business
    const companyRes = await client.query(
      `INSERT INTO tbl_business
         (zodu_id, business_name, owner_admin_name, mobile_no, mail_id, gst_no, address_id, bank_details_id, status,type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true,$9)
       ON CONFLICT (zodu_id) DO UPDATE
         SET business_name    = EXCLUDED.business_name,
             owner_admin_name = EXCLUDED.owner_admin_name,
             mobile_no        = EXCLUDED.mobile_no,
             mail_id          = EXCLUDED.mail_id,
             gst_no           = EXCLUDED.gst_no,
             address_id       = COALESCE(EXCLUDED.address_id, tbl_business.address_id),
             bank_details_id  = COALESCE(EXCLUDED.bank_details_id, tbl_business.bank_details_id),
             updated_at       = now()
       RETURNING *`,
      [companyData.zodu_id, companyData.restaurant_name, companyData.owner_admin_name || null,
       companyData.mobile_no, companyData.mail_id, companyData.gst_no || null,
       address_id, bank_details_id, companyData.type || null]
    );

    if (!companyRes.rows[0]) throw new Error('Company insert returned no row');

    await client.query('COMMIT');
    return companyRes.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

exports.updateCompany = async (zodu_id, fields) => {
  if (Object.keys(fields).length === 0) return null;

  const client = await conn.connect();
  try {
    await client.query('BEGIN');

    // Fetch current address_id and bank_details_id
    const compRes = await client.query(
      `SELECT address_id, bank_details_id FROM tbl_business WHERE zodu_id = $1`,
      [zodu_id]
    );
    if (!compRes.rows[0]) throw new Error('Company not found');
    const { address_id, bank_details_id } = compRes.rows[0];

    const companyFields = {};
    const addressFields = {};
    const bankFields    = {};

    const addressCols = ['address_line_1', 'address_line_2', 'city', 'district', 'state', 'pincode'];
    const bankCols    = ['bank_name', 'bank_branch', 'holder_name', 'account_number', 'account_type', 'ifsc_code'];

    for (const [key, value] of Object.entries(fields)) {
      if (addressCols.includes(key))    addressFields[key] = value;
      else if (bankCols.includes(key))  bankFields[key]    = value;
      else                              companyFields[key]  = value;
    }

    // Remap restaurant_name → business_name
    if ('restaurant_name' in companyFields) {
      companyFields.business_name = companyFields.restaurant_name;
      delete companyFields.restaurant_name;
    }

    // Update or insert address
    if (Object.keys(addressFields).length > 0) {
      // Map building_no → floor_building_no
      const dbAddr = {};
      for (const [k, v] of Object.entries(addressFields)) {
        if (k === 'building_no') dbAddr.address_line_1 = v;
        else if (k === 'area_street_name') dbAddr.address_line_2 = v;
        else dbAddr[k] = v;
      }
      if (address_id) {
        const addrKeys = Object.keys(dbAddr);
        const addrVals = Object.values(dbAddr);
        const addrSet  = addrKeys.map((k, i) => `${k}=$${i + 1}`).join(', ');
        await client.query(
          `UPDATE tbl_address SET ${addrSet}, updated_at=now() WHERE id=$${addrKeys.length + 1}`,
          [...addrVals, address_id]
        );
      } else {
        const addrRes = await client.query(
          `INSERT INTO tbl_address (zodu_id, address_line_1, address_line_2, city, district, state, pincode)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [zodu_id, addressFields.address_line_1 ?? null,
           addressFields.address_line_2 ?? null,
           addressFields.city || null, addressFields.district || null,
           addressFields.state || null, addressFields.pincode || null]
        );
        companyFields.address_id = addrRes.rows[0].id;
      }
    }

    // Update or insert bank_details
    if (Object.keys(bankFields).length > 0) {
      if (bank_details_id) {
        const bankKeys = Object.keys(bankFields);
        const bankVals = Object.values(bankFields);
        const bankSet  = bankKeys.map((k, i) => `${k}=$${i + 1}`).join(', ');
        await client.query(
          `UPDATE tbl_bank_details SET ${bankSet}, updated_at=now() WHERE id=$${bankKeys.length + 1}`,
          [...bankVals, bank_details_id]
        );
      } else {
        const bankRes = await client.query(
          `INSERT INTO tbl_bank_details (zodu_id, bank_name, bank_branch, holder_name, account_number, account_type, ifsc_code)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [zodu_id, bankFields.bank_name || null, bankFields.bank_branch || null,
           bankFields.holder_name || null, bankFields.account_number || null,
           bankFields.account_type || null, bankFields.ifsc_code || null]
        );
        companyFields.bank_details_id = bankRes.rows[0].id;
      }
    }

    // Update tbl_business
    let updated;
    if (Object.keys(companyFields).length > 0) {
      const keys   = Object.keys(companyFields);
      const values = Object.values(companyFields);
      const setQ   = [...keys.map((k, i) => `${k}=$${i + 1}`), `updated_at=now()`].join(', ');
      const res = await client.query(
        `UPDATE tbl_business SET ${setQ} WHERE zodu_id=$${keys.length + 1} RETURNING *`,
        [...values, zodu_id]
      );
      updated = res.rows[0];
    } else {
      const res = await client.query(`SELECT * FROM tbl_business WHERE zodu_id=$1`, [zodu_id]);
      updated = res.rows[0];
    }

    await client.query('COMMIT');
    return updated;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

exports.getCompanyByZoduId = async (zodu_id) => {
  const res = await conn.query(
    `SELECT c.*,
            c.business_name AS restaurant_name,
            a.address_line_1, a.address_line_2,
            a.city, a.district, a.state, a.pincode,
            b.bank_name, b.bank_branch, b.holder_name,
            b.account_number, b.account_type, b.ifsc_code
     FROM tbl_business c
     LEFT JOIN tbl_address     a ON a.id = c.address_id
     LEFT JOIN tbl_bank_details b ON b.id = c.bank_details_id
     WHERE c.zodu_id = $1`,
    [zodu_id]
  );
  return res.rows[0];
};


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
    'SELECT max(zodu_id) FROM tbl_business');
};

// exports.get_category_data() {
//   return await conn.query(
//     'SELECT name,zodu_id,branch_id,active FROM tbl_category');
// }

exports.get_category_data = async (type, branch_id, zodu_id, page = 1, limit = 10) => {
  try {
    const offset = (page - 1) * limit;

    const dataQuery = `
      SELECT *
      FROM tbl_category
      WHERE type = $1 AND branch_id = $2 AND zodu_id = $3 AND active = true
      ORDER BY id DESC
      LIMIT $4 OFFSET $5
    `;

    const countQuery = `
      SELECT COUNT(*)::int AS total_count
      FROM tbl_category
      WHERE type = $1 AND branch_id = $2 AND zodu_id = $3 And active = true
    `;

    const [dataResult, countResult] = await Promise.all([
      conn.query(dataQuery,  [type, branch_id, zodu_id, limit, offset]),
      conn.query(countQuery, [type, branch_id, zodu_id]),
    ]);

    const total_count = countResult.rows[0].total_count;
    const total_pages = Math.ceil(total_count / limit);

    return {
      rows: dataResult.rows,
      total_count,
      total_pages,
    };
  } catch (err) {
    throw new Error("Unable to fetch category data: " + err.message);
  }
}

exports.get_all_category_data = async (types, branch_id, zodu_id, page = 1, limit = 10, active, category_name) => {
  try {
    const offset = (page - 1) * limit;

    const params  = [branch_id, zodu_id];
    let filters = "";

    if (types && types.length > 0) {
      params.push(types);
      filters += ` AND type = ANY($${params.length})`;
    }
    if (active !== undefined) {
      params.push(active);
      filters += ` AND active = $${params.length}`;
    }
    if (category_name) {
      params.push(`%${category_name}%`);
      filters += ` AND name ILIKE $${params.length}`;
    }

    params.push(limit, offset);

    const query = `
      SELECT
        id, zodu_id, branch_id, name, active, created_at, updated_at,
        type AS type_code,
        CASE type
          WHEN 'S' THEN 'Sellable'
          WHEN 'E' THEN 'Expense'
          WHEN 'M' THEN 'Service'
          ELSE type
        END AS type,
        COUNT(*) OVER()::int AS total_count
      FROM tbl_category
      WHERE branch_id = $1 AND zodu_id = $2
        ${filters}
      ORDER BY active DESC, id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;

    const result = await conn.query(query, params);

    const total_count = result.rows[0]?.total_count ?? 0;
    const total_pages  = Math.ceil(total_count / limit);
    const rows = result.rows.map(({ total_count, ...row }) => row);

    return {
      rows,
      total_count,
      total_pages,
    };
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

exports.get_all_report_data = async (
  zodu_id,
  branch_id,
  page = 1,
  limit = 10,
  filtered_type,
  start_date,
  end_date,
  year,
  search = ""
) => {
  try {
    const offset = (page - 1) * limit;
    const isMonthYearWise = filtered_type === "month_year_wise";
    const isDateWise = filtered_type === "date_wise";

    const hasDateFilter =
      start_date &&
      end_date &&
      start_date !== "" &&
      end_date !== "" &&
      start_date !== "null" &&
      end_date !== "null";

    /* =====================================================
       MONTH / YEAR WISE
    ===================================================== */
    if (isMonthYearWise) {
      const monthNames = [
        "January","February","March","April","May","June",
        "July","August","September","October","November","December"
      ];

      /* ---------- SPECIFIC YEAR ---------- */
      if (year && year !== "null" && year !== "undefined") {
        const parsedYear = parseInt(year, 10);

        const query = `
          SELECT
            EXTRACT(MONTH FROM created_at)::int AS month_number,
            COUNT(*) AS total_orders,
            COALESCE(SUM(total_amt),0) AS total_amount,
            SUM(COUNT(*)) OVER() AS total_count,
            COALESCE(SUM(SUM(total_amt)) OVER(),0) AS all_total_amount,
            COALESCE(SUM(SUM(no_of_items)) OVER(),0) AS all_items_total
          FROM tbl_orders
          WHERE zodu_id = $1
            AND branch_id = $2
            AND final_payment = true
            AND EXTRACT(YEAR FROM created_at)::int = $3
          GROUP BY month_number
          ORDER BY month_number
        `;

        const { rows } = await conn.query(query, [
          zodu_id,
          branch_id,
          parsedYear
        ]);

        const monthMap = {};
        let yearTotalOrders = 0;
        let yearTotalAmount = 0;

        rows.forEach(r => {
          monthMap[r.month_number] = r;
          yearTotalOrders += Number(r.total_orders);
          yearTotalAmount += Number(r.total_amount);
        });

        return {
          rows: [],
          totals: rows.length
            ? {
                total_count: rows[0].total_count,
                all_total_amount: rows[0].all_total_amount,
                all_items_total: rows[0].all_items_total
              }
            : { total_count: 0, all_total_amount: 0, all_items_total: 0 },
          monthly_summary: [{
            year: parsedYear,
            total_orders: yearTotalOrders,
            total_amount: yearTotalAmount,
            months: monthNames.map((m, i) => ({
              month_number: i + 1,
              month: m,
              total_orders: Number(monthMap[i + 1]?.total_orders || 0),
              total_amount: Number(monthMap[i + 1]?.total_amount || 0)
            }))
          }]
        };
      }

      /* ---------- ALL YEARS ---------- */
      const query = `
        SELECT
          EXTRACT(YEAR FROM created_at)::int AS year,
          EXTRACT(MONTH FROM created_at)::int AS month_number,
          COUNT(*) AS total_orders,
          COALESCE(SUM(total_amt),0) AS total_amount,
          SUM(COUNT(*)) OVER() AS total_count,
          COALESCE(SUM(SUM(total_amt)) OVER(),0) AS all_total_amount,
          COALESCE(SUM(SUM(no_of_items)) OVER(),0) AS all_items_total
        FROM tbl_orders
        WHERE zodu_id = $1
          AND branch_id = $2
          AND final_payment = true
        GROUP BY year, month_number
        ORDER BY year, month_number
      `;

      const { rows } = await conn.query(query, [zodu_id, branch_id]);

      const yearMap = {};
      rows.forEach(r => {
        if (!yearMap[r.year]) {
          yearMap[r.year] = { total_orders: 0, total_amount: 0, months: {} };
        }
        yearMap[r.year].months[r.month_number] = r;
        yearMap[r.year].total_orders += Number(r.total_orders);
        yearMap[r.year].total_amount += Number(r.total_amount);
      });

      return {
        rows: [],
        totals: rows.length
          ? {
              total_count: rows[0].total_count,
              all_total_amount: rows[0].all_total_amount,
              all_items_total: rows[0].all_items_total
            }
          : { total_count: 0, all_total_amount: 0, all_items_total: 0 },
        monthly_summary: Object.keys(yearMap)
          .sort((a, b) => a - b)
          .map(y => ({
            year: Number(y),
            total_orders: yearMap[y].total_orders,
            total_amount: yearMap[y].total_amount,
            months: monthNames.map((m, i) => ({
              month_number: i + 1,
              month: m,
              total_orders: Number(yearMap[y].months[i + 1]?.total_orders || 0),
              total_amount: Number(yearMap[y].months[i + 1]?.total_amount || 0)
            }))
          }))
      };
    }

    /* =====================================================
       ALL / DATE WISE / SEARCH
    ===================================================== */

    let whereClauses = [];
    let baseParams = [zodu_id, branch_id];

    if (hasDateFilter) {
      whereClauses.push(
        `created_at::date BETWEEN $${baseParams.length + 1} AND $${baseParams.length + 2}`
      );
      baseParams.push(start_date, end_date);
    }

    if (search && search.trim() !== "") {
      whereClauses.push(`
        (
          public_order_no ILIKE $${baseParams.length + 1}
          OR payment_type ILIKE $${baseParams.length + 1}
          OR order_type ILIKE $${baseParams.length + 1}
        )
      `);
      baseParams.push(`%${search}%`);
    }

    const whereSQL = whereClauses.length ? `AND ${whereClauses.join(" AND ")}` : "";
    const limitIdx = `$${baseParams.length + 1}`;
    const offsetIdx = `$${baseParams.length + 2}`;

    const cteQuery = `
      WITH filtered AS (
        SELECT
          public_order_no,
          api_order_id,
          created_at,
          order_type,
          no_of_items,
          total_tax,
          total_amt,
          payment_type
        FROM tbl_orders
        WHERE zodu_id = $1
          AND branch_id = $2
          AND final_payment = true
          ${whereSQL}
      ),
      totals AS (
        SELECT
          COUNT(*) AS total_count,
          SUM(total_amt) AS all_total_amount,
          SUM(no_of_items) AS all_items_total
        FROM filtered
      )
      SELECT
        TO_CHAR(f.created_at,'DD Mon YYYY, HH12:MI AM (Dy)') AS created_at,
        f.public_order_no,
        f.api_order_id,
        f.order_type,
        f.no_of_items,
        f.total_tax,
        f.total_amt,
        f.payment_type,
        t.total_count,
        t.all_total_amount,
        t.all_items_total
      FROM filtered f
      CROSS JOIN totals t
      ORDER BY f.created_at DESC
      LIMIT ${limitIdx} OFFSET ${offsetIdx}
    `;

    const queries = [conn.query(cteQuery, [...baseParams, limit, offset])];

    if (isDateWise) {
      const datewiseQuery = hasDateFilter
        ? `
          SELECT
            to_char(created_at::date,'DD-Mon-YYYY') AS created_at,
            COUNT(*) AS total_orders,
            SUM(total_amt) AS all_total_amount
          FROM tbl_orders
          WHERE zodu_id = $1
            AND branch_id = $2
            AND final_payment = true
            AND created_at::date BETWEEN $3 AND $4
          GROUP BY created_at::date
          ORDER BY created_at::date DESC
          LIMIT $5 OFFSET $6
        `
        : `
          SELECT
            to_char(created_at::date,'DD-Mon-YYYY') AS created_at,
            COUNT(*) AS total_orders,
            SUM(total_amt) AS all_total_amount
          FROM tbl_orders
          WHERE zodu_id = $1
            AND branch_id = $2
            AND final_payment = true
          GROUP BY created_at::date
          ORDER BY created_at::date DESC
          LIMIT $3 OFFSET $4
        `;

      queries.push(
        hasDateFilter
          ? conn.query(datewiseQuery, [zodu_id, branch_id, start_date, end_date, limit, offset])
          : conn.query(datewiseQuery, [zodu_id, branch_id, limit, offset])
      );
    }

    const results = await Promise.all(queries);

    const listRows = results[0].rows;
    const totals = listRows.length
      ? {
          total_count: listRows[0].total_count,
          all_total_amount: listRows[0].all_total_amount,
          all_items_total: listRows[0].all_items_total
        }
      : { total_count: 0, all_total_amount: 0, all_items_total: 0 };

    const rows = listRows.map(
      ({ total_count, all_total_amount, all_items_total, ...r }) => r
    );

    return {
      rows,
      totals,
      datewise_summary: isDateWise ? results[1]?.rows || [] : []
    };
  } catch (err) {
    throw new Error("Unable to fetch report data: " + err.message);
  }
};




exports.get_purchase_report_data = async (zodu_id, branch_id, page = 1, limit = 10, filtered_type, start_date, end_date, year, search = "") => {
  try {
    const offset = (page - 1) * limit;
    const isDateWise = filtered_type === "date_wise";
    const isMonthYearWise = filtered_type === "month_year_wise";

    // ─── month_year_wise: single query with window functions for totals ───
    if (isMonthYearWise) {
      const monthNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
      ];

      if (year && year !== '' && year !== 'null' && year !== 'undefined') {
        // ---- SPECIFIC YEAR: month-wise breakdown (Jan–Dec) ----
        const parsedYear = parseInt(year, 10);
        const params = [zodu_id, branch_id, parsedYear];

        const query = `
          SELECT
            EXTRACT(MONTH FROM p.created_at)::int                   AS month_number,
            COUNT(DISTINCT p.purchase_id)                           AS total_bills,
            COALESCE(SUM(pay.total_amount), 0)                     AS total_amount,
            SUM(COUNT(DISTINCT p.purchase_id)) OVER()              AS total_count,
            COALESCE(SUM(SUM(pay.total_amount)) OVER(), 0)         AS all_total_amount,
            COALESCE(SUM(SUM(pay.paid_amount)) OVER(), 0)          AS all_total_paid,
            COALESCE(SUM(SUM(pay.balance_amount)) OVER(), 0)       AS all_total_due
          FROM tbl_purchase p
          LEFT JOIN tbl_payment pay
            ON pay.source_id   = p.purchase_id
           AND pay.source_type = 'purchase'
           AND pay.branch_id   = p.branch_id
           AND pay.zodu_id     = p.zodu_id
          WHERE p.zodu_id = $1
            AND p.branch_id = $2
            AND EXTRACT(YEAR FROM p.created_at)::int = $3
          GROUP BY month_number
          ORDER BY month_number ASC`;

        const { rows } = await conn.query(query, params);

        const monthMap = {};
        let yearTotalBills = 0;
        let yearTotalAmount = 0;
        const totals = rows.length > 0
          ? { total_count: rows[0].total_count, all_total_amount: rows[0].all_total_amount, all_total_paid: rows[0].all_total_paid, all_total_due: rows[0].all_total_due }
          : { total_count: 0, all_total_amount: 0, all_total_paid: 0, all_total_due: 0 };

        for (const row of rows) {
          monthMap[row.month_number] = row;
          yearTotalBills += Number(row.total_bills);
          yearTotalAmount += Number(row.total_amount);
        }

        return {
          rows: [],
          totals,
          monthly_summary: [{
            year: parsedYear,
            total_bills: yearTotalBills,
            total_amount: yearTotalAmount,
            months: monthNames.map((name, i) => ({
              month_number: i + 1,
              month: name,
              total_bills: Number(monthMap[i + 1]?.total_bills || 0),
              total_amount: Number(monthMap[i + 1]?.total_amount || 0),
            }))
          }],
        };
      }

      // ---- NO YEAR: all years ascending, each with month-wise breakdown ----
      const params = [zodu_id, branch_id];

      const query = `
        SELECT
          EXTRACT(YEAR FROM p.created_at)::int                    AS year,
          EXTRACT(MONTH FROM p.created_at)::int                   AS month_number,
          COUNT(DISTINCT p.purchase_id)                           AS total_bills,
          COALESCE(SUM(pay.total_amount), 0)                     AS total_amount,
          SUM(COUNT(DISTINCT p.purchase_id)) OVER()              AS total_count,
          COALESCE(SUM(SUM(pay.total_amount)) OVER(), 0)         AS all_total_amount,
          COALESCE(SUM(SUM(pay.paid_amount)) OVER(), 0)          AS all_total_paid,
          COALESCE(SUM(SUM(pay.balance_amount)) OVER(), 0)       AS all_total_due
        FROM tbl_purchase p
        LEFT JOIN tbl_payment pay
          ON pay.source_id   = p.purchase_id
         AND pay.source_type = 'purchase'
         AND pay.branch_id   = p.branch_id
         AND pay.zodu_id     = p.zodu_id
        WHERE p.zodu_id = $1
          AND p.branch_id = $2
        GROUP BY year, month_number
        ORDER BY year ASC, month_number ASC`;

      const { rows } = await conn.query(query, params);

      const yearMap = {};
      const totals = rows.length > 0
        ? { total_count: rows[0].total_count, all_total_amount: rows[0].all_total_amount, all_total_paid: rows[0].all_total_paid, all_total_due: rows[0].all_total_due }
        : { total_count: 0, all_total_amount: 0, all_total_paid: 0, all_total_due: 0 };

      for (const row of rows) {
        const y = row.year;
        if (!yearMap[y]) {
          yearMap[y] = { total_bills: 0, total_amount: 0, months: {} };
        }
        yearMap[y].months[row.month_number] = row;
        yearMap[y].total_bills += Number(row.total_bills);
        yearMap[y].total_amount += Number(row.total_amount);
      }

      return {
        rows: [],
        totals,
        monthly_summary: Object.keys(yearMap)
          .sort((a, b) => a - b)
          .map(y => ({
            year: Number(y),
            total_bills: yearMap[y].total_bills,
            total_amount: yearMap[y].total_amount,
            months: monthNames.map((name, i) => ({
              month_number: i + 1,
              month: name,
              total_bills: Number(yearMap[y].months[i + 1]?.total_bills || 0),
              total_amount: Number(yearMap[y].months[i + 1]?.total_amount || 0),
            }))
          })),
      };
    }

    /* =====================================================
       ALL PURCHASES / DATE WISE — CTE to scan table once
       Support optional start/end date and `search` filter. If start/end
       are not provided the queries return data for all time.
    ===================================================== */
    const hasDateFilter =
      start_date &&
      end_date &&
      start_date !== "" &&
      end_date !== "" &&
      start_date !== "null" &&
      end_date !== "null";

    let whereClauses = [];
    const baseParams = [zodu_id, branch_id];

    if (hasDateFilter) {
      whereClauses.push(
        `p.created_at::date BETWEEN $${baseParams.length + 1} AND $${baseParams.length + 2}`
      );
      baseParams.push(start_date, end_date);
    }

    if (search && search.trim() !== "") {
      whereClauses.push(
        `(
          p.purchase_id::text ILIKE $${baseParams.length + 1}
          OR v.vendor_name ILIKE $${baseParams.length + 1}
        )`
      );
      baseParams.push(`%${search}%`);
    }

    const whereSQL = whereClauses.length ? `AND ${whereClauses.join(" AND ")}` : "";

    const limitIdx = `$${baseParams.length + 1}`;
    const offsetIdx = `$${baseParams.length + 2}`;

    const cteQuery = `
      WITH purchase_base AS (
        SELECT p.purchase_id, p.vendor_id, p.created_at, p.zodu_id, p.branch_id, COALESCE(v.vendor_name,'') AS vendor_name
        FROM tbl_purchase p
        LEFT JOIN tbl_vendor v
          ON v.vendor_id = p.vendor_id
         AND v.branch_id = p.branch_id
         AND v.zodu_id = p.zodu_id
        WHERE p.zodu_id = $1
          AND p.branch_id = $2
          ${whereSQL}
      ),
      -- aggregate payments per purchase to avoid multiplicative joins when multiple payments exist
      payment_agg AS (
        SELECT source_id,
               COALESCE(SUM(total_amount),0) AS total_amount,
               COALESCE(SUM(paid_amount),0) AS paid_amount,
               COALESCE(SUM(balance_amount),0) AS balance_amount
        FROM tbl_payment
        WHERE source_type = 'purchase'
        GROUP BY source_id
      ),
      totals AS (
        SELECT
          COUNT(*)                            AS total_count,
          COALESCE(SUM(pagg.total_amount), 0)  AS all_total_amount,
          COALESCE(SUM(pagg.paid_amount), 0)   AS all_total_paid,
          COALESCE(SUM(pagg.balance_amount), 0) AS all_total_due
        FROM purchase_base pb
        LEFT JOIN payment_agg pagg
          ON pagg.source_id = pb.purchase_id
      )
      SELECT
        pb.purchase_id,
        to_char(pb.created_at, 'DD-Mon-YYYY HH12:MI AM (Dy)') AS created_at,
        pb.vendor_name AS vendor_name,
        COALESCE(pagg.total_amount, 0)  AS total_amount,
        COALESCE(pagg.paid_amount, 0)   AS paid_amount,
        COALESCE(pagg.balance_amount, 0) AS balance_amount,
        cat.name,
        cat.category_id AS category_id,
        t.total_count,
        t.all_total_amount,
        t.all_total_paid,
        t.all_total_due
      FROM purchase_base pb
      -- pick a single category (first) using LATERAL to avoid multiple rows per purchase
      LEFT JOIN LATERAL (
        SELECT c.name, c.id AS category_id
        FROM tbl_purchase_items pi
        JOIN tbl_category c ON c.id = pi.category_id
        WHERE pi.purchase_id = pb.purchase_id
        LIMIT 1
      ) cat ON true
      LEFT JOIN payment_agg pagg
        ON pagg.source_id = pb.purchase_id
      CROSS JOIN totals t
      ORDER BY pb.created_at DESC
      LIMIT ${limitIdx} OFFSET ${offsetIdx}`;

    const queries = [conn.query(cteQuery, [...baseParams, limit, offset])];

    if (isDateWise) {
      const datewiseQuery = `
        SELECT
          to_char(p.created_at::date, 'DD-Mon-YYYY') AS created_at,
          COUNT(DISTINCT p.purchase_id)               AS total_purchases,
          COALESCE(SUM(pay.total_amount), 0)          AS all_total_amount
        FROM tbl_purchase p
        LEFT JOIN tbl_payment pay
          ON pay.source_id   = p.purchase_id
         AND pay.source_type = 'purchase'
         AND pay.branch_id   = p.branch_id
         AND pay.zodu_id     = p.zodu_id
        LEFT JOIN tbl_vendor v
          ON v.vendor_id = p.vendor_id
         AND v.branch_id = p.branch_id
         AND v.zodu_id = p.zodu_id
        WHERE p.zodu_id = $1
          AND p.branch_id = $2
          ${whereSQL}
        GROUP BY p.created_at::date
        ORDER BY p.created_at::date DESC
        LIMIT $${baseParams.length + 1} OFFSET $${baseParams.length + 2}`;

      queries.push(conn.query(datewiseQuery, [...baseParams, limit, offset]));
    }

    const results = await Promise.all(queries);

    const listRows = results[0].rows;
    const totals = listRows.length > 0
      ? { total_count: listRows[0].total_count, all_total_amount: listRows[0].all_total_amount, all_total_paid: listRows[0].all_total_paid, all_total_due: listRows[0].all_total_due }
      : { total_count: 0, all_total_amount: 0, all_total_paid: 0, all_total_due: 0 };

    const rows = listRows.map(({ total_count, all_total_amount, all_total_paid, all_total_due, ...row }) => row);

    return {
      rows,
      totals,
      datewise_summary: isDateWise ? results[1].rows : []
    };
  } catch (err) {
    throw new Error("Unable to fetch purchase report data: " + err.message);
  }
};

exports.get_expense_report = async (
  zodu_id,
  branch_id,
  page = 1,
  limit = 10,
  filtered_type = "all_expenses",
  start_date,
  end_date,
  year,
  search = ""
) => {
  try {
    const offset = (page - 1) * limit;
    const isDateWise = filtered_type === "date_wise";
    const isMonthYearWise = filtered_type === "month_year_wise";

    const hasDateFilter =
      start_date &&
      end_date &&
      start_date !== "" &&
      end_date !== "" &&
      start_date !== "null" &&
      end_date !== "null";
    const getOverallSummary = async (extraWhere = "", params = []) => {
      const summaryQuery = `
        SELECT
          COUNT(DISTINCT e.expense_id)        AS "totalBills",
          COALESCE(SUM(i.total),0)            AS "totalAmount",
          COALESCE(SUM(p.paid_amount),0)      AS "totalPaid",
          COALESCE(SUM(p.balance_amount),0)   AS "totalUnpaid",
          COUNT(i.id)                         AS "totalItems"
        FROM tbl_expense e
        LEFT JOIN tbl_expense_items i
          ON i.expense_id = e.expense_id
        LEFT JOIN tbl_payment p
          ON p.source_id = e.expense_id
         AND p.source_type = 'expense'
        WHERE e.zodu_id = $1
          AND e.branch_id = $2
          ${extraWhere}
      `;

      const { rows } = await conn.query(summaryQuery, params);
      return rows[0];
    };
    if (isDateWise) {
      let whereClauses = [];
      const params = [zodu_id, branch_id];

      if (hasDateFilter) {
        whereClauses.push(
          `e.expense_date BETWEEN $${params.length + 1} AND $${params.length + 2}`
        );
        params.push(start_date, end_date);
      }

      if (search && search.trim() !== "") {
        whereClauses.push(
          `(
            e.expense_id::text ILIKE $${params.length + 1}
            OR c.category_name ILIKE $${params.length + 1}
          )`
        );
        params.push(`%${search}%`);
      }

      const whereSQL = whereClauses.length ? `AND ${whereClauses.join(" AND ")}` : "";
      const limitIdx = `$${params.length + 1}`;
      const offsetIdx = `$${params.length + 2}`;

      const dateWiseQuery = `
        SELECT
          to_char(e.expense_date,'DD-Mon-YYYY') AS created_at,
          COUNT(DISTINCT e.expense_id)          AS total_expense,
          COALESCE(SUM(i.total),0)              AS all_total_amount
        FROM tbl_expense e
        LEFT JOIN tbl_expense_items i
          ON i.expense_id = e.expense_id
        LEFT JOIN tbl_expense_category c
          ON c.id = e.category_id
        WHERE e.zodu_id = $1
          AND e.branch_id = $2
          ${whereSQL}
        GROUP BY e.expense_date
        ORDER BY e.expense_date DESC
        LIMIT ${limitIdx} OFFSET ${offsetIdx}
      `;
      
      const countQuery = `
        SELECT COUNT(*) AS total_records
        FROM (
          SELECT expense_date
          FROM tbl_expense e
          LEFT JOIN tbl_expense_category c
            ON c.id = e.category_id
          WHERE e.zodu_id = $1
            AND e.branch_id = $2
            ${whereSQL}
          GROUP BY expense_date
        ) t
      `;
      
      const overallWhereSQL = hasDateFilter
        ? `AND e.expense_date BETWEEN $${[zodu_id, branch_id].length + 1} AND $${[zodu_id, branch_id].length + 2}`
        : "";
      const overallParams = hasDateFilter
        ? [zodu_id, branch_id, start_date, end_date]
        : [zodu_id, branch_id];

      const [dateRes, countRes, overall_summary] = await Promise.all([
        conn.query(dateWiseQuery, [...params, limit, offset]),
        conn.query(countQuery, [...params]),
        getOverallSummary(overallWhereSQL, overallParams)
      ]);
      const totalRecords = Number(countRes.rows[0].total_records);
      const totalPages = Math.ceil(totalRecords / limit);
      return {
        rows: [],
        datewise_summary: dateRes.rows,
        overall_summary,
        pagination: {
          page,
          limit,
          totalRecords,
          totalPages
        }
      };
    }
    if (isMonthYearWise) {
      const monthNames = [
        "January","February","March","April","May","June",
        "July","August","September","October","November","December"
      ];
      if (year) {
        const parsedYear = parseInt(year, 10);
        const params = [zodu_id, branch_id, parsedYear];
        const monthlyQuery = `
          SELECT
            EXTRACT(MONTH FROM e.expense_date)::int AS month_number,
            COUNT(DISTINCT e.expense_id)            AS total_bills,
            COALESCE(SUM(i.total), 0)               AS total_amount
          FROM tbl_expense e
          LEFT JOIN tbl_expense_items i
            ON i.expense_id = e.expense_id
          WHERE e.zodu_id = $1
            AND e.branch_id = $2
            AND EXTRACT(YEAR FROM e.expense_date)::int = $3
          GROUP BY month_number
          ORDER BY month_number
        `;
        const [monthRes, overall_summary] = await Promise.all([
          conn.query(monthlyQuery, params),
          getOverallSummary(
            "AND EXTRACT(YEAR FROM e.expense_date)::int = $3",
            params
          )
        ]);
        const map = {};
        let yearTotalBills = 0;
        let yearTotalAmount = 0;
        monthRes.rows.forEach(r => {
          map[r.month_number] = r;
          yearTotalBills += Number(r.total_bills);
          yearTotalAmount += Number(r.total_amount);
        });

        return {
          rows: [],
          monthly_summary: [{
            year: parsedYear,
            total_bills: yearTotalBills,
            total_amount: yearTotalAmount,
            months: monthNames.map((m, i) => ({
              month_number: i + 1,
              month: m,
              total_bills: Number(map[i + 1]?.total_bills || 0),
              total_amount: Number(map[i + 1]?.total_amount || 0)
            }))
          }],
          overall_summary
        };
      }
      const params = [zodu_id, branch_id];
      const allYearMonthQuery = `
        SELECT
          EXTRACT(YEAR FROM e.expense_date)::int  AS year,
          EXTRACT(MONTH FROM e.expense_date)::int AS month_number,
          COUNT(DISTINCT e.expense_id)            AS total_bills,
          COALESCE(SUM(i.total), 0)               AS total_amount
        FROM tbl_expense e
        LEFT JOIN tbl_expense_items i
          ON i.expense_id = e.expense_id
        WHERE e.zodu_id = $1
          AND e.branch_id = $2
        GROUP BY year, month_number
        ORDER BY year ASC, month_number ASC
      `;
      const [dataRes, overall_summary] = await Promise.all([
        conn.query(allYearMonthQuery, params),
        getOverallSummary("", params)
      ]);
      const yearMap = {};
      dataRes.rows.forEach(r => {
        const y = r.year;
        if (!yearMap[y]) {
          yearMap[y] = { total_bills: 0, total_amount: 0, months: {} };
        }
        yearMap[y].months[r.month_number] = r;
        yearMap[y].total_bills += Number(r.total_bills);
        yearMap[y].total_amount += Number(r.total_amount);
      });
      return {
        rows: [],
        monthly_summary: Object.keys(yearMap)
          .sort((a, b) => a - b)
          .map(y => ({
            year: Number(y),
            total_bills: yearMap[y].total_bills,
            total_amount: yearMap[y].total_amount,
            months: monthNames.map((m, i) => ({
              month_number: i + 1,
              month: m,
              total_bills: Number(yearMap[y].months[i + 1]?.total_bills || 0),
              total_amount: Number(yearMap[y].months[i + 1]?.total_amount || 0)
            }))
          })),
        overall_summary
      };
    }
    const params = [zodu_id, branch_id];
    
    let whereClauses = [];

    // Date filter for ALL EXPENSES
    if (hasDateFilter) {
      whereClauses.push(
        `e.expense_date BETWEEN $${params.length + 1} AND $${params.length + 2}`
      );
      params.push(start_date, end_date);
    }

    // Search filter
    if (search && search.trim() !== "") {
      whereClauses.push(
        `(
          e.expense_id::text ILIKE $${params.length + 1}
          OR c.category_name ILIKE $${params.length + 1}
        )`
      );
      params.push(`%${search}%`);
    }

    const whereSQL = whereClauses.length ? `AND ${whereClauses.join(" AND ")}` : "";

    const listQuery = `
      SELECT
        to_char(e.created_at,'DD-Mon-YYYY HH12:MI AM (Dy)') AS expense_date,
        e.expense_id,
        c.category_name,
        COALESCE(SUM(i.total),0)             AS total_amount,
        COALESCE(p.paid_amount,0)            AS paid_amount,
        COALESCE(p.balance_amount,0)         AS due_amount
      FROM tbl_expense e
      LEFT JOIN tbl_expense_items i
        ON i.expense_id = e.expense_id
      LEFT JOIN tbl_expense_category c
        ON c.id = e.category_id
      LEFT JOIN tbl_payment p
        ON p.source_id = e.expense_id
       AND p.source_type = 'expense'
      WHERE e.zodu_id = $1
        AND e.branch_id = $2
        ${whereSQL}
      GROUP BY
        e.expense_id,
        e.expense_date,
        c.category_name,
        p.paid_amount,
        p.balance_amount
      ORDER BY e.expense_date DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const countQuery = `
      SELECT COUNT(DISTINCT expense_id) AS total_records
      FROM tbl_expense e
      LEFT JOIN tbl_expense_category c
        ON c.id = e.category_id
      WHERE e.zodu_id = $1
        AND e.branch_id = $2
        ${whereSQL}
    `;

    const [listRes, countRes, overall_summary] = await Promise.all([
      conn.query(listQuery, [...params, limit, offset]),
      conn.query(countQuery, params),
      getOverallSummary(
        hasDateFilter ? `AND e.expense_date BETWEEN $3 AND $4` : "",
        hasDateFilter ? [zodu_id, branch_id, start_date, end_date] : [zodu_id, branch_id]
      )
    ]);

    const totalRecords = Number(countRes.rows[0].total_records);
    const totalPages = Math.ceil(totalRecords / limit);

    return {
      rows: listRes.rows,
      overall_summary,
      pagination: {
        page,
        limit,
        totalRecords,
        totalPages
      }
    };

  } catch (err) {
    throw new Error("Expense report error: " + err.message);
  }
};

exports.get_category_item_wise_report = async (
  zodu_id,
  branch_id,
  page = 1,
  limit = 10,
  search = ""
) => {
  try {
    const offset = (page - 1) * limit;

    const params = [zodu_id, branch_id];
    let searchFilter = "";

    if (search && search.trim() !== "") {
      params.push(`%${search}%`);
      searchFilter = `
        AND (
          c.name ILIKE $3
          OR oi.item_name ILIKE $3
        )
      `;
    }
    const countQuery = `
      SELECT COUNT(DISTINCT c.id)::int AS total_count
      FROM tbl_ordered_items oi
      JOIN tbl_menu_item mi
        ON mi.menu_id = oi.item_id
       AND mi.zodu_id = oi.zodu_id
       AND mi.branch_id = oi.branch_id
      JOIN tbl_category c
        ON c.id = mi.menu_category_id
      WHERE oi.zodu_id = $1
        AND oi.branch_id = $2
        ${searchFilter}
    `;
    const dataQuery = `
      WITH aggregated AS (
        SELECT
          c.id            AS category_id,
          c.name          AS category_name,
          mi.menu_id      AS item_id,
          oi.item_name,
          SUM(oi.qty)::numeric(10,2) AS total_qty,
          SUM(oi.total_amount)::numeric(10,2) AS total_amount
        FROM tbl_ordered_items oi
        JOIN tbl_menu_item mi
          ON mi.menu_id = oi.item_id
         AND mi.zodu_id = oi.zodu_id
         AND mi.branch_id = oi.branch_id
        JOIN tbl_category c
          ON c.id = mi.menu_category_id
        WHERE oi.zodu_id = $1
          AND oi.branch_id = $2
          ${searchFilter}
        GROUP BY
          c.id, c.name,
          mi.menu_id,
          oi.item_name
      ),
      paged_categories AS (
        SELECT DISTINCT category_id, category_name
        FROM aggregated
        ORDER BY category_name
        LIMIT $${params.length + 1}
        OFFSET $${params.length + 2}
      )
      SELECT a.*
      FROM aggregated a
      JOIN paged_categories pc
        ON pc.category_id = a.category_id
      ORDER BY
        a.category_name ASC,
        a.item_name ASC
    `;
    const summaryQuery = `
      SELECT
        COUNT(DISTINCT oi.api_order_id)::int AS total_orders,
        COALESCE(SUM(oi.qty),0)::numeric AS total_qty,
        COALESCE(SUM(oi.total_amount),0)::numeric AS total_amount
      FROM tbl_ordered_items oi
      JOIN tbl_menu_item mi
        ON mi.menu_id = oi.item_id
       AND mi.zodu_id = oi.zodu_id
       AND mi.branch_id = oi.branch_id
      JOIN tbl_category c
        ON c.id = mi.menu_category_id
      WHERE oi.zodu_id = $1
        AND oi.branch_id = $2
        ${searchFilter}
    `;

    const [countRes, dataRes, summaryRes] = await Promise.all([
      conn.query(countQuery, params),
      conn.query(dataQuery, [...params, limit, offset]),
      conn.query(summaryQuery, params)
    ]);

    /* ============================
       TRANSFORM → ACCORDION
    ============================ */

    const categoryMap = {};

    for (const row of dataRes.rows) {
      if (!categoryMap[row.category_id]) {
        categoryMap[row.category_id] = {
          category_id: row.category_id,
          category_name: row.category_name,
          total_qty: 0,
          total_amount: 0,
          items: []
        };
      }

      categoryMap[row.category_id].total_qty += Number(row.total_qty);
      categoryMap[row.category_id].total_amount += Number(row.total_amount);

      categoryMap[row.category_id].items.push({
        item_id: row.item_id,
        item_name: row.item_name,
        total_qty: Number(row.total_qty),
        total_amount: Number(row.total_amount)
      });
    }

    const totalRecords = Number(countRes.rows[0].total_count);
    const totalPages = Math.ceil(totalRecords / limit);

    return {
      overall_summary: {
        total_orders: Number(summaryRes.rows[0].total_orders),
        total_qty: Number(summaryRes.rows[0].total_qty),
        total_amount: Number(summaryRes.rows[0].total_amount)
      },
      rows: Object.values(categoryMap),
      pagination: {
        page,
        limit,
        totalRecords,
        totalPages
      }
    };
  } catch (err) {
    throw new Error(
      "Unable to fetch category/item wise report: " + err.message
    );
  }
};







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
    if (updatedMenu.menu_type && updatedMenu.menu_type.toLowerCase() === "product") {      
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
    // normalize inventory type
    const inventoryType =
      !type || type === "null" || type === "undefined"
        ? null
        : type;


    // normalize category
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
  LEFT JOIN tbl_category c 
    ON i.category_id = c.id
  LEFT JOIN tbl_menu_item m 
    ON i.item_id = m.menu_id
  LEFT JOIN tbl_units u 
    ON i.item_unit = u.id
  WHERE i.branch_id = $1
    AND ($2::text IS NULL OR i.inventory_type = $2::text)
    AND ($3::int IS NULL OR i.category_id::int = $3::int)
  ORDER BY i.created_at DESC;
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

  AND (($5 = '' AND $6 = '') OR (p.purchase_date BETWEEN $5::date AND $6::date))

  ORDER BY p.created_at DESC
  LIMIT $7 OFFSET $8
),

pay_join AS (
  SELECT
    p.*,
    COALESCE(pay.total_amount, 0) AS total_amount,
    COALESCE(pay.paid_amount, 0)  AS paid_amount,
    (COALESCE(pay.total_amount,0) - COALESCE(pay.paid_amount,0)) AS balance_amount,
    pay.payment_id
  FROM filtered_purchase p
  LEFT JOIN tbl_payment pay
    ON pay.source_type = 'purchase'
   AND pay.source_id   = p.purchase_id
   AND pay.branch_id   = p.branch_id
   AND pay.zodu_id     = p.zodu_id
),

status_filtered AS (
  SELECT *
  FROM pay_join
  WHERE
    $4 = 'all'
    OR ($4 = 'paid'   AND balance_amount = 0)
    OR ($4 = 'unpaid' AND balance_amount > 0)
),

purchase_data AS (
  SELECT
    pj.purchase_id,
    pj.branch_id,
    pj.vendor_id,
    pj.purchase_date,
    pj.purchase_type,

    pj.total_amount,
    pj.paid_amount,
    pj.balance_amount,
    pj.payment_id,

    pj.notes,
    pj.attachment_url,
    pj.created_at,
    pj.updated_at,

    v.vendor_name,
    v.vendor_phone,
    v.vendor_email,
    v.company_name,

    COALESCE(
      JSON_AGG(
        JSON_BUILD_OBJECT(
          'item_id', pi.item_id,
          'item_name', pi.item_name,
          'quantity', pi.qty,
          'unit_id', pi.unit,
          'unit', u.short_name,
          'price', pi.purchase_price,
          'total', pi.total_price,
          'category', c.name,
          'category_id', pi.category_id
        )
      ) FILTER (WHERE pi.purchase_id IS NOT NULL),
      '[]'
    ) AS items,

    COALESCE(
      (
        SELECT JSON_AGG(
          JSON_BUILD_OBJECT(
            'payment_id', ph.transaction_id,
            'paid_amount', ph.paid_amount,
            'payment_mode', ph.payment_mode,
            'paid_date', ph.paid_date,
            'created_at', TO_CHAR(ph.created_at,'DD-MON-YYYY HH12:MI AM')
          )
          ORDER BY ph.created_at DESC
        )
        FROM tbl_payment_history ph
        WHERE ph.payment_id = pj.payment_id
      ),
      '[]'
    ) AS payment_history

  FROM status_filtered pj
  LEFT JOIN tbl_purchase_items pi ON pj.purchase_id = pi.purchase_id
  LEFT JOIN tbl_category c       ON pi.category_id = c.id
  LEFT JOIN tbl_units u ON pi.unit = u.id
  LEFT JOIN tbl_vendor v         ON pj.vendor_id   = v.vendor_id
  GROUP BY
    pj.purchase_id, pj.branch_id, pj.vendor_id,
    pj.purchase_date, pj.purchase_type,
    pj.total_amount, pj.paid_amount, pj.balance_amount,
    pj.payment_id, pj.notes, pj.attachment_url,
    pj.created_at, pj.updated_at,
    v.vendor_name, v.vendor_phone,
    v.vendor_email, v.company_name
)

SELECT
  JSON_AGG(purchase_data) AS purchases,
  COUNT(*) OVER()        AS total_purchase_count,
  SUM(paid_amount)       AS total_paid_amount,
  SUM(balance_amount)    AS total_unpaid_amount,

  SUM(CASE WHEN DATE_TRUNC('month', purchase_date)=DATE_TRUNC('month',CURRENT_DATE)
           THEN paid_amount ELSE 0 END) AS this_month_spent,

  SUM(CASE WHEN DATE_TRUNC('month', purchase_date)
           = DATE_TRUNC('month',CURRENT_DATE - INTERVAL '1 month')
           THEN paid_amount ELSE 0 END) AS last_month_spent

FROM purchase_data;

`;

    const result = await conn.query(query, [
      branch_id,   // $1
      search,      // $2
      category_id, // $3
      status,   
      start_date,  // $4
      end_date,    // $5
      limit,       // $6  <-- IMPORTANT
      offset       // $7  <-- IMPORTANT
    ]);

    return result.rows[0];

  } catch (err) {
    throw new Error("Unable to fetch purchase data: " + err.message);
  }
};




exports.get_Expense = async ({
  branch_id,
  page = 1,
  limit = 10,
  search = "",
  filter = "All",   // "All" | "Paid" | "Unpaid"
  start_date,
  end_date,
  category_id
}) => {
  try {
    const offset = (page - 1) * limit;
    const searchQuery = `%${search}%`;

    const query = `
 WITH filtered_expenses AS (
    SELECT DISTINCT e.expense_id
    FROM tbl_expense e
    LEFT JOIN tbl_expense_items ei ON e.expense_id = ei.expense_id
    LEFT JOIN tbl_expense_category c ON e.category_id = c.id
    LEFT JOIN tbl_payment pay
      ON pay.source_type = 'expense'
     AND pay.source_id   = e.expense_id
     AND pay.branch_id   = e.branch_id
     AND pay.zodu_id     = e.zodu_id
    WHERE e.branch_id = $1
      AND (
            c.category_name ILIKE $2
         OR e.description   ILIKE $2
         OR ei.item_name    ILIKE $2
         OR e.expense_id::text ILIKE $2
      )
      ${category_id ? `AND e.category_id = ${category_id}` : ``}
      ${start_date && end_date ? `AND e.expense_date BETWEEN '${start_date}' AND '${end_date}'` : ``}
      AND (
            LOWER($3) = 'all'
         OR (LOWER($3) = 'paid'   AND (COALESCE(pay.total_amount,0) - COALESCE(pay.paid_amount,0)) = 0)
         OR (LOWER($3) = 'unpaid' AND (COALESCE(pay.total_amount,0) - COALESCE(pay.paid_amount,0)) > 0)
      )
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
        e.created_at,
        e.updated_at,

        COALESCE(pay.total_amount,0) AS total_amount,
        COALESCE(pay.paid_amount,0)  AS paid_amount,
        (COALESCE(pay.total_amount,0) - COALESCE(pay.paid_amount,0)) AS balance_amount,

        COALESCE(
            JSON_AGG(
                JSON_BUILD_OBJECT(
                    'item_id', ei.item_id,
                    'item_name', ei.item_name,
                    'quantity', ei.qty,
                    'price', ei.price
                )
            ) FILTER (WHERE ei.expense_id IS NOT NULL), '[]'
        ) AS items,

        (
            SELECT COALESCE(
                JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'payment_id', ph.transaction_id,
                        'paid_amount', ph.paid_amount,
                        'payment_type', ph.payment_mode,
                        'created_at', ph.created_at
                    )
                ), '[]'
            )
            FROM tbl_payment_history ph
            JOIN tbl_payment p2 ON p2.payment_id = ph.payment_id
            WHERE p2.source_type = 'expense'
              AND p2.source_id   = e.expense_id
        ) AS payment_history

    FROM filtered_expenses fe
    JOIN tbl_expense e ON fe.expense_id = e.expense_id
    LEFT JOIN tbl_expense_items ei ON e.expense_id = ei.expense_id
    LEFT JOIN tbl_expense_category c ON e.category_id = c.id
    LEFT JOIN tbl_payment pay
      ON pay.source_type = 'expense'
     AND pay.source_id   = e.expense_id
     AND pay.branch_id   = e.branch_id
     AND pay.zodu_id     = e.zodu_id
    GROUP BY
        e.expense_id, e.category_id, c.category_name,
        pay.total_amount, pay.paid_amount,
        e.attachment_url, e.description,
        e.expense_date, e.payment_type,
        e.created_at, e.updated_at
    ORDER BY e.expense_date DESC
    LIMIT ${limit} OFFSET ${offset}
)

SELECT
    (SELECT JSON_AGG(ed) FROM expense_data ed) AS expenses,
    (SELECT count FROM total_count) AS total_count,

    -- total expense
    (SELECT COALESCE(SUM(pay.total_amount),0)
     FROM tbl_payment pay
     WHERE pay.source_type='expense'
       AND pay.branch_id=$1) AS total_expense,

    -- total paid
    (SELECT COALESCE(SUM(pay.paid_amount),0)
     FROM tbl_payment pay
     WHERE pay.source_type='expense'
       AND pay.branch_id=$1) AS total_paid_all,

    -- unpaid
    (SELECT COALESCE(SUM(pay.total_amount - COALESCE(pay.paid_amount,0)),0)
     FROM tbl_payment pay
     WHERE pay.source_type='expense'
       AND pay.branch_id=$1) AS total_unpaid_all,

    -- this month
    (SELECT COALESCE(SUM(ph.paid_amount),0)
     FROM tbl_payment_history ph
     JOIN tbl_payment pay ON pay.payment_id = ph.payment_id
     WHERE pay.source_type='expense'
       AND pay.branch_id=$1
       AND DATE_TRUNC('month', ph.created_at) = DATE_TRUNC('month', CURRENT_DATE)
    ) AS this_month_expense,

    -- last month
    (SELECT COALESCE(SUM(ph.paid_amount),0)
     FROM tbl_payment_history ph
     JOIN tbl_payment pay ON pay.payment_id = ph.payment_id
     WHERE pay.source_type='expense'
       AND pay.branch_id=$1
       AND DATE_TRUNC('month', ph.created_at) = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
    ) AS last_month_expense;

    `;

    const result = await conn.query(query, [
      branch_id,      // $1
      searchQuery,    // $2
      filter          // $3
    ]);

    return {
      expenses: result.rows[0].expenses || [],
      total_count: result.rows[0].total_count || 0,
      summary: {
        total_expense: result.rows[0].total_paid_all || 0,
        total_paid: result.rows[0].total_paid_all || 0,
        total_unpaid: result.rows[0].total_unpaid_all || 0,
        this_month: result.rows[0].this_month_expense || 0,
        last_month: result.rows[0].last_month_expense || 0
      },
      page,
      limit
    };
  } catch (err) {
    throw new Error("Unable to fetch expense data: " + err.message);
  }
};





exports.getUnits = async (branch_id, zodu_id) => {
  try {
    const query = `
      SELECT id, zodu_id, branch_id, name, short_name, created_at, updated_at
      FROM tbl_units
      WHERE branch_id = $1 AND zodu_id = $2
      ORDER BY id DESC
    `;
    const { rows } = await conn.query(query, [branch_id, zodu_id]);
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


exports.getGST = async (branch_id, zodu_id) => {
  try {
    const query = `
      SELECT * FROM tbl_gst
      WHERE branch_id = $1 AND zodu_id = $2
      ORDER BY id DESC
    `;
    const { rows } = await conn.query(query, [branch_id, zodu_id]);
    return rows;
  } catch (err) {
    throw new Error("Database error while fetching GST list");
  }
};

// Default units + GST rates for a new branch — both multi-row inserts run
// inside seed_branch_defaults() on the DB side (see
// migrations/branch_default_units_gst.sql); this is just the one call that
// invokes it.
exports.seedDefaultsForBranch = async (zodu_id, branch_id) => {
  await conn.query('SELECT seed_branch_defaults($1, $2)', [zodu_id, branch_id]);
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

exports.get_pos_data = async (branch_id, zodu_id) => {
  return await conn.query(
    `
    SELECT
      p.zodu_id,
      p.branch_id,

      p.item_id,
      p.item_uuid,
      p.item_name,

      p.category_id,
      c.name AS category_name,
      p.description,

      p.sku,
      p.barcode,

      p.sell_price,
      p.purchase_price,
      p.mrp,
      p.hsn_code,
      g.gst_rate AS gst_tax,
      p.tax_incl_type AS tax_inclusive,
      p.unit AS unit_id,
      u.short_name AS unit,

      COALESCE(i.available_qty, 0) AS stock_qty,

      1 AS count,
      p.item_type

    FROM tbl_menu_items p

    LEFT JOIN tbl_category c
      ON c.id = p.category_id

    LEFT JOIN tbl_gst g
      ON g.id = p.gst_type

    LEFT JOIN tbl_units u
      ON u.id = p.unit

    LEFT JOIN tbl_inventory i
      ON i.item_uuid = p.item_uuid
      AND i.branch_id = p.branch_id

    WHERE
      p.status = 'active'
      AND p.branch_id = $1
      AND p.zodu_id =$2

    ORDER BY p.item_name ASC
    `,
    [branch_id,zodu_id]
  );
};

exports.getCustomers = async (filters) => {
  const {
    zodu_id,
    branch_id,
    search,       // searches cust_name, mobile_no, email_id
    is_active,    // true = active only, false = inactive only, omitted = all
    page  = 1,
    limit = 20,
  } = filters;

  const offset = (page - 1) * limit;
  const params = [zodu_id, branch_id];
  let   whereClause = `WHERE zodu_id = $1 AND branch_id = $2`;

  if (is_active !== undefined) {
    params.push(is_active);
    whereClause += ` AND is_active = $${params.length}`;
  }

  if (search) {
    params.push(`%${search}%`);
    const idx = params.length;
    whereClause += `
      AND (
        cust_name ILIKE $${idx}
        OR cpy_name ILIKE $${idx}
        OR mobile_no::text ILIKE $${idx}
        OR email_id::text ILIKE $${idx}
      )`;
  }
 
  // total count
  const countResult = await conn.query(
    `SELECT COUNT(*) FROM tbl_customer ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count, 10);
 
  // paginated rows
  params.push(limit, offset);
  const dataResult = await conn.query(
    `SELECT
        cust_uuid, cust_id,
        cust_name, cpy_name,
        mobile_no, email_id,
        gst,
        address_line1, address_line2,
        city, state, pincode,
        is_active,
        created_at,
        shipping_address, same_as_billing_address,
        COALESCE((
          SELECT SUM(s.total_amount)
          FROM tbl_sales s
          WHERE s.customer_uuid = tbl_customer.cust_uuid
            AND s.zodu_id       = tbl_customer.zodu_id
            AND s.branch_id     = tbl_customer.branch_id
            AND s.sale_type     = 'S'
        ), 0) AS total_sale,
        COALESCE((
          SELECT COUNT(*)
          FROM tbl_sales s
          WHERE s.customer_uuid = tbl_customer.cust_uuid
            AND s.zodu_id       = tbl_customer.zodu_id
            AND s.branch_id     = tbl_customer.branch_id
            AND s.sale_type     = 'S'
        ), 0) AS total_invoice,
        COALESCE(opening_balance, 0) + COALESCE((
          SELECT SUM(s.balance_amount)
          FROM tbl_sales s
          WHERE s.customer_uuid = tbl_customer.cust_uuid
            AND s.zodu_id       = tbl_customer.zodu_id
            AND s.branch_id     = tbl_customer.branch_id
            AND s.sale_type     = 'S'
        ), 0) AS outstanding_balance
     FROM tbl_customer
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
 
  return {
    total,
    page:       Number(page),
    limit:      Number(limit),
    totalPages: Math.ceil(total / limit),
    customers:  dataResult.rows,
  };
};
 
// ── 2. GET SINGLE CUSTOMER BY UUID ───────────────────────────
exports.getCustomerById = async (cust_uuid) => {
  const result = await conn.query(
    `SELECT
        cust_uuid, cust_id,
        zodu_id, branch_id,
        cust_name, cpy_name,
        mobile_no, email_id,
        gst,
        address_line1, address_line2,
        city, state, pincode,
        is_active,
        created_at
     FROM tbl_customer
     WHERE cust_uuid = $1`,
    [cust_uuid]
  );
  return result.rows[0] ?? null;
};

// ── SOFT DELETE / REACTIVATE CUSTOMER ──────────────────────────
// Sets is_active to whatever the caller passes (default false, i.e. delete)
// instead of removing the row — sale/purchase history keeps referencing the
// same cust_uuid. Same endpoint doubles as "restore" when passed true.
exports.setCustomerActive = async (cust_uuid, is_active = false) => {
  const result = await conn.query(
    `UPDATE tbl_customer
     SET is_active = $2, updated_at = NOW()
     WHERE cust_uuid = $1
     RETURNING cust_uuid, is_active`,
    [cust_uuid, is_active]
  );
  return result.rows[0] ?? null;
};

// ── 3. UPDATE CUSTOMER ──────────────────────────────────────

// Columns eligible for a partial update, keyed by the field name on `data`.
// `serialize` is only needed for columns that don't map 1:1 onto their input value.
const CUSTOMER_UPDATE_FIELDS = {
  cust_name:      {},
  cpy_name:       {},
  mobile_no:      { serialize: (v) => JSON.stringify(Array.isArray(v) ? v : [v]) },
  email_id:       { serialize: (v) => JSON.stringify(Array.isArray(v) ? v : [v]) },
  gst:            {},
  address_line1:  {},
  address_line2:  {},
  city:           {},
  state:          {},
  pincode: {},
  shipping_address: {},
  same_as_billing_address: {},
};

exports.updateCustomer = async (data) => {
  const { cust_uuid } = data;

  const columns = [];
  const values = [];

  for (const [field, { serialize }] of Object.entries(CUSTOMER_UPDATE_FIELDS)) {
    const value = data[field];
    if (value === undefined) continue;

    columns.push(field);
    values.push(serialize ? serialize(value) : value ?? null);
  }

  if (columns.length === 0) {
    throw new Error("No fields to update");
  }

  const setClause = columns
    .map((column, i) => `${column} = $${i + 1}`)
    .concat("updated_at = NOW()")
    .join(", ");

  values.push(cust_uuid);

  const { rows } = await conn.query(
    `UPDATE tbl_customer
        SET ${setClause}
      WHERE cust_uuid = $${values.length}
      RETURNING *`,
    values
  );

  return rows[0] ?? null;
};


exports.get_menuItem_data = async (branch_id, page, limit, search) => {
  const offset = (page - 1) * limit;

  // TOTAL COUNT
  const totalCountResult = await conn.query(
    `
    SELECT COUNT(*) AS total
    FROM tbl_menu_items m
    LEFT JOIN tbl_category c 
      ON c.id = m.category_id
    WHERE m.branch_id = $1
      AND (
        m.item_name ILIKE '%' || $2 || '%'
        OR c.name ILIKE '%' || $2 || '%'
      )
    `,
    [branch_id, search]
  );

  const total_count = Number(totalCountResult.rows[0].total);
  const total_pages = Math.ceil(total_count / limit);

  // DATA QUERY
  const dataResult = await conn.query(
    `
    SELECT
      m.zodu_id,
      m.branch_id,

      m.item_uuid,
      m.item_id,
      m.item_name,

      m.sku,
      m.barcode,

      m.sell_price,
      m.purchase_price,

      m.hsn_code,

      -- GST
      m.gst_type AS gst_id,
      g.gst_rate AS gst_tax,

      -- UNIT
      m.unit AS unit_id,
      u.short_name AS unit_name,

      -- CATEGORY
      c.name AS category,
      m.category_id,

      -- INVENTORY
      COALESCE(i.available_qty, 0) AS stock_qty,
      COALESCE(i.reorder_level, 0) AS stock_alert,

      -- OTHER
      m.status,
      m.item_type,
      m.tax_incl_type,

      1 AS count

    FROM tbl_menu_items m

    LEFT JOIN tbl_category c 
      ON c.id = m.category_id

    LEFT JOIN tbl_gst g 
      ON g.id = m.gst_type

    LEFT JOIN tbl_units u 
      ON u.id = m.unit

    LEFT JOIN tbl_inventory i
      ON i.item_uuid = m.item_uuid
      AND i.branch_id = m.branch_id

    WHERE m.branch_id = $1
      AND (
        m.item_name ILIKE '%' || $2 || '%'
        OR c.name ILIKE '%' || $2 || '%'
      )

    ORDER BY m.created_at DESC
    LIMIT $3 OFFSET $4
    `,
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




exports.findMaxBranchID = async (zodu_id) => {
  return await conn.query(
    'SELECT max(branch_id) FROM tbl_branch WHERE zodu_id = $1', [zodu_id]);
};

exports.createDefaultBranch = async ({ branch_id, zodu_id, qr_code_id, branch_name, branch_mobile_no, branch_mail_id }) => {
  console.log(branch_id, zodu_id, qr_code_id, branch_name, branch_mobile_no, branch_mail_id);
  const { rows } = await conn.query(
    `INSERT INTO tbl_branch
       (branch_id, zodu_id, qr_code_id, branch_name, branch_mobile_no, branch_mail_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [branch_id, zodu_id, qr_code_id, branch_name, branch_mobile_no, branch_mail_id]
  );
  console.log(rows);
  return rows[0] || null;
};

exports.FindExistingData = async (tbl_name, column_name, value) => {
  console.log("repository", tbl_name, column_name, value);
  return await conn.query(
    `SELECT * FROM ${tbl_name} where ${column_name} = $1`, [value]);
}

exports.createBranch = async (branchData) => {
  const client = await conn.connect();
  try {
    await client.query('BEGIN');

    // 1. Insert address
    let address_id = null;
    const branchAddressLine1 = getBranchAddressLine1(branchData);
    const branchAddressLine2 = getBranchAddressLine2(branchData);
    if (branchAddressLine1 || branchAddressLine2 || branchData.branch_city) {
      const addrRes = await client.query(
        `INSERT INTO tbl_address (zodu_id, address_line_1, address_line_2, city, district, state, pincode)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [branchData.zodu_id, branchAddressLine1,
         branchAddressLine2, branchData.branch_city || null,
         branchData.branch_district || null, branchData.branch_state || null,
         branchData.branch_pincode || null]
      );
      address_id = addrRes.rows[0].id;
    }

    // 2. Insert bank_details
    let bank_details_id = null;
    if (branchData.branch_account_no) {
      const bankRes = await client.query(
        `INSERT INTO tbl_bank_details (zodu_id, account_number, account_type, ifsc_code)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [branchData.zodu_id, branchData.branch_account_no,
         branchData.branch_account_type || null, branchData.branch_ifsc || null]
      );
      bank_details_id = bankRes.rows[0].id;
    }

    // 3. Insert branch (branch_manager is the new column name for branch_manager_or_admin)
    const { rows } = await client.query(
      `INSERT INTO tbl_branch
         (branch_id, zodu_id, qr_code_id, branch_name, branch_manager,
          branch_mobile_no, branch_mail_id, branch_image, address_id, bank_details_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [branchData.branch_id, branchData.zodu_id, branchData.qr_code_id, branchData.branch_name,
       branchData.branch_manager || branchData.branch_manager_or_admin || null,
       branchData.branch_mobile_no || null, branchData.branch_mail_id || null,
       branchData.branch_image || null, address_id, bank_details_id]
    );

    if (rows.length === 0) throw new Error('No branch created');

    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw new Error('Unable to create branch: ' + err.message);
  } finally {
    client.release();
  }
};

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

exports.checkCategoryNameExists = async (zodu_id, branch_id, name) => {
  const query = `
    SELECT id, name FROM tbl_category
    WHERE zodu_id = $1 AND branch_id = $2 AND LOWER(name) = LOWER($3)
    LIMIT 1;
  `;
  const result = await conn.query(query, [zodu_id, branch_id, name]);
  return result.rows[0] || null;
};

exports.createCategory = async (zodu_id, branch_id, name, type) => {
  try {
    // 1️⃣ Check if category already exists in this branch
    const checkQuery = `
      SELECT * FROM tbl_category
      WHERE zodu_id = $1 AND branch_id = $2 AND LOWER(name) = LOWER($3)
      LIMIT 1;
    `;
    const checkValues = [zodu_id, branch_id, name];
    const checkResult = await conn.query(checkQuery, checkValues);

    if (checkResult.rows.length > 0) {
      // ✅ Category already exists → return existing
      throw new Error("Category name already exists");
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

exports.updateCategory = async (id, name, type, zodu_id, branch_id) => {
  try {
    // 1️⃣ Check if another category already has this name in this branch
    const checkQuery = `
      SELECT id FROM tbl_category
      WHERE zodu_id = $1 AND branch_id = $2 AND LOWER(name) = LOWER($3) AND id != $4
      LIMIT 1;
    `;
    const checkResult = await conn.query(checkQuery, [zodu_id, branch_id, name, id]);

    if (checkResult.rows.length > 0) {
      throw new Error("Category name already exists");
    }

    // 2️⃣ Otherwise, update the category
    const query = `
      UPDATE tbl_category
      SET name = $1,type = $3,updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND branch_id = $4 AND zodu_id = $5
      RETURNING *;
    `;
    const values = [name, id, type, branch_id, zodu_id];
    const result = await conn.query(query, values);
    return result.rows[0];
  } catch (err) {
    throw new Error("Unable to update category: " + err.message);
  }
}

exports.InactivateCategory = async (id, zodu_id, branch_id, active, page_expense) => {
  try {
    if (active === false) {
      if (!page_expense) {
        const usageRes = await conn.query(
          `SELECT
            EXISTS (SELECT 1 FROM tbl_menu_items WHERE category_id = $1 AND branch_id = $2 AND zodu_id = $3) AS in_menu,
            EXISTS (SELECT 1 FROM tbl_inventory ti JOIN tbl_menu_items ie ON ie.item_id = ti.item_id WHERE ie.category_id = $1 AND ie.branch_id = $2 AND ie.zodu_id = $3) AS in_inventory`,
          [id, branch_id, zodu_id]
        );
        const { in_menu, in_inventory } = usageRes.rows[0];
        if (in_menu) throw new Error("Category cannot be deactivated. This category is used in menu items.");
        if (in_inventory) throw new Error("Category cannot be deactivated. This category is used in inventory items.");
      } else {
        console.log("Checking expense usage for category in branch", active);
        const usageRes = await conn.query(
          `SELECT EXISTS (
            SELECT 1 FROM tbl_expense_items ie
            JOIN tbl_expense e ON e.expense_id = ie.expense_id
            WHERE ie.category_id = $1 AND e.branch_id = $2 AND e.zodu_id = $3
          ) AS in_expense`,
          [id, branch_id, zodu_id]
        );
        if (usageRes.rows[0].in_expense) throw new Error("Category cannot be deactivated. This category is used in expense items.");
      }
    }
    const result = await conn.query(
      `UPDATE tbl_category SET active = $4 WHERE id = $1 AND branch_id = $2 AND zodu_id = $3 RETURNING *`,
      [id, branch_id, zodu_id, active]
    );
    return result.rows[0];
  } catch (err) {
    throw new Error(err.message);
  }
}

exports.deleteCategory = async (id, branch_id, zodu_id, page_expense) => {
  try {
    const isExpensePage = page_expense === true || page_expense === "true";
    console.log("page_expense value:", page_expense);
    if (!isExpensePage) {
      const usageRes = await conn.query(
        `SELECT
          EXISTS (SELECT 1 FROM tbl_menu_items WHERE category_id = $1 AND branch_id = $2 AND zodu_id = $3) AS in_menu,
          EXISTS (SELECT 1 FROM tbl_inventory ti JOIN tbl_menu_items ie ON ie.item_id = ti.item_id WHERE ie.category_id = $1 AND ie.branch_id = $2 AND ie.zodu_id = $3) AS in_inventory`,
        [id, branch_id, zodu_id]
      );
      console.log("Category usage check result:", usageRes.rows[0]);
      const { in_menu, in_inventory } = usageRes.rows[0];
      if (in_menu) throw new Error("Category cannot be deleted. This category is used in menu items.");
      if (in_inventory) throw new Error("Category cannot be deleted. This category is used in inventory items.");
    } else {
      const usageRes = await conn.query(
        `SELECT EXISTS (
          SELECT 1 FROM tbl_expense_items ie
          JOIN tbl_expense e ON e.expense_id = ie.expense_id
          WHERE ie.category_id = $1 AND e.branch_id = $2 AND e.zodu_id = $3
        ) AS in_expense`,
        [id, branch_id, zodu_id]
      );
      console.log("Expense category usage check result:", usageRes.rows[0]);
      if (usageRes.rows[0].in_expense) throw new Error("Category cannot be deleted. This category is used in expense items.");
    }

    await conn.query(
      `DELETE FROM tbl_category WHERE id = $1 AND branch_id = $2 AND zodu_id = $3`,
      [id, branch_id, zodu_id]
    );
    return { success: true, message: "Category deleted successfully" };
  } catch (err) {
    throw new Error(err.message);
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

exports.getNextItemId = async(zoduId, branchId) => {
  const result = await conn.query(
    `SELECT item_id
     FROM tbl_menu_items
     WHERE zodu_id = $1 AND branch_id = $2
     ORDER BY (regexp_replace(item_id, '[^0-9]', '', 'g'))::bigint DESC
     LIMIT 1
     FOR UPDATE`,
    [zoduId, branchId]
  );
 
  let nextNumber = 1;
  if (result.rows.length > 0) {
    const lastId = result.rows[0].item_id;
    const match  = lastId.match(/(\d+)$/);
    nextNumber   = match ? parseInt(match[1], 10) + 1 : 1;
  }
 
  return String(nextNumber).padStart(3, "0");
}

exports.createMenuItem = async (data) => {

 
  const { rows } = await conn.query(
    `INSERT INTO tbl_menu_items (
        item_id, zodu_id, branch_id,
        item_type, item_name,
        category_id, unit,
        mrp, sell_price, purchase_price,
        gst_type, tax_incl_type,
        sku, barcode, hsn_code,
        item_img, status
     ) VALUES (
        $1,$2,$3,
        $4,$5,
        $6,$7,
        $8,$9,$10,
        $11,$12,
        $13,$14,$15,
        $16,$17
     )
     RETURNING *`,
    [
      data.item_id,
      data.zodu_id,
      data.branch_id,
      data.item_type,
      data.item_name,
      data.category_id    ?? null,
      data.unit           ?? null,
      data.mrp            != null ? round(data.mrp)            : null,
      data.sell_price     != null ? round(data.sell_price)     : null,
      data.purchase_price != null ? round(data.purchase_price) : null,
      data.gst_type       ?? null,
      data.tax_incl_type  ?? false,
      data.sku            || null,
      data.barcode        || null,
      data.hsn_code       || null,
      data.item_img       || null,
      data.status         ?? "active",
    ]
  );
 
  return rows[0];
}

exports.updateMenuItem= async (item_uuid, data) => {
  // Build SET clause dynamically from provided fields only
  const fields = [
    "item_name", "item_type", "category_id", "unit",
    "mrp", "sell_price", "purchase_price",
    "gst_type", "tax_incl_type",
    "sku", "barcode", "hsn_code", "item_img", "status",
  ];
 
  const setClauses = [];
  const values     = [];
  let   paramIdx   = 1;
 
  for (const field of fields) {
    if (data[field] === undefined) continue;
 
    let val = data[field];
 
    // Normalise numeric prices
    if (["mrp", "sell_price", "purchase_price"].includes(field) && val != null) {
      val = round(val);
    }
    // Normalise empty strings → null for nullable fields
    if (["sku", "barcode", "hsn_code", "item_img"].includes(field) && val === "") {
      val = null;
    }
 
    setClauses.push(`${field} = $${paramIdx}`);
    values.push(val);
    paramIdx++;
  }
 
  if (setClauses.length === 0) {
    throw new Error("No valid fields to update");
  }
 
  values.push(item_uuid); // last param = WHERE clause
 
  const { rows } = await client.query(
    `UPDATE tbl_menu_items
     SET ${setClauses.join(", ")}
     WHERE item_uuid = $${paramIdx}
     RETURNING *`,
    values
  );
 
  if (rows.length === 0) {
    throw new Error("Menu item not found");
  }
 
  return rows[0];
}

exports.createProduct = async (data) => {
  try {

    const query = `
      INSERT INTO tbl_products(
        zodu_id,
        branch_id,
        item_type,
        item_name,
        category_id,
        sku,
        barcode,
        hsn_code,
        unit,
        mrp,
        sell_price,
        cost_price,
        gst_percentage
      )
      VALUES(
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
      )
      RETURNING *
    `;

    const values = [
      data.zodu_id,
      data.branch_id,
      data.item_type,
      data.item_name,
      data.category_id,
      data.sku,
      data.barcode,
      data.hsn_code,
      data.unit,
      data.mrp,
      data.sell_price,
      data.cost_price,
      data.gst_percentage
    ];

    const result = await conn.query(query, values);

    return result.rows[0];

  } catch (err) {
    throw new Error(err.message);
  }
};

exports.createOrder = async (orderData, client) => {
  const db = client ?? conn;
  const sale_date = orderData.sale_date
    ? new Date(orderData.sale_date).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
 
  // ✅ FIX: was sync, had no branchId/saleType/zoduId — now async + all args
  const sale_id = await this.generateSaleId(
    orderData.branch_id,
    orderData.sale_type,
    orderData.zodu_id,
    db
  );
 
  const result = await db.query(
    `INSERT INTO tbl_sales (
        sale_id, zodu_id, branch_id,
        sale_type,
        customer_uuid,
        total_items, subtotal, total_tax,
        discount_type, discount_value, discount_amount,
        total_amount, paid_amount, balance_amount,
        payment_status, notes, sale_date, sale_time,due_date,round_off,
        discount_gst_mode
     )
     VALUES (
        $1,$2,$3,
        $4,
        $5,
        $6,$7,$8,
        $9,$10,$11,
        $12,$13,$14,
        $15,$16,$17,$18,$19,$20,
        $21
     )
     RETURNING *`,
    [
      sale_id,
      orderData.zodu_id,
      orderData.branch_id,

      orderData.sale_type ?? null,
      orderData.customer_id ?? null,

      orderData.total_items,
      orderData.subtotal,
      orderData.total_tax,

      orderData.discount_type   ?? null,
      Number(orderData.discount_value ?? 0),
      orderData.discount_amount,

      orderData.total_amount,
      orderData.paid_amount,
      orderData.balance_amount,

      orderData.payment_status,
      orderData.notes     ?? null,
      sale_date,
      orderData.sale_time ?? null,
      orderData.due_date ?? null,
      orderData.round_off ?? 0,
      orderData.discount_gst_mode ?? null
    ]
  );
 
  const row = result.rows[0];

  return {
    ...row,
    sale_date: row?.sale_date ? moment(row.sale_date).format("DD MMM YYYY") : null,
    due_date: row?.due_date ? moment(row.due_date).format("DD MMM YYYY") : null,
  };
};
 

exports.createSaleItems = async (orderData, sale, client) => {
  const db = client ?? conn;
  const items = orderData.items;

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Items array is empty or invalid');
  }

  const insertedItems = [];
  const itemTaxData = calculateItemsWithDiscount(
    items,
    orderData.discount_type,
    orderData.discount_value,
    orderData.discount_gst_mode || 'after'
  );

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const taxData = itemTaxData[i];

    const result = await db.query(
      `INSERT INTO tbl_sale_items (
          sale_uuid, sale_id,
          item_id,   item_name,
          variant_id, variant_name,
          unit, quantity, price,
          discount, discount_percentage,
          gst_percentage,
          tax_amount, cgst, sgst,
          tax_inclusive, hsn_code, mrp, description
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING *`,
      [
        sale.sale_uuid,
        sale.sale_id,

        item.item_id,
        item.item_name    ?? null,

        item.variant_id   ?? null,
        item.variant_name ?? null,

        item.unit         ?? null,
        item.quantity,
        item.price,
        Number(item.discount ?? 0),
        item.discount_percentage ?? null,

        taxData.gst_percentage,
        taxData.tax_amount,
        taxData.cgst,
        taxData.sgst,
        taxData.tax_inclusive,
        item.hsn_code ?? null,
        item.mrp      ?? null,
        item.description ?? item.item_description ?? null,
      ]
    );
 
    insertedItems.push(result.rows[0]);
  }

  return insertedItems;
};

// Reconciles tbl_sale_items with the edited items list using a single
// set-based UPSERT (by sale_uuid + item_id) instead of delete-all/insert-all,
// so existing row ids survive and tbl_sale_return_items.original_item_id
// (fk_return_items_original) never gets orphaned by an edit.
exports.syncSaleItems = async (orderData, sale, client) => {
  const db = client ?? conn;
  const items = orderData.items;

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Items array is empty or invalid');
  }

  const itemTaxData = calculateItemsWithDiscount(
    items,
    orderData.discount_type,
    orderData.discount_value,
    orderData.discount_gst_mode || 'after'
  );

  const rows = items.map((item, i) => {
    const taxData = itemTaxData[i];
    return {
      item_id:         item.item_id,
      item_name:       item.item_name    ?? null,
      variant_id:      item.variant_id   ?? null,
      variant_name:    item.variant_name ?? null,
      unit:            item.unit         ?? null,
      quantity:        item.quantity,
      price:           item.price,
      discount:        Number(item.discount ?? 0),
      discount_percentage: item.discount_percentage ?? null,
      gst_percentage:  taxData.gst_percentage,
      tax_amount:      taxData.tax_amount,
      cgst:            taxData.cgst,
      sgst:            taxData.sgst,
      tax_inclusive:   taxData.tax_inclusive,
      hsn_code:        item.hsn_code ?? null,
      mrp:             item.mrp      ?? null,
      description:     item.description ?? item.item_description ?? null,
    };
  });

  // Items still referenced by a return but dropped from the edited list
  // can't be deleted without violating fk_return_items_original — block
  // with a clear message instead of letting Postgres raise the raw FK error.
  const blockedResult = await db.query(
    `SELECT DISTINCT si.item_id, si.item_name
     FROM tbl_sale_items si
     JOIN tbl_sale_return_items sri ON sri.original_item_id = si.id
     WHERE si.sale_uuid = $1
       AND si.item_id <> ALL($2::text[])`,
    [sale.sale_uuid, rows.map(r => r.item_id)]
  );

  if (blockedResult.rows.length > 0) {
    const names = blockedResult.rows.map(r => r.item_name || r.item_id).join(', ');
    throw new Error(`Cannot remove item(s) with existing returns: ${names}`);
  }

  const result = await db.query(
    `WITH incoming AS (
       SELECT *
       FROM jsonb_to_recordset($3::jsonb) AS t(
         item_id text, item_name text,
         variant_id text, variant_name text,
         unit text, quantity numeric, price numeric,
         discount numeric, discount_percentage numeric, gst_percentage numeric,
         tax_amount numeric, cgst numeric, sgst numeric,
         tax_inclusive boolean, hsn_code text, mrp numeric, description text
       )
     ),
     updated AS (
       UPDATE tbl_sale_items si
       SET item_name      = i.item_name,
           variant_id     = i.variant_id,
           variant_name   = i.variant_name,
           unit           = i.unit,
           quantity       = i.quantity,
           price          = i.price,
           discount       = i.discount,
           discount_percentage = i.discount_percentage,
           gst_percentage = i.gst_percentage,
           tax_amount     = i.tax_amount,
           cgst           = i.cgst,
           sgst           = i.sgst,
           tax_inclusive  = i.tax_inclusive,
           hsn_code       = i.hsn_code,
           mrp            = i.mrp,
           description    = i.description,
           sale_id        = $2
       FROM incoming i
       WHERE si.sale_uuid = $1 AND si.item_id = i.item_id
       RETURNING si.item_id
     ),
     inserted AS (
       INSERT INTO tbl_sale_items (
         sale_uuid, sale_id,
         item_id, item_name,
         variant_id, variant_name,
         unit, quantity, price,
         discount, discount_percentage, gst_percentage,
         tax_amount, cgst, sgst,
         tax_inclusive, hsn_code, mrp, description
       )
       SELECT $1, $2,
              i.item_id, i.item_name,
              i.variant_id, i.variant_name,
              i.unit, i.quantity, i.price,
              i.discount, i.discount_percentage, i.gst_percentage,
              i.tax_amount, i.cgst, i.sgst,
              i.tax_inclusive, i.hsn_code, i.mrp, i.description
       FROM incoming i
       WHERE i.item_id NOT IN (SELECT item_id FROM updated)
       RETURNING *
     ),
     deleted AS (
       DELETE FROM tbl_sale_items si
       WHERE si.sale_uuid = $1
         AND si.item_id <> ALL($4::text[])
       RETURNING si.item_id
     )
     SELECT * FROM inserted`,
    [sale.sale_uuid, sale.sale_id, JSON.stringify(rows), rows.map(r => r.item_id)]
  );

  return result.rows;
};

exports.createSalesPayment = async (orderData, sale, client) => {
  const db = client ?? conn;
  const paid_amount  = round(Number(orderData.paid_amount  ?? sale.total_amount));
  const total_amount = round(Number(sale.total_amount));
  const txnId        = generateTransactionId();
 
  const status =
    paid_amount >= total_amount ? 'paid'
    : paid_amount > 0           ? 'partial'
    :                             'pending';
 
  const result = await db.query(
    `INSERT INTO tbl_sale_payment (
        sale_id,
        zodu_id, branch_id,
        paid_amount,
        transaction_type,
        transaction_id,
        status
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [
      sale.sale_id,
      orderData.zodu_id,
      orderData.branch_id,
      paid_amount,
      orderData.payment_mode  ?? null,
      orderData.transaction_id ?? txnId,
      status,
    ]
  );
 
  return result.rows[0];
};
 

exports.generateSaleId = async (branchId, saleType, zoduId, client) => {
  const db = client ?? conn;
  // ── 1. Normalise type ────────────────────────────────────────────────────
  const type =
    saleType === 'Q' || saleType === 'quotation' ? 'Q' : 'S';

  // ── 2. Invoice prefix (auth-service is the single source of truth) ──────
  // digit_count and start_number are fixed — the Settings screen no longer
  // exposes them, numbering always starts at 001 and pads to 3 digits.
  const digitCount = 3;
  const startNumber = 1;
  let invoicePrefix = 'INV';
  try {
    const res = await authClient.getInvoiceSettings(zoduId, branchId);
    const settings = res?.data;
    if (settings?.invoice_prefix) {
      invoicePrefix = settings.invoice_prefix;
    }
  } catch (err) {
    console.error('[generateSaleId] invoice settings lookup failed, using defaults:', err.message);
  }

  // Quotations keep their own independent sequence, distinguished by a
  // "Q" suffix on the prefix so numbering never collides with sales.
  const prefix = type === 'Q' ? `${invoicePrefix}Q` : invoicePrefix;

  // ── Branch suffix ─────────────────────────────────────────────────────────
  // Primary:  strip the known zoduId prefix   →  "ZODU035B1".replace("ZODU035","") = "B1"
  // Fallback: regex match on trailing B+digits →  handles any format
  let branchSuffix;
  if (zoduId && branchId.startsWith(zoduId)) {
    branchSuffix = branchId.slice(zoduId.length);
  } else {
    const match = branchId.match(/B\d+$/i);
    branchSuffix = match ? match[0].toUpperCase() : branchId;
  }

  // ── 3. Next number: derived from tbl_sales itself, no separate counter ────
  // Look at the highest existing number for this branch+type ACROSS ALL
  // PREFIXES (not just the current one) and increment from there — changing
  // the prefix in Settings must not restart numbering, e.g. INV-B1-143 then
  // switching to IXV must produce IXV-B1-144, not IXV-B1-001. Falls back to
  // invoice_start_number only when this branch+type has never had a sale.
  // Runs inside the same DB transaction as the INSERT into tbl_sales, with a
  // transaction-scoped advisory lock keyed on (zodu_id, branch_id, type) so
  // two concurrent sales for the same branch can't read the same max and
  // collide on the same sale_id.
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${zoduId}:${branchId}:${type}`]);

  const { rows } = await db.query(
    `SELECT sale_id FROM tbl_sales
     WHERE zodu_id = $1 AND branch_id = $2 AND sale_type = $3 AND sale_id LIKE $4
     ORDER BY (regexp_match(sale_id, '-(\\d+)$'))[1]::int DESC
     LIMIT 1`,
    [zoduId, branchId, type, `%-${branchSuffix}-%`]
  );

  let nextNumber = startNumber;
  if (rows[0]) {
    const match = rows[0].sale_id.match(/-(\d+)$/);
    if (match) nextNumber = parseInt(match[1], 10) + 1;
  }

  // ── 4. Format ─────────────────────────────────────────────────────────────
  return `${prefix}-${branchSuffix}-${String(nextNumber).padStart(digitCount, '0')}`;
  // → "IXV-B1-144"  (prefix from settings, number continues across prefix changes)
}

exports.getSalesHistory = async (filters) => {
  const {
    zodu_id,
    branch_id,
    from_date,
    to_date,
    payment_status,
    sale_type,
    search,
    customer_search,
    cancelled_order,
    page  = 1,
    limit = 20,
  } = filters;
 
  const searchTerm = search || customer_search;
 
  const conditions = ["s.zodu_id = $1", "s.branch_id = $2", "s.cancelled_inv = $3"];
  const values     = [zodu_id, branch_id, cancelled_order];
  let   idx        = 4;
 
  if (from_date)      { conditions.push(`s.sale_date >= $${idx++}`); values.push(from_date); }
  if (to_date)        { conditions.push(`s.sale_date <= $${idx++}`); values.push(to_date); }
  if (payment_status) { conditions.push(`s.payment_status = $${idx++}`); values.push(payment_status); }
  if (sale_type)      { conditions.push(`s.sale_type = $${idx++}`); values.push(sale_type); }
 
  if (searchTerm) {
    conditions.push(`(
      s.sale_id            ILIKE $${idx}
      OR c.cust_name       ILIKE $${idx}
      OR c.cpy_name        ILIKE $${idx}
      OR c.mobile_no::text ILIKE $${idx}
    )`);
    values.push(`%${searchTerm}%`);
    idx++;
  }
 
  const where  = conditions.join(" AND ");
  const offset = (page - 1) * limit;
 
  const countResult = await conn.query(
    `SELECT COUNT(*) AS total
     FROM tbl_sales s
     LEFT JOIN tbl_customer c ON c.cust_uuid = s.customer_uuid
     WHERE ${where}`,
    values
  );
  const total = parseInt(countResult.rows[0].total, 10);
 
  const salesResult = await conn.query(
    `SELECT
        s.sale_uuid,
        s.sale_id,
        s.zodu_id,
        s.branch_id,
        s.sale_type,
        s.customer_uuid,
        s.total_items,
        s.subtotal,
        s.total_tax,
        s.discount_type,
        s.discount_value,
        s.discount_amount,
        s.total_amount,
        TO_CHAR(s.due_date,  'DD Mon YYYY') AS due_date,
        s.paid_amount,
        s.balance_amount,
        s.payment_status,
        s.notes,
        s.round_off,
        s.discount_gst_mode,
         TO_CHAR(s.sale_time,  'HH12:MI AM')              AS sale_time_fmt,
        TO_CHAR(s.created_at, 'DD Mon YYYY, HH12:MI AM') AS created_at_fmt,
        TO_CHAR(s.sale_date + s.created_at::time, 'DD Mon YYYY, HH12:MI AM') AS sale_date_fmt,

        -- customer
        c.cust_uuid,
        c.cust_id,
        c.cust_name,
        c.cpy_name,
        c.mobile_no->>0    AS customer_mobile,
        c.mobile_no        AS customer_all_mobiles,
        c.email_id->>0     AS customer_email,
        c.gst              AS customer_gst,
        c.city             AS customer_city,
        c.state            AS customer_state,
 
        -- ✅ return summary (null columns = no returns yet)
        ret.return_count,
        ret.total_returned,
        ret.last_return_date
 
     FROM tbl_sales s
     LEFT JOIN tbl_customer c ON c.cust_uuid = s.customer_uuid
 
     -- ✅ aggregate all returns for each sale in one lateral join
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*)                        AS return_count,
         COALESCE(SUM(r.return_amount), 0) AS total_returned,
         MAX(r.return_date)              AS last_return_date
       FROM tbl_sale_returns r
       WHERE r.original_sale_uuid = s.sale_uuid
     ) ret ON true
 
     WHERE ${where}
     ORDER BY s.sale_date DESC, s.created_at DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...values, limit, offset]
  );
 
  return {
    total,
    page:        Number(page),
    limit:       Number(limit),
    total_pages: Math.ceil(total / limit),
    data:        salesResult.rows,
  };
};
 
 
// ═══════════════════════════════════════════════════════════════
//  REPOSITORY  —  sale.repository.js  (UPDATED getSaleById)
// ═══════════════════════════════════════════════════════════════
 
exports.getSalesHistorySummary = async (filters) => {
  const {
    zodu_id,
    branch_id,
    from_date,
    to_date,
    payment_status,
    search,
    customer_search,
    cancelled_order
  } = filters;

  const searchTerm = search || customer_search;

  const conditions = ["s.zodu_id = $1", "s.branch_id = $2", "s.cancelled_inv = $3"];
  const values     = [zodu_id, branch_id, cancelled_order];
  let   idx        = 4;

  if (from_date)      { conditions.push(`s.sale_date >= $${idx++}`); values.push(from_date); }
  if (to_date)        { conditions.push(`s.sale_date <= $${idx++}`); values.push(to_date); }
  if (payment_status) { conditions.push(`s.payment_status = $${idx++}`); values.push(payment_status); }

  if (searchTerm) {
    conditions.push(`(
      s.sale_id            ILIKE $${idx}
      OR c.cust_name       ILIKE $${idx}
      OR c.cpy_name        ILIKE $${idx}
      OR c.mobile_no::text ILIKE $${idx}
    )`);
    values.push(`%${searchTerm}%`);
    idx++;
  }

  const where = conditions.join(" AND ");

  const { rows } = await conn.query(
    `SELECT
      COUNT(*)   FILTER (WHERE s.sale_type != 'Q') AS total_transactions,
      COALESCE(SUM(s.total_amount) FILTER (WHERE s.sale_type != 'Q'), 0) AS net_revenue,
      COUNT(*)   FILTER (WHERE s.sale_type = 'Q')  AS total_quotations
    FROM tbl_sales s
    LEFT JOIN tbl_customer c ON c.cust_uuid = s.customer_uuid
    WHERE ${where}`,
    values
  );

  return {
    total_transactions: parseInt(rows[0].total_transactions, 10),
    net_revenue:        parseFloat(rows[0].net_revenue),
    total_quotations:   parseInt(rows[0].total_quotations, 10),
  };
};

exports.getSaleById = async (sale_id, zodu_id, branch_id) => {
  console.log("Fetching sale by ID-------------:", sale_id, zodu_id, branch_id);
  
  console.log(sale_id,zodu_id,branch_id)
  const saleResult = await conn.query(
    `SELECT
        s.sale_uuid,
        s.sale_id,
        s.zodu_id,
        s.branch_id,
        s.sale_type,
        s.customer_uuid,
        s.total_items,
        s.subtotal,
        s.total_tax,
        s.discount_type,
        s.discount_value,
        s.discount_amount,
        s.total_amount,
        s.paid_amount,
        s.balance_amount,
        s.payment_status,
        s.notes,
        TO_CHAR(s.sale_date,  'DD Mon YYYY')             AS sale_date_fmt,
        TO_CHAR(s.sale_time,  'HH12:MI AM')              AS sale_time_fmt,
        TO_CHAR(s.created_at, 'DD Mon YYYY, HH12:MI AM') AS created_at_fmt,
        s.round_off,
        s.discount_gst_mode,
        TO_CHAR(s.due_date,  'DD-Mon-YYYY')             AS due_date_fmt,
 
        c.cust_uuid,
        c.cust_id AS customer_id,
        c.cust_name,
        c.cpy_name,
        c.mobile_no->>0    AS customer_mobile,
        c.mobile_no        AS customer_all_mobiles,
        c.email_id->>0     AS customer_email,
        c.email_id         AS customer_all_emails,
        c.gst              AS customer_gst,
        c.address_line1    AS customer_address_line1,
        c.address_line2    AS customer_address_line2,
        c.city             AS customer_city,
        c.state            AS customer_state,
        c.pincode          AS customer_pincode,
        c.shipping_address,
        c.same_as_billing_address
 
     FROM tbl_sales s
     LEFT JOIN tbl_customer c ON c.cust_uuid = s.customer_uuid AND c.branch_id = s.branch_id
     WHERE s.sale_id   = $1
       AND s.zodu_id   = $2
       AND s.branch_id = $3
     LIMIT 1`,
    [sale_id, zodu_id, branch_id]
  );
 
  if (saleResult.rows.length === 0) return null;
 
  const row       = saleResult.rows[0];
  const sale_uuid = row.sale_uuid;

 
  const sale = {
    sale_uuid:       row.sale_uuid,
    sale_id:         row.sale_id,
    zodu_id:         row.zodu_id,
    branch_id:       row.branch_id,
    sale_type:       row.sale_type,
    customer_id:     row.customer_id,
    total_items:     row.total_items,
    subtotal:        row.subtotal,
    total_tax:       row.total_tax,
    discount_type:   row.discount_type,
    discount_value:  row.discount_value,
    discount_amount: row.discount_amount,
    total_amount:    row.total_amount,
    paid_amount:     row.paid_amount,
    balance_amount:  row.balance_amount,
    payment_status:  row.payment_status,
    notes:           row.notes,
    sale_date_fmt:   row.sale_date_fmt,
    sale_time_fmt:   row.sale_time_fmt,
    created_at_fmt: row.created_at_fmt,
    round_off: row.round_off,
    discount_gst_mode: row.discount_gst_mode,
    due_date_fmt: row.due_date_fmt,
  };
 
  const customer = row.cust_uuid
    ? {
        cust_uuid:     row.cust_uuid,
        cust_id:       row.cust_id,
        cust_name:     row.cust_name,
        cpy_name:      row.cpy_name,
        mobile:        row.customer_mobile,
        all_mobiles:   row.customer_all_mobiles,
        email:         row.customer_email,
        all_emails:    row.customer_all_emails,
        gst:           row.customer_gst,
        address_line1: row.customer_address_line1,
        address_line2: row.customer_address_line2,
        city:          row.customer_city,
        state:         row.customer_state,
      pincode: row.customer_pincode,
        shipping_address: row.shipping_address,
        same_as_billing_address: row.same_as_billing_address,
      }
    : null;
 
  // Items
  const itemsResult = await conn.query(
    `SELECT
        si.id,
        si.sale_uuid,
        si.sale_id,
        si.item_id,
        m.item_uuid,
        m.tax_incl_type AS tax_inclusive,
        si.item_name,
        COALESCE(si.description, m.description) AS description,
        si.variant_id,
        si.variant_name,
        si.unit,
        si.quantity,
        si.price,
        si.mrp,
        si.discount,
        si.discount_percentage,
        si.hsn_code,
        si.gst_percentage,
        si.tax_amount,
        si.cgst,
        si.sgst,
        si.tax_inclusive,
        si.total_amount,
 
        -- ✅ how much of this line item has already been returned
        COALESCE(ri_totals.returned_qty, 0)    AS returned_qty,
        COALESCE(ri_totals.returnable_qty,
                 si.quantity)                  AS returnable_qty,
 
        TO_CHAR(si.created_at, 'DD Mon YYYY')  AS created_at_fmt
 
     FROM tbl_sale_items si
     LEFT JOIN tbl_menu_items m ON m.item_id = si.item_id AND m.branch_id = $3 AND m.zodu_id = $2
 
     -- ✅ sum returned qty per original line item across all returns
     LEFT JOIN LATERAL (
       SELECT
         SUM(ri.return_qty)                        AS returned_qty,
         GREATEST(si.quantity - SUM(ri.return_qty), 0) AS returnable_qty
       FROM tbl_sale_return_items ri
       WHERE ri.original_item_id = si.id
     ) ri_totals ON true
 
     WHERE si.sale_uuid = $1
     ORDER BY si.id ASC`,
    [sale_uuid,zodu_id,branch_id]
  );
 
  // HSN-wise tax summary (SQL grouped — faster than JS reduce)
  // taxable_value is derived from the stored tax_amount/gst_percentage (already
  // discount-adjusted at insert time per discount_gst_mode) so it stays
  // consistent with cgst_amount/sgst_amount instead of recomputing from the
  // raw gross price, which would ignore the order-level discount.
  const hsnResult = await conn.query(
    `SELECT
        si.hsn_code,
        ROUND(SUM(
          CASE
            WHEN si.gst_percentage > 0
            THEN si.tax_amount * 100.0 / si.gst_percentage
            ELSE si.price * si.quantity - COALESCE(si.discount, 0)
          END
        )::numeric, 2)              AS taxable_value,
        (si.gst_percentage / 2)     AS cgst_percent,
        ROUND(SUM(si.cgst)::numeric, 2)       AS cgst_amount,
        (si.gst_percentage / 2)     AS sgst_percent,
        ROUND(SUM(si.sgst)::numeric, 2)       AS sgst_amount,
        ROUND(SUM(si.discount)::numeric, 2)       AS item_wise_discount_amount,
        ROUND(SUM(si.tax_amount)::numeric, 2) AS total_tax
     FROM tbl_sale_items si
     WHERE si.sale_uuid = $1
     GROUP BY si.hsn_code, si.gst_percentage
     ORDER BY si.hsn_code`,
    [sale_uuid]
  );

  // Payment history
  const paymentResult = await conn.query(
    `SELECT
        sp.id              AS payment_row_id,
        sp.payment_id      AS payment_uuid,
        sp.sale_id,
        sp.zodu_id,
        sp.branch_id,
        sp.paid_amount,
        sp.transaction_type,
        sp.transaction_id,
        sp.status,
        TO_CHAR(sp.payment_date, 'DD Mon YYYY')            AS payment_date_fmt,
        TO_CHAR(sp.created_at,   'DD Mon YYYY HH12:MI AM') AS created_at_fmt
     FROM tbl_sale_payment sp
     WHERE sp.sale_id   = $1
       AND sp.zodu_id   = $2
       AND sp.branch_id = $3
     ORDER BY sp.created_at DESC, sp.id DESC`,
    [sale_id, zodu_id, branch_id]
  );
 
  // ✅ Return history for this sale
 const returnResult = await conn.query(
  `SELECT
      r.return_uuid,
      r.return_id,
      r.total_items,
      r.subtotal,
      r.total_tax,
      r.return_amount,
      r.refund_type,
      r.return_reason,
      r.notes,
      TO_CHAR(r.return_date,  'DD Mon YYYY')             AS return_date_fmt,
      TO_CHAR(r.return_time,  'HH12:MI AM')              AS return_time_fmt,
      TO_CHAR(r.created_at,   'DD Mon YYYY, HH12:MI AM') AS created_at_fmt,

      COALESCE(
        json_agg(
          json_build_object(
            'id', i.id,
            'item_id', i.item_id,
            'item_name', i.item_name,
            'description', i.description,
            'unit', i.unit,
            'return_qty', i.return_qty,
            'original_qty', i.original_qty,
            'price', i.price,
            'tax_amount', i.tax_amount,
            'gst_percentage', i.gst_percentage,
            'hsn_code', i.hsn_code,
            'total_amount', i.total_amount
          )
        ) FILTER (WHERE i.id IS NOT NULL), '[]'
      ) AS items

   FROM tbl_sale_returns r
   LEFT JOIN tbl_sale_return_items i 
     ON r.return_uuid = i.return_uuid

   WHERE r.original_sale_uuid = $1
   GROUP BY r.return_uuid
   ORDER BY r.created_at DESC`,
  [sale_uuid]
);

  return {
    sale,
    customer,
    items:           withDescription(itemsResult.rows),
    payment_history: paymentResult.rows,
    return_history:  returnResult.rows.map((r) => ({ ...r, items: withDescription(r.items) })),
    hsn_wise_tax:    hsnResult.rows,
  };
};

exports.deleteSale = async (sale_id, zodu_id, branch_id) => {
  const client = await conn.connect();

  try {
    await client.query("BEGIN");

    const saleResult = await client.query(
      `SELECT sale_uuid, sale_id, sale_type, cancelled_inv
       FROM tbl_sales
       WHERE sale_id = $1
         AND zodu_id = $2
         AND branch_id = $3
       FOR UPDATE`,
      [sale_id, zodu_id, branch_id]
    );

    if (!saleResult.rows.length) {
      await client.query("ROLLBACK");
      return null;
    }

    const sale = saleResult.rows[0];

    if (sale.cancelled_inv) {
      await client.query("ROLLBACK");
      return { alreadyCancelled: true, ...sale };
    }

    const soldItemsResult = await client.query(
      `SELECT
          si.item_id,
          COALESCE(mi.item_uuid, inv.item_uuid) AS item_uuid,
          COALESCE(mi.item_name, inv.item_name, MAX(si.item_name)) AS item_name,
          SUM(COALESCE(si.quantity, 0))::numeric AS sold_qty
       FROM tbl_sale_items si
       LEFT JOIN tbl_menu_items mi
         ON mi.item_id = si.item_id
        AND mi.branch_id = $3
        AND mi.zodu_id = $2
       LEFT JOIN tbl_inventory inv
         ON inv.item_id = si.item_id
        AND inv.branch_id = $3
        AND inv.zodu_id = $2
       WHERE si.sale_uuid = $1
       GROUP BY si.item_id, mi.item_uuid, inv.item_uuid, mi.item_name, inv.item_name`,
      [sale.sale_uuid, zodu_id, branch_id]
    );

    const returnItemsResult = await client.query(
      `SELECT
          sri.item_id,
          COALESCE(mi.item_uuid, inv.item_uuid) AS item_uuid,
          COALESCE(mi.item_name, inv.item_name, MAX(sri.item_name)) AS item_name,
          SUM(COALESCE(sri.return_qty, 0))::numeric AS return_qty
       FROM tbl_sale_return_items sri
       INNER JOIN tbl_sale_returns sr
         ON sr.return_uuid = sri.return_uuid
       LEFT JOIN tbl_menu_items mi
         ON mi.item_id = sri.item_id
        AND mi.branch_id = $3
        AND mi.zodu_id = $2
       LEFT JOIN tbl_inventory inv
         ON inv.item_id = sri.item_id
        AND inv.branch_id = $3
        AND inv.zodu_id = $2
       WHERE sr.original_sale_uuid = $1
       GROUP BY sri.item_id, mi.item_uuid, inv.item_uuid, mi.item_name, inv.item_name`,
      [sale.sale_uuid, zodu_id, branch_id]
    );

    const netQtyByItem = new Map();

    for (const row of soldItemsResult.rows) {
      netQtyByItem.set(String(row.item_id), {
        item_id: row.item_id,
        item_uuid: row.item_uuid,
        item_name: row.item_name,
        net_qty: Number(row.sold_qty || 0),
      });
    }

    for (const row of returnItemsResult.rows) {
      const key = String(row.item_id);
      const existing = netQtyByItem.get(key) || {
        item_id: row.item_id,
        item_uuid: row.item_uuid,
        item_name: row.item_name,
        net_qty: 0,
      };

      existing.item_uuid = existing.item_uuid || row.item_uuid;
      existing.item_name = existing.item_name || row.item_name;
      existing.net_qty -= Number(row.return_qty || 0);
      netQtyByItem.set(key, existing);
    }

    const itemsToReverse = [...netQtyByItem.values()].filter(
      (item) => item.item_id && item.net_qty !== 0
    );

    if (itemsToReverse.length > 0) {
      const inventoryRowsResult = await client.query(
        `SELECT inventory_uuid, item_uuid, item_id, item_name, available_qty
         FROM tbl_inventory
         WHERE item_id = ANY($1::text[])
           AND zodu_id = $2
           AND branch_id = $3
         FOR UPDATE`,
        [itemsToReverse.map((item) => item.item_id), zodu_id, branch_id]
      );

      const inventoryByItemId = new Map(
        inventoryRowsResult.rows.map((row) => [String(row.item_id), row])
      );

      const inventoryUuids = [];
      const stockAfters = [];
      const ledgerItemUuids = [];
      const ledgerItemIds = [];
      const ledgerItemNames = [];
      const ledgerQtyChanges = [];
      const ledgerStockBefores = [];
      const ledgerStockAfters = [];

      for (const item of itemsToReverse) {
        const inventory = inventoryByItemId.get(String(item.item_id));
        if (!inventory) continue;

        const stockBefore = Number(inventory.available_qty || 0);
        const stockAfter = stockBefore + Number(item.net_qty);

        inventoryUuids.push(inventory.inventory_uuid);
        stockAfters.push(stockAfter);

        ledgerItemUuids.push(inventory.item_uuid);
        ledgerItemIds.push(item.item_id);
        ledgerItemNames.push(item.item_name);
        ledgerQtyChanges.push(Number(item.net_qty));
        ledgerStockBefores.push(stockBefore);
        ledgerStockAfters.push(stockAfter);
      }

      if (inventoryUuids.length > 0) {
        await client.query(
          `UPDATE tbl_inventory AS inv
           SET available_qty = data.stock_after,
               last_stock_update = CURRENT_TIMESTAMP
           FROM (
             SELECT UNNEST($1::uuid[]) AS inventory_uuid,
                    UNNEST($2::numeric[]) AS stock_after
           ) AS data
           WHERE inv.inventory_uuid = data.inventory_uuid`,
          [inventoryUuids, stockAfters]
        );

        await client.query(
          `INSERT INTO tbl_stock_ledger (
            item_uuid, item_id, zodu_id, branch_id,
            item_name, transaction_type,
            reference_id, qty_change,
            stock_before, stock_after, notes
          )
          SELECT
            data.item_uuid, data.item_id, $1, $2,
            data.item_name, 'sale_deleted',
            $3, data.qty_change,
            data.stock_before, data.stock_after,
            $4
          FROM (
            SELECT
              UNNEST($5::uuid[]) AS item_uuid,
              UNNEST($6::text[]) AS item_id,
              UNNEST($7::text[]) AS item_name,
              UNNEST($8::numeric[]) AS qty_change,
              UNNEST($9::numeric[]) AS stock_before,
              UNNEST($10::numeric[]) AS stock_after
          ) AS data`,
          [
            zodu_id,
            branch_id,
            sale.sale_uuid,
            `Stock reversed on deletion of sale ${sale.sale_id}`,
            ledgerItemUuids,
            ledgerItemIds,
            ledgerItemNames,
            ledgerQtyChanges,
            ledgerStockBefores,
            ledgerStockAfters,
          ]
        );
      }
    }

    const cancelledSaleResult = await client.query(
      `UPDATE tbl_sales
       SET cancelled_inv = true
       WHERE sale_uuid = $1
       RETURNING *`,
      [sale.sale_uuid]
    );

    await client.query("COMMIT");

    return cancelledSaleResult.rows[0] ?? null;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

exports.createCustomer = async (data) => {
  const result = await conn.query(
    `INSERT INTO tbl_customer (
        zodu_id, branch_id,
        cust_name, cpy_name,
        mobile_no, email_id,
        gst,
        address_line1, address_line2,
        city, state, pincode,shipping_address,same_as_billing_address
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      data.zodu_id,
      data.branch_id,
      data.cust_name    ?? null,
      data.cpy_name     ?? null,
      // mobile_no and email_id are jsonb arrays
      JSON.stringify(data.mobile_no  ?? []),
      JSON.stringify(data.email_id   ?? []),
      data.gst          ?? null,
      data.address_line1 ?? null,
      data.address_line2 ?? null,
      data.city         ?? null,
      data.state        ?? null,
      data.pincode ?? null,
      data.shipping_address ?? null,
      data.same_as_billing_address ?? null
    ]
  );
  return result.rows[0];
};

// ============================================================
//  payment.repository.js
// ============================================================
 
// ── MARK PAYMENT (add a new payment row + update tbl_sales) ──
exports.markPayment = async (data) => {
  try {
    await conn.query("BEGIN");
 
    const round = (n) => Math.round(n * 100) / 100;
 
    // 1. Fetch the current sale to verify it exists + get totals
    const saleResult = await conn.query(
      `SELECT sale_uuid, sale_id, total_amount, paid_amount, balance_amount, payment_status
       FROM tbl_sales
       WHERE sale_id   = $1
         AND zodu_id   = $2
         AND branch_id = $3
       FOR UPDATE`,
      [data.sale_id, data.zodu_id, data.branch_id]
    );
 
    if (saleResult.rows.length === 0) {
      throw new Error("Sale not found");
    }
 
    const sale           = saleResult.rows[0];
    const totalAmount    = round(Number(sale.total_amount));
    const alreadyPaid    = round(Number(sale.paid_amount));
    const newPayment     = round(Number(data.paid_amount));
    const newTotalPaid   = round(alreadyPaid + newPayment);
    const newBalance     = round(totalAmount - newTotalPaid);
 
    if (newPayment <= 0) {
      throw new Error("paid_amount must be greater than 0");
    }
    if (newTotalPaid > totalAmount) {
      throw new Error(
        `Payment of ${newPayment} exceeds balance due of ${round(totalAmount - alreadyPaid)}`
      );
    }
 
    // 2. Determine new payment_status on tbl_sales
    const newPaymentStatus =
      newBalance <= 0         ? "fully_paid"
      : newTotalPaid > 0      ? "partially_paid"
                              : "unpaid";
 
    // 3. Update tbl_sales — paid_amount, balance_amount, payment_status
    await conn.query(
      `UPDATE tbl_sales
       SET paid_amount    = $1,
           balance_amount = $2,
           payment_status = $3
       WHERE sale_id   = $4
         AND zodu_id   = $5
         AND branch_id = $6`,
      [newTotalPaid, newBalance, newPaymentStatus, data.sale_id, data.zodu_id, data.branch_id]
    );
 
    // 4. Insert into tbl_sale_payment
    const paymentResult = await conn.query(
      `INSERT INTO tbl_sale_payment (
          sale_id, zodu_id, branch_id,
          paid_amount,
          transaction_type,
          transaction_id,
          payment_date,
          status
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        data.sale_id,
        data.zodu_id,
        data.branch_id,
        newPayment,
        data.transaction_type ?? null,
        data.transaction_id   ?? null,
        data.payment_date     ?? null,
        newPaymentStatus === "fully_paid" ? "paid" : "partial",
      ]
    );
 
    await conn.query("COMMIT");
 
    return {
      payment:        paymentResult.rows[0],
      new_paid_amount:   newTotalPaid,
      new_balance_amount: newBalance,
      new_payment_status: newPaymentStatus,
    };
  } catch (err) {
    await conn.query("ROLLBACK");
    throw err;
  }
};

// ── GET outstanding bills for a customer (feeds the "Mark Payment" modal) ──
exports.getCustomerOutstandingBills = async ({ cust_uuid, zodu_id, branch_id }) => {
  const { rows } = await conn.query(
    `SELECT
       sale_id,
       sale_uuid,
       TO_CHAR(sale_date, 'DD-MON-YYYY')         AS invoice_date,
       TO_CHAR(due_date,  'DD-MON-YYYY')         AS due_date,
       total_amount,
       paid_amount,
       balance_amount,
       payment_status
     FROM tbl_sales
     WHERE customer_uuid = $1
       AND zodu_id        = $2
       AND branch_id      = $3
       AND sale_type      = 'S'
       AND balance_amount > 0
     ORDER BY sale_date ASC, created_at ASC`,   // oldest bill first, FIFO settlement order
    [cust_uuid, zodu_id, branch_id]
  );
  return rows;
};

// ── MARK PAYMENT ACROSS MULTIPLE BILLS ──────────────────────────────────────
// NOTE: tbl_sale_payment needs these columns added manually before this runs:
//
//   ALTER TABLE tbl_sale_payment
//     ADD COLUMN IF NOT EXISTS attachment_url JSONB,
//     ADD COLUMN IF NOT EXISTS reference_no   VARCHAR(100),
//     ADD COLUMN IF NOT EXISTS group_id       UUID;
//
// One payment (date/mode/reference/attachments) is split across the selected
// bills, oldest-first (FIFO), each bill absorbing as much as it needs before
// the remainder rolls to the next bill.
exports.markCustomerPayment = async (data) => {
  const client = await conn.connect();
  try {
    await client.query("BEGIN");

    const {
      zodu_id, branch_id, cust_uuid,
      payment_date, payment_mode, reference_no,
      attachment_url,
      bills,          // [{ sale_id }, ...] — order chosen by caller, but we re-sort by sale_date to guarantee FIFO
    } = data;

    let remaining = round(Number(data.total_payment));
    if (remaining <= 0) throw new Error("total_payment must be greater than 0");

    const saleIds = bills.map((b) => b.sale_id);

    // Lock the selected bills and fetch them oldest-first for deterministic FIFO allocation.
    const { rows: sales } = await client.query(
      `SELECT sale_id, total_amount, paid_amount, balance_amount
       FROM tbl_sales
       WHERE sale_id = ANY($1::text[])
         AND zodu_id   = $2
         AND branch_id = $3
         AND customer_uuid = $4
       ORDER BY sale_date ASC, created_at ASC
       FOR UPDATE`,
      [saleIds, zodu_id, branch_id, cust_uuid]
    );

    if (sales.length !== saleIds.length) {
      throw new Error("One or more selected bills were not found for this customer");
    }

    const groupId = randomUUID();

    // Compute FIFO allocation in memory first (no DB round-trips in the loop),
    // then flush all sale updates and all payment inserts as two bulk statements.
    const updatedSales = [];
    for (const sale of sales) {
      if (remaining <= 0) break;

      const balanceDue = round(Number(sale.balance_amount));
      if (balanceDue <= 0) continue;

      const applied = round(Math.min(balanceDue, remaining));
      remaining = round(remaining - applied);

      const newPaid    = round(Number(sale.paid_amount) + applied);
      const newBalance = round(Number(sale.total_amount) - newPaid);
      const newStatus  =
        newBalance <= 0    ? "fully_paid"
        : newPaid > 0      ? "partially_paid"
                           : "unpaid";

      updatedSales.push({
        sale_id: sale.sale_id,
        paid_amount: newPaid,
        balance_amount: newBalance,
        payment_status: newStatus,
        applied_amount: applied,
      });
    }

    let allocations = [];

    if (updatedSales.length > 0) {
      // Bulk UPDATE: one round trip for every affected bill via VALUES join.
      await client.query(
        `UPDATE tbl_sales AS s
         SET paid_amount    = v.paid_amount,
             balance_amount = v.balance_amount,
             payment_status = v.payment_status
         FROM (
           SELECT * FROM UNNEST(
             $1::text[], $2::numeric[], $3::numeric[], $4::text[]
           ) AS t(sale_id, paid_amount, balance_amount, payment_status)
         ) AS v
         WHERE s.sale_id = v.sale_id AND s.zodu_id = $5 AND s.branch_id = $6`,
        [
          updatedSales.map((s) => s.sale_id),
          updatedSales.map((s) => s.paid_amount),
          updatedSales.map((s) => s.balance_amount),
          updatedSales.map((s) => s.payment_status),
          zodu_id,
          branch_id,
        ]
      );

      // Bulk INSERT: one round trip for every payment row via UNNEST.
      const attachmentJson = JSON.stringify(attachment_url || []);
      const { rows: paymentRows } = await client.query(
        `INSERT INTO tbl_sale_payment (
            sale_id, zodu_id, branch_id,
            paid_amount, transaction_type, transaction_id,
            payment_date, status, attachment_url, group_id
         )
         SELECT
            v.sale_id, $2, $3,
            v.applied_amount, $4::text, $7,
            $5::date, v.status, $6::jsonb, $8
         FROM UNNEST(
           $1::text[], $9::numeric[], $10::text[]
         ) AS v(sale_id, applied_amount, status)
         RETURNING *`,
        [
          updatedSales.map((s) => s.sale_id),
          zodu_id,
          branch_id,
          payment_mode,
          payment_date,
          attachmentJson,
          reference_no ?? null,
          groupId,
          updatedSales.map((s) => s.applied_amount),
          updatedSales.map((s) => (s.payment_status === "fully_paid" ? "paid" : "partial")),
        ]
      );

      allocations = paymentRows;
    }

    await client.query("COMMIT");

    return {
      group_id: groupId,
      unallocated_amount: remaining, // leftover if payment exceeded total selected balance
      bills: updatedSales,
      payments: allocations,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};





// services/purchaseService.js
// ----------------------------------------------------
// PURCHASE: CREATE
// ----------------------------------------------------
exports.createPurchaseOrder = async (orderData) => {
  try {
    await conn.query("BEGIN");

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
      notes,
      reference_no
    } = orderData;

    const totalAmount = Number(total_amount || 0);
    const initialPaid = Number(paid_amount || 0);

    const insertPurchaseQuery = `
      INSERT INTO tbl_purchase
        ( purchase_id, vendor_id, zodu_id, branch_id,
          purchase_date, purchase_type, attachment_url,
          payment_type, notes )
      VALUES ($1,$2,$3,$4,$5,$6, $7, COALESCE($8,'cash'), $9)
      RETURNING *
    `;

    const purchaseResult = await conn.query(insertPurchaseQuery, [
      purchase_id,
      vendor,
      zodu_id,
      branch_id,
      purchase_date,
      purchase_type,
      JSON.stringify(attachment_url || null),
      payment_type,
      notes
    ]);

    const purchaseRow = purchaseResult.rows[0];

    // ensure payment master
    const paymentRow = await exports.ensurePaymentForSource({
      zodu_id,
      branch_id,
      source_type: "purchase",
      source_id: purchaseRow.purchase_id,
      total_amount: totalAmount,
    });

    // initial payment?
    if (initialPaid > 0) {
      await exports.insertPaymentHistory({
        payment_id: paymentRow.payment_id,
        zodu_id,
        branch_id,
        paid_amount: initialPaid,
        payment_type,
        reference_no,
        notes: "Initial payment at purchase creation",
        paid_date: purchase_date,
      });
    }

    await conn.query("COMMIT");
    return purchaseRow;

  } catch (err) {
    await conn.query("ROLLBACK");
    throw err;
  }
};

// ----------------------------------------------------
// PURCHASE: UPDATE (edit purchase + sync payment total)
// ----------------------------------------------------
exports.updatePurchase = async (purchaseData) => {
  try {
    await conn.query("BEGIN");

    const purchase_id = purchaseData.purchase_id;
    if (!purchase_id) throw new Error("purchase_id is required");

    const totalAmount = Number(purchaseData.total_amount || 0);
    const newPaid     = Number(purchaseData.paid_amount || 0);

    // UPDATE PURCHASE MAIN
    const result = await conn.query(
      `
       UPDATE tbl_purchase
       SET vendor_id=$1, purchase_date=$2, purchase_type=$3,
           attachment_url=$4, payment_type=$5, notes=$6,
           updated_at=NOW()
       WHERE purchase_id=$7
       RETURNING *
      `,
      [
        purchaseData.vendor,
        purchaseData.purchase_date,
        purchaseData.purchase_type,
        JSON.stringify(purchaseData.attachment_url || []),
        purchaseData.payment_type,
        purchaseData.notes || null,
        purchase_id,
      ]
    );

    const purchaseRow = result.rows[0];

    // ENSURE PAYMENT ROW + force update total
    const paymentRow = await exports.ensurePaymentForSource({
      zodu_id: purchaseRow.zodu_id,
      branch_id: purchaseRow.branch_id,
      source_type: "purchase",
      source_id: purchase_id,
      total_amount: totalAmount,  // ⭐ fix
    });

    const currentPaid = Number(paymentRow.paid_amount || 0);
    const diff        = newPaid - currentPaid;

    // If paid changed, record payment history
    if (diff !== 0) {
      await exports.insertPaymentHistory({
        payment_id   : paymentRow.payment_id,
        zodu_id      : purchaseRow.zodu_id,
        branch_id    : purchaseRow.branch_id,
        paid_amount  : diff,
        payment_type : purchaseData.payment_type || "adjustment",
        paid_date    : purchaseData.purchase_date || new Date(),
      });
    }

    // items
    if (Array.isArray(purchaseData.items)) {
      await conn.query(`DELETE FROM tbl_purchase_items WHERE purchase_id=$1`, [purchase_id]);

      const q = `
        INSERT INTO tbl_purchase_items
        (purchase_id, item_id, item_name, qty, unit, purchase_price, category_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `;

      for (const item of purchaseData.items) {
        await conn.query(q, [
          purchase_id,
          item.id || item.item_id,
          item.name,
          item.qty,
          item.unit,
          item.purchase_price,
          item.category_id,
        ]);
      }
    }

    await conn.query("COMMIT");
    return purchaseRow;

  } catch (err) {
    await conn.query("ROLLBACK");
    throw err;
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


exports.getPurchaseById = async (purchase_id) => {
  try {
    const query = `
    WITH purchase_base AS (
      SELECT
        p.purchase_id,
        p.zodu_id,
        p.branch_id,
        p.vendor_id,
        p.purchase_date,
        p.purchase_type,
        p.notes,
        p.attachment_url,
        p.created_at,
        p.updated_at,

        COALESCE(pay.total_amount,0) AS total_amount,
        COALESCE(pay.paid_amount,0)  AS paid_amount,
        (COALESCE(pay.total_amount,0) - COALESCE(pay.paid_amount,0)) AS balance_amount,
        pay.payment_id

      FROM tbl_purchase p
      LEFT JOIN tbl_payment pay
        ON pay.source_type = 'purchase'
       AND pay.source_id   = p.purchase_id
       AND pay.branch_id   = p.branch_id
       AND pay.zodu_id     = p.zodu_id
      WHERE p.purchase_id = $1
    ),

    purchase_data AS (
      SELECT
        pb.*,

        v.vendor_name,
        v.vendor_phone,
        v.vendor_email,
        v.company_name,

        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'item_id', pi.item_id,
              'item_name', pi.item_name,
              'quantity', pi.qty,
              'unit_id', pi.unit,
              'unit', u.short_name,
              'price', pi.purchase_price,
              'total', pi.total_price,
              'category', c.name,
              'category_id', pi.category_id
            )
          ) FILTER (WHERE pi.item_id IS NOT NULL),
          '[]'
        ) AS items

      FROM purchase_base pb
      LEFT JOIN tbl_purchase_items pi ON pb.purchase_id = pi.purchase_id
      LEFT JOIN tbl_category c       ON pi.category_id = c.id
      LEFT JOIN tbl_units u          ON pi.unit        = u.id
      LEFT JOIN tbl_vendor v         ON pb.vendor_id   = v.vendor_id
      GROUP BY
        pb.purchase_id, pb.zodu_id, pb.branch_id,
        pb.vendor_id, pb.purchase_date, pb.purchase_type,
        pb.notes, pb.attachment_url,
        pb.total_amount, pb.paid_amount, pb.balance_amount,
        pb.payment_id,
        pb.created_at, pb.updated_at,
        v.vendor_name, v.vendor_phone,
        v.vendor_email, v.company_name
    )

    SELECT
      pd.*,

      COALESCE(
        (
          SELECT JSON_AGG(
            JSON_BUILD_OBJECT(
              'payment_id', ph.transaction_id,
              'paid_amount', ph.paid_amount,
              'payment_mode', ph.payment_mode,
              'paid_date', ph.paid_date,
              'created_at', TO_CHAR(ph.created_at,'DD-MON-YYYY HH12:MI AM')
            )
            ORDER BY ph.created_at DESC
          )
          FROM tbl_payment_history ph
          WHERE ph.payment_id = pd.payment_id
        ),
        '[]'
      ) AS payment_history

    FROM purchase_data pd;
    `;

    const result = await conn.query(query, [purchase_id]);

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0]; // ✅ single purchase object
  } catch (err) {
    console.error("Error in getPurchaseById:", err.message);
    throw new Error("Unable to fetch purchase: " + err.message);
  }
};











exports.deleteExpense = async (expenseId) => {
  try {
    await conn.query("BEGIN");

     const expenseData = await conn.query(
      `SELECT attachment_url 
       FROM tbl_expense 
       WHERE expense_id = $1`,
      [expenseId]
    );

    const attachmentURL = expenseData.rows[0]?.attachment_url ?? [];

if (Array.isArray(attachmentURL)) {
  for (const file of attachmentURL) {
    if (file?.name) {
      await deleteFileFromMinIO(file.name);
    }
  }
}


    // 1) Get the payment_id linked to this expense
    const paymentResult = await conn.query(
      `SELECT payment_id 
       FROM tbl_payment 
       WHERE source_id = $1`,
      [expenseId]
    );

    const paymentId = paymentResult.rows.length
      ? paymentResult.rows[0].payment_id
      : null;

    // 2) If payment exists → delete payment history
    if (paymentId) {
      await conn.query(
        `DELETE FROM tbl_payment_history
         WHERE payment_id = $1`,
        [paymentId]
      );

      // 3) Delete main payment record
      await conn.query(
        `DELETE FROM tbl_payment
         WHERE payment_id = $1`,
        [paymentId]
      );
    }

    // 4) Delete all expense items
    await conn.query(
      `DELETE FROM tbl_expense_items
       WHERE expense_id = $1`,
      [expenseId]
    );

    // 5) Delete expense
    const { rows } = await conn.query(
      `DELETE FROM tbl_expense
       WHERE expense_id = $1
       RETURNING *`,
      [expenseId]
    );

    await conn.query("COMMIT");

    if (rows.length === 0) return null; // nothing deleted
    return rows[0];

  } catch (err) {
    await conn.query("ROLLBACK");
    console.error("❌ deleteExpenseWithPayment error:", err);
    throw err;
  }
};


exports.deletePurchase = async (purchaseId) => {

  try {
    await conn.query("BEGIN");

     const purchaseData = await conn.query(
      `SELECT attachment_url 
       FROM tbl_purchase 
       WHERE purchase_id = $1`,
      [purchaseId]
    );

  const attachmentURL = purchaseData.rows[0]?.attachment_url ?? [];

if (Array.isArray(attachmentURL)) {
  for (const file of attachmentURL) {
    if (file?.name) {
      await deleteFileFromMinIO(file.name);
    }
  }
}

      const paymentResult = await conn.query(
      `SELECT payment_id 
       FROM tbl_payment 
       WHERE source_id = $1`,
      [purchaseId]
    );

    const paymentId = paymentResult.rows.length
      ? paymentResult.rows[0].payment_id
      : null;

    // 2) If payment exists → delete payment history
    if (paymentId) {
      await conn.query(
        `DELETE FROM tbl_payment_history
         WHERE payment_id = $1`,
        [paymentId]
      );

      // 3) Delete main payment record
      await conn.query(
        `DELETE FROM tbl_payment
         WHERE payment_id = $1`,
        [paymentId]
      );
    }

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

exports.getOrdersSummary = async (zodu_id, branch_id, start_date, end_date, options = {}) => {
  try {
    let {
      page = 1,
      limit = 10,
      sortBy = "order_date",
      sortOrder = "desc",
      search = "",
      reportView = "normal", // normal | monthwise | yearwise
      year = new Date().getFullYear(),
    } = options;

    if (!orderSortFields.includes(sortBy)) sortBy = "order_date";
    if (!["asc", "desc"].includes(sortOrder.toLowerCase())) sortOrder = "desc";

    const offset = (page - 1) * limit;

    /* ================= MONTHWISE ================= */
if (reportView === "monthwise") {
  const selectedYear = Number(options.year) || new Date().getFullYear();

  const chart = await conn.query(
    `
    SELECT
      TO_CHAR(order_date,'Mon, YYYY') AS month,
      EXTRACT(MONTH FROM order_date) AS month_no,
      COUNT(*) AS total_orders,
      COALESCE(SUM(total_amt),0) AS total_amount
    FROM tbl_orders
    WHERE zodu_id=$1
      AND branch_id=$2
      AND final_payment=TRUE
      AND EXTRACT(YEAR FROM order_date) = $3
    GROUP BY month, month_no
    ORDER BY month_no
    LIMIT $4 OFFSET $5
    `,
    [zodu_id, branch_id, selectedYear, limit, offset]
  );

  const summary = await conn.query(
    `
    SELECT COUNT(*) AS total_orders,
           COALESCE(SUM(total_amt),0) AS total_amount
    FROM tbl_orders
    WHERE zodu_id=$1
      AND branch_id=$2
      AND final_payment=TRUE
      AND EXTRACT(YEAR FROM order_date) = $3
    `,
    [zodu_id, branch_id, selectedYear]
  );

  const count = await conn.query(
    `
    SELECT COUNT(DISTINCT EXTRACT(MONTH FROM order_date)) AS total
    FROM tbl_orders
    WHERE zodu_id=$1
      AND branch_id=$2
      AND final_payment=TRUE
      AND EXTRACT(YEAR FROM order_date) = $3
    `,
    [zodu_id, branch_id, selectedYear]
  );

  const total = Number(count.rows[0].total  || 0);
const totalPages = Math.ceil(total / limit);

  return {
    success: true,
    data: { summary: summary.rows[0], chart: chart.rows },
    pagination: { page, limit, total: Number(count.rows[0].total), totalPages }
  };
}


    /* ================= YEARWISE ================= */
    if (reportView === "yearwise") {
      const chart = await conn.query(
        `
        SELECT
          EXTRACT(YEAR FROM order_date) AS year,
          COUNT(*) AS total_orders,
          COALESCE(SUM(total_amt),0) AS total_amount
        FROM tbl_orders
        WHERE zodu_id=$1 AND branch_id=$2
          AND final_payment=TRUE
        GROUP BY year
        ORDER BY year
        LIMIT $3 OFFSET $4
        `,
        [zodu_id, branch_id, limit, offset]
      );

      const summary = await conn.query(
        `
        SELECT COUNT(*) AS total_orders,
               COALESCE(SUM(total_amt),0) AS total_amount
        FROM tbl_orders
        WHERE zodu_id=$1 AND branch_id=$2
          AND final_payment=TRUE
        `,
        [zodu_id, branch_id]
      );

      const count = await conn.query(
        `
        SELECT COUNT(DISTINCT EXTRACT(YEAR FROM order_date)) AS total
        FROM tbl_orders
        WHERE zodu_id=$1 AND branch_id=$2
          AND final_payment=TRUE
        `,
        [zodu_id, branch_id]
      );
const totalPages = Math.ceil(Number(count.rows[0].total) / limit);

      return { success: true, data: { summary: summary.rows[0], chart: chart.rows },
        pagination: { page, limit, total: Number(count.rows[0].total), totalPages } };
    }

    /* ================= DATEWISE (NORMAL) ================= */
    const result = await conn.query(
      `
      WITH base AS (
        SELECT order_id,  TO_CHAR(created_at, 'DD Mon YYYY, HH12:MI AM (Dy)') AS order_date, customer_name, total_amt, no_of_items,payment_type
        FROM tbl_orders
        WHERE zodu_id=$1 AND branch_id=$2
          AND final_payment=TRUE
          AND order_date BETWEEN $3 AND $4
          AND (
            $7='' OR order_id ILIKE '%'||$7||'%' OR customer_name ILIKE '%'||$7||'%'
          )
      ),
      summary AS (
        SELECT COUNT(*) AS total_orders,
               COALESCE(SUM(total_amt),0) AS total_amount,
               COALESCE(SUM(no_of_items),0) AS total_quantity
        FROM base
      ),
      list AS (
        SELECT * FROM base
        ORDER BY ${sortBy} ${sortOrder}
        LIMIT $5 OFFSET $6
      )
      SELECT s.*, COALESCE((SELECT json_agg(l) FROM list l),'[]') AS orders
      FROM summary s;
      `,
      [zodu_id, branch_id, start_date, end_date, limit, offset, search]
    );
const total = Number(result.rows[0].total_orders);
const totalPages = Math.ceil(total / limit);
    return { success: true, data: result.rows[0], pagination: { page, limit, total, totalPages } };

  } catch (err) {
    console.error("Orders Repo Error:", err);
    return { success: false, message: err.message };
  }
};



exports.getPurchaseSummary = async (zodu_id, branch_id, start_date, end_date, options = {}) => {
  try {
    let { page=1, limit=10, sortOrder="desc", search="", reportView="normal" } = options;
    const selectedYear = Number(options.year) || new Date().getFullYear();
    const offset = (page-1)*limit;

    if (reportView==="monthwise") {
      const chart = await conn.query(`
        SELECT TO_CHAR(p.purchase_date,'Mon, YYYY') AS month,
               EXTRACT(MONTH FROM p.purchase_date) AS month_no,
               COUNT(*) AS total_items,
               COALESCE(SUM(pay.total_amount),0) AS total_amount
        FROM tbl_purchase p
        LEFT JOIN tbl_payment pay
          ON pay.source_type='purchase' AND pay.source_id=p.purchase_id
         AND pay.branch_id=p.branch_id AND pay.zodu_id=p.zodu_id
        WHERE p.zodu_id=$1 AND p.branch_id=$2
          AND EXTRACT(YEAR FROM p.purchase_date)=$3
        GROUP BY month, month_no ORDER BY month_no
        LIMIT $4 OFFSET $5`,
        [zodu_id, branch_id, selectedYear, limit, offset]
      );

      const summary = await conn.query(`
        SELECT COUNT(*) AS total_items,
               COALESCE(SUM(pay.total_amount),0) AS total_amount
        FROM tbl_purchase p
        LEFT JOIN tbl_payment pay
          ON pay.source_type='purchase' AND pay.source_id=p.purchase_id
         AND pay.branch_id=p.branch_id AND pay.zodu_id=p.zodu_id
        WHERE p.zodu_id=$1 AND p.branch_id=$2
          AND EXTRACT(YEAR FROM p.purchase_date)=$3`,
        [zodu_id, branch_id, selectedYear]
      );

      const count = await conn.query(`
        SELECT COUNT(DISTINCT EXTRACT(MONTH FROM purchase_date)) AS total
        FROM tbl_purchase
        WHERE zodu_id=$1 AND branch_id=$2
          AND EXTRACT(YEAR FROM purchase_date)=$3`,
        [zodu_id, branch_id, selectedYear]
      );

      const total = Number(count.rows[0].total);
      const totalPages = Math.ceil(total / limit);

      return { success:true, data:{ summary:summary.rows[0], chart:chart.rows },
        pagination:{ page, limit, total, totalPages } };
    }

    if (reportView === "yearwise") {
      const chart = await conn.query(`
        SELECT EXTRACT(YEAR FROM p.purchase_date) AS year,
               COUNT(*) AS total_items,
               COALESCE(SUM(pay.total_amount),0) AS total_amount
        FROM tbl_purchase p
        LEFT JOIN tbl_payment pay
          ON pay.source_type='purchase'
         AND pay.source_id=p.purchase_id
         AND pay.branch_id=p.branch_id
         AND pay.zodu_id=p.zodu_id
        WHERE p.zodu_id=$1 AND p.branch_id=$2
        GROUP BY year
        ORDER BY year DESC
        LIMIT $3 OFFSET $4
      `,[zodu_id, branch_id, limit, offset]);

      const summary = await conn.query(`
        SELECT COUNT(*) AS total_items,
               COALESCE(SUM(pay.total_amount),0) AS total_amount
        FROM tbl_purchase p
        LEFT JOIN tbl_payment pay
          ON pay.source_type='purchase'
         AND pay.source_id=p.purchase_id
         AND pay.branch_id=p.branch_id
         AND pay.zodu_id=p.zodu_id
        WHERE p.zodu_id=$1 AND p.branch_id=$2
      `,[zodu_id, branch_id]);

      const count = await conn.query(`
        SELECT COUNT(DISTINCT EXTRACT(YEAR FROM purchase_date)) AS total
        FROM tbl_purchase
        WHERE zodu_id=$1 AND branch_id=$2
      `,[zodu_id, branch_id]);

      const total = Number(count.rows[0].total);
      const totalPages = Math.ceil(total / limit);

      return { success:true, data:{ summary:summary.rows[0], chart:chart.rows },
        pagination:{ page, limit, total, totalPages } };
    }

    const result = await conn.query(`
      WITH base AS (
        SELECT p.purchase_id,
               TO_CHAR(p.updated_at,'DD Mon YYYY, HH12:MI AM (Dy)') AS purchase_date,
               COALESCE(pay.total_amount,0) AS total_amount,
               COALESCE(pay.paid_amount,0) AS paid_amount,
               (COALESCE(pay.total_amount,0)-COALESCE(pay.paid_amount,0)) AS due_amount,
               p.purchase_date AS sort_date
        FROM tbl_purchase p
        LEFT JOIN tbl_payment pay
          ON pay.source_type='purchase' AND pay.source_id=p.purchase_id
         AND pay.branch_id=p.branch_id AND pay.zodu_id=p.zodu_id
        WHERE p.zodu_id=$1 AND p.branch_id=$2
          AND p.purchase_date BETWEEN $3 AND $4
          AND ($7='' OR p.purchase_id ILIKE '%'||$7||'%')
      ),
      summary AS (
        SELECT COUNT(*) AS total_records,
               COALESCE(SUM(total_amount),0) AS total_amount,
               COALESCE(SUM(paid_amount),0) AS total_paid,
               COALESCE(SUM(due_amount),0) AS total_due
        FROM base
      ),
      list AS (
        SELECT * FROM base
        ORDER BY sort_date ${sortOrder}
        LIMIT $5 OFFSET $6
      )
      SELECT s.*, COALESCE((SELECT json_agg(l) FROM list l),'[]') AS list
      FROM summary s;
    `,[zodu_id, branch_id, start_date, end_date, limit, offset, search]);

    const total = Number(result.rows[0].total_records);
    const totalPages = Math.ceil(total / limit);

    return { success:true, data:result.rows[0], pagination:{ page, limit, total, totalPages } };

  } catch (err) {
    console.error("Purchase Repo Error:", err);
    return { success:false, message:err.message };
  }
};



/* ============================= EXPENSE ============================= */

exports.getExpenseSummary = async (zodu_id, branch_id, start_date, end_date, options = {}) => {
  try {
    let { page=1, limit=10, sortOrder="desc", search="", reportView="normal" } = options;
    const selectedYear = Number(options.year) || new Date().getFullYear();
    const offset = (page-1)*limit;

    if (reportView==="monthwise") {
      const chart = await conn.query(`
        SELECT TO_CHAR(e.expense_date,'Mon, YYYY') AS month,
               EXTRACT(MONTH FROM e.expense_date) AS month_no,
               COUNT(*) AS total_items,
               COALESCE(SUM(pay.total_amount),0) AS total_amount
        FROM tbl_expense e
        LEFT JOIN tbl_payment pay
          ON pay.source_type='expense' AND pay.source_id=e.expense_id
         AND pay.branch_id=e.branch_id AND pay.zodu_id=e.zodu_id
        WHERE e.zodu_id=$1 AND e.branch_id=$2
          AND EXTRACT(YEAR FROM e.expense_date)=$3
        GROUP BY month, month_no ORDER BY month_no
        LIMIT $4 OFFSET $5`,
        [zodu_id, branch_id, selectedYear, limit, offset]
      );

      const summary = await conn.query(`
        SELECT COUNT(*) AS total_items,
               COALESCE(SUM(pay.total_amount),0) AS total_amount
        FROM tbl_expense e
        LEFT JOIN tbl_payment pay
          ON pay.source_type='expense' AND pay.source_id=e.expense_id
         AND pay.branch_id=e.branch_id AND pay.zodu_id=e.zodu_id
        WHERE e.zodu_id=$1 AND e.branch_id=$2
          AND EXTRACT(YEAR FROM e.expense_date)=$3`,
        [zodu_id, branch_id, selectedYear]
      );

      const count = await conn.query(`
        SELECT COUNT(DISTINCT EXTRACT(MONTH FROM expense_date)) AS total
        FROM tbl_expense
        WHERE zodu_id=$1 AND branch_id=$2
          AND EXTRACT(YEAR FROM expense_date)=$3`,
        [zodu_id, branch_id, selectedYear]
      );

      const total = Number(count.rows[0].total);
      const totalPages = Math.ceil(total / limit);

      return { success:true, data:{ summary:summary.rows[0], chart:chart.rows },
        pagination:{ page, limit, total, totalPages } };
    }

    if (reportView === "yearwise") {
      const chart = await conn.query(`
        SELECT EXTRACT(YEAR FROM e.expense_date) AS year,
               COUNT(*) AS total_items,
               COALESCE(SUM(pay.total_amount),0) AS total_amount
        FROM tbl_expense e
        LEFT JOIN tbl_payment pay
          ON pay.source_type='expense'
         AND pay.source_id=e.expense_id
         AND pay.branch_id=e.branch_id
         AND pay.zodu_id=e.zodu_id
        WHERE e.zodu_id=$1 AND e.branch_id=$2
        GROUP BY year
        ORDER BY year DESC
        LIMIT $3 OFFSET $4
      `,[zodu_id, branch_id, limit, offset]);

      const summary = await conn.query(`
        SELECT COUNT(*) AS total_items,
               COALESCE(SUM(pay.total_amount),0) AS total_amount
        FROM tbl_expense e
        LEFT JOIN tbl_payment pay
          ON pay.source_type='expense'
         AND pay.source_id=e.expense_id
         AND pay.branch_id=e.branch_id
         AND pay.zodu_id=e.zodu_id
        WHERE e.zodu_id=$1 AND e.branch_id=$2
      `,[zodu_id, branch_id]);

      const count = await conn.query(`
        SELECT COUNT(DISTINCT EXTRACT(YEAR FROM expense_date)) AS total
        FROM tbl_expense
        WHERE zodu_id=$1 AND branch_id=$2
      `,[zodu_id, branch_id]);

      const total = Number(count.rows[0].total);
      const totalPages = Math.ceil(total / limit);

      return { success:true, data:{ summary:summary.rows[0], chart:chart.rows },
        pagination:{ page, limit, total, totalPages } };
    }


  const result = await conn.query(`
  WITH base AS (
    SELECT 
      e.expense_id,
      TO_CHAR(e.updated_at,'DD Mon YYYY, HH12:MI AM (Dy)') AS expense_date,

      COALESCE(ec.category_name, 'Others') AS expense_name,

      COALESCE(pay.total_amount,0) AS total_amount,
      COALESCE(pay.paid_amount,0) AS paid_amount,
      (COALESCE(pay.total_amount,0)-COALESCE(pay.paid_amount,0)) AS due_amount,

      e.expense_date AS sort_date
    FROM tbl_expense e
    LEFT JOIN tbl_expense_category ec
      ON ec.id = e.category_id
    LEFT JOIN tbl_payment pay
      ON pay.source_type='expense'
     AND pay.source_id=e.expense_id
     AND pay.branch_id=e.branch_id
     AND pay.zodu_id=e.zodu_id
    WHERE e.zodu_id=$1 
      AND e.branch_id=$2
      AND e.expense_date BETWEEN $3 AND $4
      AND (
        $7='' 
        OR e.expense_id ILIKE '%'||$7||'%' 
        OR ec.category_name ILIKE '%'||$7||'%'
      )
  ),
  summary AS (
    SELECT 
      COUNT(*) AS total_records,
      COALESCE(SUM(total_amount),0) AS total_amount,
      COALESCE(SUM(paid_amount),0) AS total_paid,
      COALESCE(SUM(due_amount),0) AS total_due
    FROM base
  ),
  list AS (
    SELECT * 
    FROM base
    ORDER BY sort_date ${sortOrder}
    LIMIT $5 OFFSET $6
  )
  SELECT 
    s.*, 
    COALESCE((SELECT json_agg(l) FROM list l),'[]') AS list
  FROM summary s;
`, [
  zodu_id,
  branch_id,
  start_date,
  end_date,
  limit,
  offset,
  search
]);


    const total = Number(result.rows[0].total_records);
    const totalPages = Math.ceil(total / limit);

    return { success:true, data:result.rows[0], pagination:{ page, limit, total, totalPages } };

  } catch (err) {
    console.error("Expense Repo Error:", err);
    return { success:false, message:err.message };
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
      search = "",
      stockFilter = "all" // all | available | low
    } = options;

    const offset = (page - 1) * limit;

    const allowedSortColumns = ["item_name", "stock_qty", "updated_at"];
    const sortColumn = allowedSortColumns.includes(sortBy)
      ? sortBy
      : "updated_at";
    const order = sortOrder.toLowerCase() === "asc" ? "ASC" : "DESC";

    /* ======================
       STOCK FILTER CONDITION
       (ONLY FOR LIST)
    ====================== */
    let stockCondition = "";
    if (stockFilter === "available") {
      stockCondition = "AND stock_qty > 0";
    } else if (stockFilter === "low") {
      stockCondition = "AND stock_qty > 0 AND stock_qty <= stock_alert";
    }

    const query = `
      WITH used_stock AS (
        SELECT
          oi.item_id,
          SUM(oi.qty) AS used_qty
        FROM tbl_ordered_items oi
        JOIN tbl_orders o ON o.api_order_id = oi.api_order_id
        WHERE o.zodu_id = $1
          AND o.branch_id = $2
          AND o.final_payment = TRUE
        GROUP BY oi.item_id
      ),

      inventory_base AS (
        SELECT
          i.inventory_id,
          i.item_id,
          i.item_name,
          i.stock_qty,
          i.stock_alert,
          i.purchase_price,
          i.selling_price,
          TO_CHAR(i.updated_at,'DD-Mon-YYYY HH12:MI AM (Dy)') AS updated_at,
          i.category_id,
          COALESCE(c.name, 'Others') AS category_name,
          COALESCE(u.short_name, '-') AS unit_name,
          COALESCE(us.used_qty, 0) AS used_qty,
          (i.stock_qty * i.purchase_price) AS total_amount
        FROM tbl_inventory i
        LEFT JOIN tbl_category c ON c.id = i.category_id
        LEFT JOIN tbl_units u ON u.id = i.item_unit
        LEFT JOIN used_stock us ON us.item_id = i.item_id
        WHERE i.zodu_id = $1
          AND i.branch_id = $2
          AND (
            $5 = '' OR
            i.item_name ILIKE '%'||$5||'%' OR
            i.item_id ILIKE '%'||$5||'%' OR
            c.name ILIKE '%'||$5||'%'
          )
      ),

     summary AS (
  SELECT
    COUNT(*) AS total_items,

    COUNT(*) FILTER (WHERE COALESCE(stock_qty,0) > stock_alert) AS in_stock,

    COUNT(*) FILTER (
      WHERE COALESCE(stock_qty,0) > 0
        AND COALESCE(stock_qty,0) <= stock_alert
    ) AS low_stock,

    COUNT(*) FILTER (WHERE COALESCE(stock_qty,0) = 0) AS out_of_stock,

    COALESCE(SUM(COALESCE(stock_qty,0) * purchase_price), 0) AS total_stock_value
  FROM inventory_base
)
      ,

      inventory_list AS (
        SELECT *
        FROM inventory_base
        WHERE 1=1
          ${stockCondition}
        ORDER BY ${sortColumn} ${order}
        LIMIT $3 OFFSET $4
      ),

      category_item_agg AS (
        SELECT
          category_name,
          item_name,
          SUM(stock_qty) AS total_qty,
          SUM(used_qty) AS used_qty,
          SUM(stock_qty * purchase_price) AS total_amount,
          unit_name
        FROM inventory_base
        GROUP BY category_name, item_name, unit_name
      ),

      category_wise_summary AS (
        SELECT
          category_name,
          SUM(total_qty) AS total_qty,
          SUM(used_qty) AS used_qty,
          SUM(total_amount) AS total_amount,
          JSON_AGG(
            json_build_object(
              'item_name', item_name,
              'qty', total_qty,
              'used_qty', used_qty,
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
      limit,
      offset,
      search,
    ]);

    const countResult = await conn.query(
      `
        SELECT COUNT(*) AS total
        FROM tbl_inventory i
        LEFT JOIN tbl_category c ON c.id = i.category_id
        WHERE i.zodu_id = $1
          AND i.branch_id = $2
          ${
            stockFilter === "available"
              ? "AND i.stock_qty > 0"
              : stockFilter === "low"
              ? "AND i.stock_qty > 0 AND i.stock_qty <= i.stock_alert"
              : ""
          }
          AND (
            $3 = '' OR
            i.item_name ILIKE '%'||$3||'%' OR
            i.item_id ILIKE '%'||$3||'%' OR
            c.name ILIKE '%'||$3||'%'
          )
      `,
      [zodu_id, branch_id, search]
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






// ── Create hold header ────────────────────────────────────────
exports.createHold = async (data) => {
  const {
    zodu_id, branch_id, order_type, table_no, notes,
    customer_uuid, customer_name, customer_phone,
    total_items, subtotal, total_tax,
    discount_type, discount_value, discount_amount,
    round_off, total_amount,
  } = data;

  // hold_id: H-<epoch ms> scoped unique per branch
  const hold_id = `H-${Date.now()}`;

  const query = `
    INSERT INTO tbl_hold (
      hold_id, zodu_id, branch_id, order_type, table_no, notes,
      customer_uuid, customer_name, customer_phone,
      total_items, subtotal, total_tax,
      discount_type, discount_value, discount_amount,
      round_off, total_amount, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,
      $7,$8,$9,
      $10,$11,$12,
      $13,$14,$15,
      $16,$17, CURRENT_TIMESTAMP
    )
    RETURNING hold_uuid
  `;

  const result = await conn.query(query, [
    hold_id, zodu_id, branch_id, order_type, table_no || null, notes || null,
    customer_uuid || null, customer_name || null, customer_phone || null,
    total_items, subtotal, total_tax,
    discount_type || null, discount_value, discount_amount,
    round_off, total_amount,
  ]);

  return result.rows[0].hold_uuid;  // ✅ return uuid, not serial
};

// ── Bulk insert hold items ────────────────────────────────────
exports.insertHoldItems = async (hold_uuid, items) => {
  // Build a single multi-row INSERT instead of N round-trips
  const values = [];
  const params = [];
  let   idx    = 1;

  for (const item of items) {
    values.push(`(
      $${idx++},$${idx++},$${idx++},$${idx++},$${idx++},
      $${idx++},$${idx++},$${idx++},$${idx++},$${idx++},
      $${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++}
    )`);
    params.push(
      hold_uuid,
      item.item_uuid    || null,
      item.item_id,
      item.item_name,
      item.variant_id   || null,
      item.variant_name || null,
      item.unit         || null,
      item.quantity,
      item.price,
      item.mrp          ?? null,
      item.discount     || 0,
      item.hsn_code     || null,
      item.gst_percentage || 0,
      item.tax_amount   || 0,
      item.cgst         || 0,
      item.sgst         || 0,
      item.tax_inclusive || false
    );
  }

  const query = `
    INSERT INTO tbl_hold_items (
      hold_uuid, item_uuid, item_id, item_name,
      variant_id, variant_name, unit,
      quantity, price, mrp, discount,
      hsn_code, gst_percentage, tax_amount, cgst, sgst,tax_inclusive
    ) VALUES ${values.join(",")}
  `;

  await conn.query(query, params);
};

// ── Delete hold (CASCADE removes items automatically) ─────────
exports.deleteHold = async (hold_uuid) => {
  await conn.query(
    `DELETE FROM tbl_hold WHERE hold_uuid = $1`,
    [hold_uuid]
  );
};

// ── Get all holds for a branch ────────────────────────────────
exports.getHoldsByBranch = async (zodu_id, branch_id) => {
  console.log("from da",zodu_id,branch_id)
  const result = await conn.query(
    `SELECT h.*, 
            json_agg(hi ORDER BY hi.id) AS items
     FROM tbl_hold h
     LEFT JOIN tbl_hold_items hi ON hi.hold_uuid = h.hold_uuid
     WHERE h.zodu_id = $1 AND h.branch_id = $2
     GROUP BY h.hold_uuid
     ORDER BY h.created_at DESC`,
    [zodu_id, branch_id]
  );
  return result.rows;
};

exports.ensurePaymentForSource = async ({
  zodu_id,
  branch_id,
  source_type,   // 'purchase' | 'expense'
  source_id,     // purchase_id or expense_id
  total_amount,
}) => {
  // 1) Check if already exists
  const existing = await conn.query(
    `
    SELECT *
    FROM tbl_payment
    WHERE zodu_id = $1
      AND branch_id = $2
      AND source_type = $3
      AND source_id = $4
    `,
    [zodu_id, branch_id, source_type, source_id]
  );

  if (existing.rows.length > 0) {
    const row = existing.rows[0];

    // If total changed, update it (paid + status will be handled via trigger/history)
    if (Number(row.total_amount) !== Number(total_amount)) {
      const updated = await conn.query(
        `
        UPDATE tbl_payment
        SET total_amount = $1
         WHERE payment_id = $2
        RETURNING *
        `,
        [total_amount, row.payment_id]
      );
      return updated.rows[0];
    }

    return row;
  }

  // 2) Create new payment row
  const created = await conn.query(
    `
    INSERT INTO tbl_payment
      (zodu_id, branch_id, source_type, source_id, total_amount, paid_amount, status)
    VALUES
      ($1, $2, $3, $4, $5, 0, 'pending')
    RETURNING *
    `,
    [zodu_id, branch_id, source_type, source_id, total_amount]
  );

  return created.rows[0];
};


exports.insertPaymentHistory = async ({
  payment_id,
  zodu_id,
  branch_id,
  paid_amount,
  payment_type,
  paid_date = null, // yyyy-mm-dd, optional
}) => {
  const result = await conn.query(
    `
    INSERT INTO tbl_payment_history
      (payment_id, paid_amount, payment_mode, paid_date)
    VALUES
      ($1, $2, $3,  COALESCE($4, CURRENT_DATE))
    RETURNING *
    `,
    [
      payment_id,
      paid_amount,
      payment_type,
      paid_date,
    ]
  );

  return result.rows[0];
};


exports.getPaymentBySource = async (zodu_id, branch_id, source_id) => {
  const result = await conn.query(
    `SELECT * FROM tbl_payment
     WHERE zodu_id=$1 AND branch_id=$2 AND source_type='sale' AND source_id=$3`,
    [zodu_id, branch_id, source_id]
  );

  return result.rows[0];
};

exports.createPayment = async ({
  zodu_id,
  branch_id,
  source_id,
  total_amount,
}) => {

  const result = await conn.query(
    `INSERT INTO tbl_payment
     (source_type, source_id, zodu_id, branch_id, total_amount)
     VALUES ('sale',$1,$2,$3,$4)
     RETURNING *`,
    [source_id, zodu_id, branch_id, total_amount]
  );

  return result.rows[0];
};

exports.insertPaymentHistory = async ({
  payment_id,
  paid_amount,
  paid_date,
  payment_mode,
  transaction_id,
}) => {

  await conn.query(
    `INSERT INTO tbl_payment_history
     (payment_id, paid_amount, paid_date, payment_mode, transaction_id)
     VALUES ($1,$2,$3,$4,$5)`,
    [payment_id, paid_amount, paid_date, payment_mode, transaction_id]
  );
};

exports.updatePaymentAmount = async (payment_id, paid_amount) => {

  await conn.query(
    `UPDATE tbl_payment
     SET paid_amount = paid_amount + $1,
         status = CASE
            WHEN (paid_amount + $1) >= total_amount THEN 'paid'
            ELSE 'partial'
         END,
         updated_at = CURRENT_TIMESTAMP
     WHERE payment_id=$2`,
    [paid_amount, payment_id]
  );
};

exports.updateSalePayment = async (sale_id, paid_amount) => {

  await conn.query(
    `
    UPDATE tbl_sales
    SET
      paid_amount = paid_amount + $1,
      balance_amount = total_amount - (paid_amount + $1),
      payment_status =
        CASE
          WHEN (paid_amount + $1) >= total_amount THEN 'fully_paid'
          WHEN (paid_amount + $1) > 0 THEN 'partial_paid'
          ELSE 'pending'
        END
    WHERE sale_id = $2
    `,
    [paid_amount, sale_id]
  );
};


exports.getCustomerInfo = async ({ custUuid, branchId, zoduId }) => {
  // ✅ FIX: was `conn.query(...)` — now `db.query(...)` (consistent)
  const { rows } = await conn.query(
    `SELECT
       cust_uuid,
       cust_id,
       cust_name,
       cpy_name,
       mobile_no,
       email_id,
       opening_balance
     FROM tbl_customer
     WHERE cust_uuid = $1
       AND zodu_id   = $2
       AND branch_id = $3
     LIMIT 1`,
    [custUuid, zoduId, branchId]
  );
  return rows[0] || null;
};
 
// ─────────────────────────────────────────────────────────────────────────────
 
exports.getSalesRows = async ({ custUuid, branchId, zoduId, fromDate, toDate }) => {
  const params = [custUuid, zoduId, branchId];
  let dateClause = '';

  if (fromDate && toDate) {
    params.push(fromDate, toDate);
    dateClause = `AND s.sale_date BETWEEN $${params.length - 1} AND $${params.length}`;
  } else if (fromDate) {
    params.push(fromDate);
    dateClause = `AND s.sale_date >= $${params.length}`;
  } else if (toDate) {
    params.push(toDate);
    dateClause = `AND s.sale_date <= $${params.length}`;
  }

  const { rows } = await conn.query(
    `SELECT
       s.sale_uuid        AS doc_uuid,
       s.sale_id          AS doc_id,
       'SALE'             AS doc_type,
       s.sale_type        AS description,
      TO_CHAR(s.created_at,'DD Mon YYYY, HH12:MI AM (Dy)') AS doc_date,
       s.total_amount,
       s.paid_amount,
       s.balance_amount,
       s.payment_status,
       TO_CHAR(s.due_date,'DD Mon YYYY') AS due_date
     FROM tbl_sales s
     WHERE s.customer_uuid = $1
       AND s.zodu_id        = $2
       AND s.branch_id      = $3
       AND s.sale_type      = 'S'         -- ✅ exclude quotations (Q), invoices only
       ${dateClause}
     ORDER BY s.sale_date DESC, s.created_at DESC`,
    params
  );
  return rows;
};
 
// ─────────────────────────────────────────────────────────────────────────────
 
exports.getSaleReturnRows = async ({ custUuid, branchId, zoduId, fromDate, toDate }) => {
  const params = [custUuid, zoduId, branchId];
  let dateClause = '';
 
  if (fromDate && toDate) {
    params.push(fromDate, toDate);
    dateClause = `AND r.return_date BETWEEN $${params.length - 1} AND $${params.length}`;
  } else if (fromDate) {
    params.push(fromDate);
    dateClause = `AND r.return_date >= $${params.length}`;
  } else if (toDate) {
    params.push(toDate);
    dateClause = `AND r.return_date <= $${params.length}`;
  }
 
  const { rows } = await conn.query(
    `SELECT
       r.return_uuid                  AS doc_uuid,
       r.return_id                    AS doc_id,
       'RETURN'                       AS doc_type,
       COALESCE(r.return_reason,
                'Sales Return')       AS description,
       TO_CHAR(r.created_at,'DD Mon YYYY, HH12:MI AM (Dy)') AS doc_date,
       -(r.return_amount)             AS total_amount,
       0::numeric                     AS paid_amount,
       -(r.return_amount)             AS balance_amount,
       r.refund_type,
       r.original_sale_id
     FROM tbl_sale_returns r
     WHERE r.customer_id = $1
       AND r.zodu_id      = $2
       AND r.branch_id    = $3
       ${dateClause}
     ORDER BY r.return_date DESC, r.created_at DESC`,
    params
  );
  return rows;
};
 
// ─────────────────────────────────────────────────────────────────────────────
 
exports.getPaymentHistory = async ({ custUuid, branchId, zoduId, fromDate, toDate, method }) => {
  const params = [custUuid, zoduId, branchId];
  let dateClause   = '';
  let methodClause = '';
 
  if (fromDate && toDate) {
    params.push(fromDate, toDate);
    dateClause = `AND sp.payment_date BETWEEN $${params.length - 1} AND $${params.length}`;
  } else if (fromDate) {
    params.push(fromDate);
    dateClause = `AND sp.payment_date >= $${params.length}`;
  } else if (toDate) {
    params.push(toDate);
    dateClause = `AND sp.payment_date <= $${params.length}`;
  }
 
  if (method && method !== 'all') {
    params.push(method);
    methodClause = `AND LOWER(sp.transaction_type) = LOWER($${params.length})`;
  }
 
  const { rows } = await conn.query(
    `SELECT
       sp.payment_id,
       sp.payment_date,
       sp.sale_id          AS invoice_id,
       sp.transaction_type,
       sp.paid_amount      AS amount,
       sp.status,
       sp.transaction_id,
       TO_CHAR(sp.created_at,'DD Mon YYYY, HH12:MI AM (Dy)') AS created_at
     FROM tbl_sale_payment sp
     INNER JOIN tbl_sales s
        ON  s.sale_id    = sp.sale_id
        AND s.branch_id  = sp.branch_id
        AND s.zodu_id    = sp.zodu_id
     WHERE s.customer_uuid = $1
       AND sp.zodu_id       = $2
       AND sp.branch_id     = $3
       ${dateClause}
       ${methodClause}
     ORDER BY sp.payment_date DESC, sp.created_at DESC`,
    params
  );
  return rows;
};
 
// ─────────────────────────────────────────────────────────────────────────────
 
// ✅ FIX: removed `async` — this is pure in-memory computation,
//         no I/O, no await. Calling it with `await` was silently
//         wrapping the return value in a resolved Promise (harmless
//         but misleading — and forces callers to always await it).
exports.computeSummary = (salesRows, returnRows) => {
  const grossTotal   = salesRows.reduce((s, r) => s + parseFloat(r.total_amount   || 0), 0);
  const totalPaid    = salesRows.reduce((s, r) => s + parseFloat(r.paid_amount    || 0), 0);
  const totalBalance = salesRows.reduce((s, r) => s + parseFloat(r.balance_amount || 0), 0);
  const totalReturns = returnRows.reduce((s, r) => s + parseFloat(r.total_amount  || 0), 0);

  return {
    total_invoice:   salesRows.length,
    gross_total:     +grossTotal.toFixed(2),
    total_paid:      +totalPaid.toFixed(2),
    total_balance:   +totalBalance.toFixed(2),
    total_returns:   +totalReturns.toFixed(2),
    net_outstanding: +(totalBalance + totalReturns).toFixed(2),
  };
};
