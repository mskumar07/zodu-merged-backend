const moment = require('moment/moment');
const { get, search } = require('../api/restaurant-controller');
const conn = require('../database/connection');
const { randomUUID } = require("crypto");
const { deleteFileFromMinIO } = require('../services/restaurant-service');
const { calculateItemTax } = require('../utils/gstcalcukator');
const { generatePublicOrderNo } = require('./generatePublicOrderNo');

// ========== Company Repository Functions ==========

const purchaseSortFields = ["purchase_date", "purchase_id"];
const expenseSortFields = ["expense_date", "expense_id"];
const orderSortFields = ["order_date", "order_id", "total_amt", "no_of_items"];



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



// exports.get_all_report_data = async (zodu_id, branch_id, page = 1, limit = 10, filtered_type, start_date, end_date, year) => {
//   try {
//     const offset = (page - 1) * limit;
//     const isDateWise = filtered_type === "date_wise" ;
//     const isMonthYearWise = filtered_type === "month_year_wise";

//     // ─── month_year_wise: single query with window functions for totals ───
//     if (isMonthYearWise) {
//       const monthNames = [
//         "January", "February", "March", "April", "May", "June",
//         "July", "August", "September", "October", "November", "December"
//       ];

//       if (year && year !== '' && year !== 'null' && year !== 'undefined') {
//         // ---- SPECIFIC YEAR: month-wise breakdown (Jan–Dec) ----
//         const parsedYear = parseInt(year, 10);
//         const params = [zodu_id, branch_id, parsedYear];

//         const query = `
//           SELECT
//             EXTRACT(MONTH FROM created_at)::int         AS month_number,
//             COUNT(*)                                    AS total_orders,
//             COALESCE(SUM(total_amt), 0)                 AS total_amount,
//             SUM(COUNT(*)) OVER()                        AS total_count,
//             COALESCE(SUM(SUM(total_amt)) OVER(), 0)     AS all_total_amount,
//             COALESCE(SUM(SUM(no_of_items)) OVER(), 0)   AS all_items_total
//           FROM tbl_orders
//           WHERE zodu_id = $1
//             AND branch_id = $2
//             AND EXTRACT(YEAR FROM created_at)::int = $3
//           GROUP BY month_number
//           ORDER BY month_number ASC`;

//         const { rows } = await conn.query(query, params);

//         const monthMap = {};
//         let yearTotalOrders = 0;
//         let yearTotalAmount = 0;
//         const totals = rows.length > 0
//           ? { total_count: rows[0].total_count, all_total_amount: rows[0].all_total_amount, all_items_total: rows[0].all_items_total }
//           : { total_count: 0, all_total_amount: 0, all_items_total: 0 };

//         for (const row of rows) {
//           monthMap[row.month_number] = row;
//           yearTotalOrders += Number(row.total_orders);
//           yearTotalAmount += Number(row.total_amount);
//         }

//         return {
//           rows: [],
//           totals,
//           monthly_summary: [{
//             year: parsedYear,
//             total_orders: yearTotalOrders,
//             total_amount: yearTotalAmount,
//             months: monthNames.map((name, i) => ({
//               month_number: i + 1,
//               month: name,
//               total_orders: Number(monthMap[i + 1]?.total_orders || 0),
//               total_amount: Number(monthMap[i + 1]?.total_amount || 0),
//             }))
//           }],
//         };
//       }

//       // ---- NO YEAR: all years ascending, each with month-wise breakdown ----
//       const params = [zodu_id, branch_id];

//       const query = `
//         SELECT
//           EXTRACT(YEAR FROM created_at)::int            AS year,
//           EXTRACT(MONTH FROM created_at)::int           AS month_number,
//           COUNT(*)                                      AS total_orders,
//           COALESCE(SUM(total_amt), 0)                   AS total_amount,
//           SUM(COUNT(*)) OVER()                          AS total_count,
//           COALESCE(SUM(SUM(total_amt)) OVER(), 0)       AS all_total_amount,
//           COALESCE(SUM(SUM(no_of_items)) OVER(), 0)     AS all_items_total
//         FROM tbl_orders
//         WHERE zodu_id = $1
//           AND branch_id = $2
//         GROUP BY year, month_number
//         ORDER BY year ASC, month_number ASC`;

//       const { rows } = await conn.query(query, params);

//       const yearMap = {};
//       const totals = rows.length > 0
//         ? { total_count: rows[0].total_count, all_total_amount: rows[0].all_total_amount, all_items_total: rows[0].all_items_total }
//         : { total_count: 0, all_total_amount: 0, all_items_total: 0 };

//       for (const row of rows) {
//         const y = row.year;
//         if (!yearMap[y]) {
//           yearMap[y] = { total_orders: 0, total_amount: 0, months: {} };
//         }
//         yearMap[y].months[row.month_number] = row;
//         yearMap[y].total_orders += Number(row.total_orders);
//         yearMap[y].total_amount += Number(row.total_amount);
//       }

//       return {
//         rows: [],
//         totals,
//         monthly_summary: Object.keys(yearMap)
//           .sort((a, b) => a - b)
//           .map(y => ({
//             year: Number(y),
//             total_orders: yearMap[y].total_orders,
//             total_amount: yearMap[y].total_amount,
//             months: monthNames.map((name, i) => ({
//               month_number: i + 1,
//               month: name,
//               total_orders: Number(yearMap[y].months[i + 1]?.total_orders || 0),
//               total_amount: Number(yearMap[y].months[i + 1]?.total_amount || 0),
//             }))
//           })),
//       };
//     }

//     /* =====================================================
//        ALL EXPENSES / DATE WISE — CTE to scan table once
//     ===================================================== */
//     let dateFilter = "";
//     const baseParams = [zodu_id, branch_id];
//     if (isDateWise) {
//       dateFilter = ` AND created_at::date BETWEEN $3 AND $4`;
//       baseParams.push(start_date, end_date);
//     }
//     const limitIdx = `$${baseParams.length + 1}`;
//     const offsetIdx = `$${baseParams.length + 2}`;

//     const cteQuery = `
//       WITH filtered AS (
//         SELECT order_id, created_at, order_type, no_of_items, total_tax, total_amt, payment_type, order_date, order_time
//         FROM tbl_orders
//         WHERE zodu_id = $1
//           AND branch_id = $2
//           ${dateFilter}
//       ),
//       totals AS (
//         SELECT
//           COUNT(*)          AS total_count,
//           SUM(total_amt)    AS all_total_amount,
//           SUM(no_of_items)  AS all_items_total
//         FROM filtered
//       )
//       SELECT
//           TO_CHAR(
//         f.created_at,
//         'DD Mon YYYY, HH12:MI AM (Dy)'
//       ) AS created_at,
//         f.order_id,
//         f.order_type,
//         f.no_of_items,
//         f.total_tax,
//         f.total_amt,
//         f.payment_type,
//         t.total_count,
//         t.all_total_amount,
//         t.all_items_total
//       FROM filtered f, totals t
//       ORDER BY f.created_at DESC
//       LIMIT ${limitIdx} OFFSET ${offsetIdx}`;

//     const queries = [conn.query(cteQuery, [...baseParams, limit, offset])];

//     if (isDateWise) {
//       const datewiseQuery = `
//         SELECT
//           to_char(created_at::date, 'DD-Mon-YYYY') AS created_at,
//           COUNT(*)                            AS total_orders,
//           SUM(total_amt)                      AS all_total_amount
//         FROM tbl_orders
//         WHERE zodu_id = $1
//           AND branch_id = $2
//           AND created_at::date BETWEEN $3 AND $4
//         GROUP BY created_at::date
//         ORDER BY created_at::date ASC
//         LIMIT $5 OFFSET $6`;

//       queries.push(conn.query(datewiseQuery, [...baseParams, limit, offset]));
//     }

//     const results = await Promise.all(queries);

//     const listRows = results[0].rows;
//     const totals = listRows.length > 0
//       ? { total_count: listRows[0].total_count, all_total_amount: listRows[0].all_total_amount, all_items_total: listRows[0].all_items_total }
//       : { total_count: 0, all_total_amount: 0, all_items_total: 0 };

//     // Strip totals columns from row data
//     const rows = listRows.map(({ total_count, all_total_amount, all_items_total, ...row }) => row);

//     return {
//       rows,
//       totals,
//       datewise_summary: isDateWise ? results[1].rows : []
//     };
//   } catch (err) {
//     throw new Error("Unable to fetch report data: " + err.message);
//   }
// };

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
      totals AS (
        SELECT
          COUNT(*)                            AS total_count,
          COALESCE(SUM(pay.total_amount), 0)  AS all_total_amount,
          COALESCE(SUM(pay.paid_amount), 0)   AS all_total_paid,
          COALESCE(SUM(pay.balance_amount), 0) AS all_total_due
        FROM purchase_base pb
        LEFT JOIN tbl_payment pay
          ON pay.source_id   = pb.purchase_id
         AND pay.source_type = 'purchase'
         AND pay.branch_id   = pb.branch_id
         AND pay.zodu_id     = pb.zodu_id
      )
      SELECT
        pb.purchase_id,
        to_char(pb.created_at, 'DD-Mon-YYYY HH12:MI AM (Dy)') AS created_at,
        pb.vendor_name AS vendor_name,
        COALESCE(pay.total_amount, 0)  AS total_amount,
        COALESCE(pay.paid_amount, 0)   AS paid_amount,
        COALESCE(pay.balance_amount, 0) AS balance_amount,
        c.name,
        c.id AS category_id,
        t.total_count,
        t.all_total_amount,
        t.all_total_paid,
        t.all_total_due
      FROM purchase_base pb
      LEFT JOIN tbl_purchase_items pi ON pi.purchase_id = pb.purchase_id
      LEFT JOIN tbl_category c ON c.id = pi.category_id
      LEFT JOIN tbl_payment pay
        ON pay.source_id   = pb.purchase_id
       AND pay.source_type = 'purchase'
       AND pay.branch_id   = pb.branch_id
       AND pay.zodu_id     = pb.zodu_id
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





exports.getUnits = async (branch_id) => {
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

  // TOTAL COUNT
  const totalCountResult = await conn.query(
    `
    SELECT COUNT(*) AS total
    FROM tbl_menu_item m
    JOIN tbl_category c ON c.id = m.menu_category_id
    WHERE m.branch_id = $1
      AND (m.menu_name ILIKE '%' || $2 || '%' OR c.name ILIKE '%' || $2 || '%')
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
      m.menu_id,
      m.menu_name,
      m.menu_code,
      m.menu_type,
      m.menu_image,
      m.variants,
      m.sell_price,
      m.purchase_price,
      m.hsn_code,

      -- GST
      m.gst_tax AS gst_id,
      g.gst_rate AS gst_tax,

      -- UNIT
      m.menu_unit AS unit_id,
      u.name AS unit_name,
      u.short_name AS menu_unit,

      -- CATEGORY
      c.name AS category,
      m.menu_category_id AS category_id,

      -- INVENTORY
      COALESCE(i.stock_qty, 0) AS stock_qty,
      COALESCE(i.stock_alert, 0) AS stock_alert,

      -- OTHER
      m.active,
      m.food_type,
      m.tax_include_or_exclude,
      m.favorites,
      10 AS count

    FROM tbl_menu_item m
    JOIN tbl_category c 
      ON c.id = m.menu_category_id

    LEFT JOIN tbl_gst g 
      ON g.id = m.gst_tax

    LEFT JOIN tbl_units u 
      ON u.id = m.menu_unit

    LEFT JOIN tbl_inventory i
      ON i.item_id = m.menu_id
     AND i.branch_id = m.branch_id

    WHERE m.branch_id = $1
      AND (m.menu_name ILIKE '%' || $2 || '%' OR c.name ILIKE '%' || $2 || '%')

    ORDER BY c.name, m.menu_name
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

exports.get_ordered_data = async (branch_id) => {
  const query = `
    SELECT 
      o.api_order_id,
      o.legacy_order_ref,

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
        ) FILTER (WHERE i.item_id IS NOT NULL),
        '[]'
      ) AS ordered_items,

      COALESCE(
        JSON_AGG(
          DISTINCT JSONB_BUILD_OBJECT(
            'kot_no', k.kot_no,
            'item_id', k.item_id,
            'item_name', k.item_name,
            'qty', k.qty,
            'table_no', k.table_no,
            'status', k.status
          )
        ) FILTER (WHERE k.item_id IS NOT NULL),
        '[]'
      ) AS kot_items

    FROM tbl_tmp_orders o

    LEFT JOIN tbl_tmp_ordered_items i
      ON o.api_order_id = i.api_order_id

    LEFT JOIN tbl_menu_item mi
      ON i.item_id = mi.menu_id 

    LEFT JOIN tbl_kot_list k
      ON o.api_order_id = k.api_order_id

    WHERE o.branch_id = $1
      AND o.final_payment = false

    GROUP BY 
      o.api_order_id,
      o.legacy_order_ref,
      o.table_no,
      o.order_type,
      o.customer_name,
      o.customer_phone,
      o.total_amt,
      o.final_payment,
      o.branch_id,
      o.order_date,
      o.order_time

    ORDER BY o.created_at DESC;
  `;

  try {
    const { rows } = await conn.query(query, [branch_id]);
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

    console.log(menuData);

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
    // ✅ If menu_type is 'Product', add it to inventory
    if (createdMenu.menu_type && createdMenu.menu_type.toLowerCase() === 'product') {
      const existing = await conn.query(
        `SELECT item_id FROM tbl_inventory WHERE item_id = $1`,
        [createdMenu.menu_id]
      );

      const stockQty = Number(menuData.opening_stock || 0);
const stockAlert = Number(menuData.alert_stock || 0);

console.log(stockAlert,stockQty);

      if (existing.rows.length > 0) {
        // Update quantity if already exists
      await conn.query(
    `
    UPDATE tbl_inventory
    SET
      stock_qty = stock_qty + $1,
      stock_alert = $2,
      updated_at = NOW()
    WHERE item_id = $3
      AND branch_id = $4
    `,
    [
      stockQty,
      stockAlert,
      createdMenu.menu_id,
      createdMenu.branch_id
    ]
  );
      } else {
        // Insert new inventory item
        await conn.query(
          `INSERT INTO tbl_inventory (
            zodu_id, branch_id, item_id, category_id, item_name, item_unit,
            stock_qty, stock_alert, purchase_price, selling_price,inventory_type,last_purchase_date
          ) VALUES ( $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11, NOW())`,
          [
            createdMenu.zodu_id,
            createdMenu.branch_id,
            createdMenu.menu_id,
            createdMenu.menu_category_id,
            createdMenu.menu_name,
            createdMenu.menu_unit,
              stockQty,          // ✅ opening stock
      stockAlert, // default stock = 0
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


exports.getSingleOrder = async (zodu_id, branch_id, api_order_id) => {
  const query = `
    SELECT 
      o.api_order_id,
      o.public_order_no,

      o.order_date,
      o.order_time,
 TO_CHAR(
        o.created_at,
        'DD Mon YYYY, HH12:MI AM (Dy)'
      ) AS formatted_date,
      o.order_type,
      o.payment_type,
      o.customer_name,
      o.customer_phone,
      o.table_no,

      o.no_of_items,

      -- 💰 BILL SUMMARY
      o.subtotal,
      o.total_tax,
      o.discount_type,
      o.discount_value,
      o.discount_amount,
      o.total_amt,

      (
        SELECT COALESCE(
          json_agg(
            json_build_object(
              'item_name', i.item_name,
              'qty', i.qty,
              'price', i.price,
              'amount', i.total_amount,
              'unit', i.item_unit,

              -- 🧾 TAX DETAILS
              'gst_percentage', i.gst_percentage,
              'tax_amount', i.tax_amount,
              'cgst', i.cgst,
              'sgst', i.sgst,
              'tax_inclusive', i.tax_inclusive
            )
          ),
          '[]'::json
        )
        FROM tbl_ordered_items i
        WHERE i.api_order_id = o.api_order_id
      ) AS items

    FROM tbl_orders o
    WHERE o.api_order_id = $1
      AND o.zodu_id = $2
      AND o.branch_id = $3
      AND o.final_payment = true
  `;

  const result = await conn.query(query, [
    api_order_id,
    zodu_id,
    branch_id
  ]);

  return result.rows[0] || null;
};




// ✅ Create or Update Order
exports.createOrder = async (orderData) => {
  try {
    await conn.query("BEGIN");

    const api_order_id = randomUUID();
    const public_order_no =
      await generatePublicOrderNo(orderData.branch_id);

    let subtotal = 0;
    let total_tax = 0;
    let no_of_items = 0;

    for (const item of orderData.items) {
      const taxData = calculateItemTax(item);
      subtotal += taxData.subtotal;
      total_tax += taxData.tax_amount;
      no_of_items += 1;
    }

    const discountType = orderData.discount_type
      ? orderData.discount_type.toUpperCase()
      : null;

    let discount_amount = 0;
    if (discountType === "PERCENT") {
      discount_amount = (subtotal * Number(orderData.discount_value || 0)) / 100;
    } else if (discountType === "FLAT") {
      discount_amount = Number(orderData.discount_value || 0);
    }

    if (discount_amount > subtotal) discount_amount = subtotal;

    const total_amt = subtotal + total_tax - discount_amount;

    const result = await conn.query(
      `INSERT INTO tbl_orders (
        zodu_id, branch_id,
        api_order_id, public_order_no,
        table_no, order_type, no_of_items,
        customer_name, customer_phone,
        subtotal, total_tax, total_amt,
        discount_type, discount_value, discount_amount,
        final_payment, payment_type,
        order_date, order_time
      )
      VALUES (
        $1,$2,$3,$4,
        $5,$6,$7,
        $8,$9,
        $10,$11,$12,
        $13,$14,$15,
        true,$16,$17,$18
      )
      RETURNING *`,
      [
        orderData.zodu_id,
        orderData.branch_id,
        api_order_id,
        public_order_no,

        orderData.table_no,
        orderData.order_type,
        no_of_items,

        orderData.customer_name,
        orderData.customer_phone,

        subtotal,
        total_tax,
        total_amt,

        discountType,
        orderData.discount_value,
        discount_amount,

        orderData.payment_type,
        orderData.order_date,
        orderData.order_time
      ]
    );

    await conn.query("COMMIT");
    return result.rows[0];

  } catch (err) {
    await conn.query("ROLLBACK");
    throw err;
  }
};


exports.createOrderedItems = async (orderData) => {
  try {
    await conn.query("BEGIN");

    const items = orderData.items;
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("Items array is empty or invalid");
    }

    const insertedItems = [];

    for (const item of items) {
      const hasVariant = !!item.variant_id;

      // 🔍 Check existing item (API ORDER ID BASED)
      const checkQuery = hasVariant
        ? `
          SELECT *
          FROM tbl_ordered_items
          WHERE api_order_id = $1
            AND item_id = $2
            AND variant_id = $3
        `
        : `
          SELECT *
          FROM tbl_ordered_items
          WHERE api_order_id = $1
            AND item_id = $2
            AND variant_id IS NULL
        `;

      const checkValues = hasVariant
        ? [orderData.api_order_id, item.menu_id, item.variant_id]
        : [orderData.api_order_id, item.menu_id];

      const existingItem = await conn.query(checkQuery, checkValues);

      if (existingItem.rowCount > 0) {
        // 🟡 UPDATE qty
        const updateQuery = hasVariant
          ? `
            UPDATE tbl_ordered_items
            SET qty = qty + $1
            WHERE api_order_id = $2
              AND item_id = $3
              AND variant_id = $4
            RETURNING *;
          `
          : `
            UPDATE tbl_ordered_items
            SET qty = qty + $1
            WHERE api_order_id = $2
              AND item_id = $3
              AND variant_id IS NULL
            RETURNING *;
          `;

        const updateValues = hasVariant
          ? [item.qty, orderData.api_order_id, item.menu_id, item.variant_id]
          : [item.qty, orderData.api_order_id, item.menu_id];

        const result = await conn.query(updateQuery, updateValues);
        insertedItems.push(result.rows[0]);
      } else {
        // 🟢 INSERT new item
        const taxData = calculateItemTax(item);

        const insertQuery = `
          INSERT INTO tbl_ordered_items (
            zodu_id,
            branch_id,
            api_order_id,
            item_id,
            item_name,
            qty,
            price,
            item_unit,
            variant_id,
            variant_name,
            gst_percentage,
            tax_amount,
            cgst,
            sgst,
            tax_inclusive
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,false)
          RETURNING *;
        `;

        const insertValues = [
          orderData.zodu_id,
          orderData.branch_id,
          orderData.api_order_id,
          item.menu_id,
          item.name,
          item.qty,
          item.price,
          item.menu_unit,
          hasVariant ? item.variant_id : null,
          hasVariant ? item.variant_name : null,
          taxData.gst_percentage,
          taxData.tax_amount,
          taxData.cgst,
          taxData.sgst
        ];

        const result = await conn.query(insertQuery, insertValues);
        insertedItems.push(result.rows[0]);
      }
    }

    await conn.query("COMMIT");
    return insertedItems;

  } catch (err) {
    await conn.query("ROLLBACK");
    throw new Error("Unable to create or update ordered items: " + err.message);
  }
};


exports.createtmpOrder = async (orderData) => {
  try {
    await conn.query("BEGIN");

    /**
     * 1️⃣ CHECK FOR EXISTING RUNNING ORDER (DINE-IN SAFETY)
     * One table = one running order
     */
    if (orderData.order_type === "Dine-In" && orderData.table_no) {
      const existing = await conn.query(
        `SELECT *
         FROM tbl_tmp_orders
         WHERE branch_id = $1
           AND table_no = $2
           AND final_payment = false
         LIMIT 1`,
        [orderData.branch_id, orderData.table_no]
      );

      if (existing.rowCount > 0) {
        await conn.query("COMMIT");
        return existing.rows[0]; // reuse running order
      }
    }

    /**
     * 2️⃣ GENERATE BACKEND IDS
     */
    const api_order_id = randomUUID();
    const legacy_order_ref =
      `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    /**
     * 3️⃣ CALCULATE TOTALS
     */
    let subtotal = 0;
    let total_tax = 0;
    let no_of_items = 0;

    for (const item of orderData.items) {
      const taxData = calculateItemTax(item);
      subtotal += taxData.subtotal;
      total_tax += taxData.tax_amount;
      no_of_items += 1; // count rows, not qty
    }

    const total_amt = subtotal + total_tax;

    /**
     * 4️⃣ INSERT TMP ORDER
     * Use DB time for consistency
     */
    const result = await conn.query(
      `INSERT INTO tbl_tmp_orders (
        zodu_id,
        branch_id,

        api_order_id,
        legacy_order_ref,

        table_no,
        order_type,
        no_of_items,

        customer_name,
        customer_phone,

        subtotal,
        total_tax,
        total_amt,

        final_payment,
        payment_type,

        order_date,
        order_time
      )
      VALUES (
        $1,$2,
        $3,$4,
        $5,$6,$7,
        $8,$9,
        $10,$11,$12,
        false,$13,
        CURRENT_DATE,
        CURRENT_TIME
      )
      RETURNING *`,
      [
        orderData.zodu_id,
        orderData.branch_id,

        api_order_id,
        legacy_order_ref,

        orderData.table_no,
        orderData.order_type,
        no_of_items,

        orderData.customer_name || null,
        orderData.customer_phone || null,

        subtotal,
        total_tax,
        total_amt,

        orderData.payment_type || null
      ]
    );

    await conn.query("COMMIT");
    return result.rows[0];

  } catch (err) {
    await conn.query("ROLLBACK");
    throw new Error("Unable to create tmp order: " + err.message);
  }
};


exports.createtmpOrderedItems = async (orderData) => {
  try {
    await conn.query("BEGIN");

    const items = orderData.items;
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("Items array is empty or invalid");
    }

    const insertedItems = [];

    for (const item of items) {
      const hasVariant = !!item.variant_id;
      const taxData = calculateItemTax(item);

      // 🔍 Check existing (API ORDER ID BASED)
      const checkQuery = hasVariant
        ? `
          SELECT *
          FROM tbl_tmp_ordered_items
          WHERE api_order_id = $1
            AND item_id = $2
            AND variant_id = $3
        `
        : `
          SELECT *
          FROM tbl_tmp_ordered_items
          WHERE api_order_id = $1
            AND item_id = $2
            AND variant_id IS NULL
        `;

      const checkValues = hasVariant
        ? [orderData.api_order_id, item.menu_id, item.variant_id]
        : [orderData.api_order_id, item.menu_id];

      const existingItem = await conn.query(checkQuery, checkValues);

      if (existingItem.rowCount > 0) {
        // 🟡 UPDATE qty + tax
        const updateQuery = hasVariant
          ? `
            UPDATE tbl_tmp_ordered_items
            SET
              qty = qty + $1,
              gst_percentage = $2,
              tax_amount = tax_amount + $3,
              cgst = cgst + $4,
              sgst = sgst + $5
            WHERE api_order_id = $6
              AND item_id = $7
              AND variant_id = $8
            RETURNING *;
          `
          : `
            UPDATE tbl_tmp_ordered_items
            SET
              qty = qty + $1,
              gst_percentage = $2,
              tax_amount = tax_amount + $3,
              cgst = cgst + $4,
              sgst = sgst + $5
            WHERE api_order_id = $6
              AND item_id = $7
              AND variant_id IS NULL
            RETURNING *;
          `;

        const updateValues = hasVariant
          ? [
              item.qty,
              taxData.gst_percentage,
              taxData.tax_amount,
              taxData.cgst,
              taxData.sgst,
              orderData.api_order_id,
              item.menu_id,
              item.variant_id
            ]
          : [
              item.qty,
              taxData.gst_percentage,
              taxData.tax_amount,
              taxData.cgst,
              taxData.sgst,
              orderData.api_order_id,
              item.menu_id
            ];

        const result = await conn.query(updateQuery, updateValues);
        insertedItems.push(result.rows[0]);
      } else {
        // 🟢 INSERT new
        const insertQuery = `
          INSERT INTO tbl_tmp_ordered_items (
            zodu_id,
            branch_id,
            api_order_id,
            item_id,
            item_name,
            qty,
            price,
            item_unit,
            variant_id,
            variant_name,
            gst_percentage,
            tax_amount,
            cgst,
            sgst,
            tax_inclusive
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,false)
          RETURNING *;
        `;

        const insertValues = [
          orderData.zodu_id,
          orderData.branch_id,
          orderData.api_order_id,
          item.menu_id,
          item.name,
          item.qty,
          item.price,
          item.menu_unit,
          hasVariant ? item.variant_id : null,
          hasVariant ? item.variant_name : null,
          taxData.gst_percentage,
          taxData.tax_amount,
          taxData.cgst,
          taxData.sgst
        ];

        const result = await conn.query(insertQuery, insertValues);
        insertedItems.push(result.rows[0]);
      }
    }

    await conn.query("COMMIT");
    return insertedItems;

  } catch (err) {
    await conn.query("ROLLBACK");
    throw new Error("Unable to create or update tmp ordered items: " + err.message);
  }
};


exports.updateFinalPayment = async (data) => {
  const {
    zodu_id,
    branch_id,
    api_order_id,
    table_no,
    payment_type,
    discount_type,
    discount_value,
    items
  } = data;

  try {
    await conn.query("BEGIN");

    /* ----------------------------------------------------
       1️⃣ FETCH TMP ORDER (SOURCE OF TRUTH)
    ---------------------------------------------------- */
    const tmpRes = await conn.query(
      `
      SELECT
        created_at,
        order_type
      FROM tbl_tmp_orders
      WHERE api_order_id = $1
      `,
      [api_order_id]
    );

    if (!tmpRes.rowCount) {
      throw new Error("Temp order not found");
    }

    const { created_at, order_type } = tmpRes.rows[0];

    // 🔒 FORCE DATE & TIME FROM CREATED_AT
    const order_date = created_at.toISOString().slice(0, 10); // YYYY-MM-DD
    const order_time = created_at.toTimeString().slice(0, 8); // HH:mm:ss

    /* ----------------------------------------------------
       2️⃣ CALCULATE TOTALS
    ---------------------------------------------------- */
    let subtotal = 0;
    let total_tax = 0;
    let no_of_items = 0;

    for (const item of items) {
      const taxData = calculateItemTax(item);
      subtotal += taxData.subtotal;
      total_tax += taxData.tax_amount;
      no_of_items += 1; // count rows, NOT qty
    }

    const discountType = discount_type ? discount_type.toUpperCase() : null;

    let discount_amount = 0;
    if (discountType === "PERCENT") {
      discount_amount = (subtotal * Number(discount_value || 0)) / 100;
    } else if (discountType === "FLAT") {
      discount_amount = Number(discount_value || 0);
    }

    if (discount_amount > subtotal) discount_amount = subtotal;

    const total_amt = subtotal + total_tax - discount_amount;

    /* ----------------------------------------------------
       3️⃣ GENERATE PUBLIC ORDER NO (DAILY RESET SAFE)
    ---------------------------------------------------- */
    const public_order_no = await generatePublicOrderNo(branch_id);

    /* ----------------------------------------------------
       4️⃣ INSERT FINAL ORDER
    ---------------------------------------------------- */
    const orderRes = await conn.query(
      `
      INSERT INTO tbl_orders (
        zodu_id,
        branch_id,

        api_order_id,
        public_order_no,

        table_no,
        order_type,
        no_of_items,

        subtotal,
        total_tax,
        total_amt,

        discount_type,
        discount_value,
        discount_amount,

        final_payment,
        payment_type,

        order_date,
        order_time
      )
      VALUES (
        $1,$2,
        $3,$4,
        $5,$6,$7,
        $8,$9,$10,
        $11,$12,$13,
        true,$14,
        $15,$16
      )
      RETURNING *
      `,
      [
        zodu_id,
        branch_id,

        api_order_id,
        public_order_no,

        table_no,
        order_type,
        no_of_items,

        subtotal,
        total_tax,
        total_amt,

        discountType,
        discount_value,
        discount_amount,

        payment_type,
        order_date,
        order_time
      ]
    );

    /* ----------------------------------------------------
       5️⃣ MOVE TMP ITEMS → FINAL ITEMS
    ---------------------------------------------------- */
    await conn.query(
      `
      INSERT INTO tbl_ordered_items (
        zodu_id,
        branch_id,
        api_order_id,
        item_id,
        item_name,
        qty,
        price,
        item_unit,
        variant_id,
        variant_name,
        gst_percentage,
        tax_amount,
        cgst,
        sgst,
        tax_inclusive
      )
      SELECT
        zodu_id,
        branch_id,
        api_order_id,
        item_id,
        item_name,
        qty,
        price,
        item_unit,
        variant_id,
        variant_name,
        gst_percentage,
        tax_amount,
        cgst,
        sgst,
        tax_inclusive
      FROM tbl_tmp_ordered_items
      WHERE api_order_id = $1
      `,
      [api_order_id]
    );

    /* ----------------------------------------------------
       6️⃣ CLEANUP TMP DATA
    ---------------------------------------------------- */
    await conn.query(
      `DELETE FROM tbl_tmp_ordered_items WHERE api_order_id = $1`,
      [api_order_id]
    );

    await conn.query(
      `DELETE FROM tbl_tmp_orders WHERE api_order_id = $1`,
      [api_order_id]
    );

    await conn.query("COMMIT");

    /* ----------------------------------------------------
       7️⃣ RETURN FOR PRINTING
    ---------------------------------------------------- */
    return {
      success: true,
      order: orderRes.rows[0],
      public_order_no
    };

  } catch (err) {
    await conn.query("ROLLBACK");
    throw err;
  }
};





exports.createKOT = async (orderData) => {
  try {
    await conn.query("BEGIN");

    const items = orderData.items;

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("Items array is empty or invalid");
    }

    const insertedItems = [];

    for (const item of items) {
      // ✅ Prefer variant name, fallback to item name
      const itemName =
        item.variant_name && item.variant_name.trim() !== ""
          ? item.variant_name
          : item.name;

      const query = `
        INSERT INTO tbl_kot_list (
          zodu_id,
          branch_id,

          api_order_id,
          legacy_order_ref,

          kot_no,
          table_no,

          item_id,
          item_name,
          qty
        )
        VALUES (
          $1,$2,
          $3,$4,
          $5,$6,
          $7,$8,$9
        )
        RETURNING *;
      `;

      const values = [
        orderData.zodu_id,          // $1
        orderData.branch_id,        // $2

        orderData.api_order_id,     // $3 🔑 internal FK
        orderData.legacy_order_ref, // $4 (optional but useful)

        orderData.kot_no,           // $5 user-visible KOT number
        orderData.table_no,         // $6

        item.menu_id,               // $7
        itemName,                   // $8
        item.qty                    // $9
      ];

      const result = await conn.query(query, values);
      insertedItems.push(result.rows[0]);
    }

    await conn.query("COMMIT");
    return insertedItems;

  } catch (err) {
    await conn.query("ROLLBACK");
    throw new Error("Unable to create KOT: " + err.message);
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



exports.addExpense = async (data) => {
  try {
    await conn.query("BEGIN");

    // === 1  Expense ID generate if missing ===
    if (!data.expense_id) {
      const result = await conn.query(
        `SELECT MAX(CAST(SPLIT_PART(expense_id, '-EXP-', 2) AS INTEGER)) AS max
         FROM tbl_expense
         WHERE branch_id = $1`,
        [data.branch_id]
      );

      const next = (result.rows[0]?.max || 0) + 1;
      data.expense_id = `${data.branch_id}-EXP-${String(next).padStart(3, "0")}`;
    }

    // === 2 insert expense
    await conn.query(
      `INSERT INTO tbl_expense 
      (zodu_id, branch_id, category_id, expense_id, expense_date, description, attachment_url, payment_type, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,NOW())`,
      [
        data.zodu_id,
        data.branch_id,
        Number(data.category),
        data.expense_id,
        data.expense_date,
        data.description,
        JSON.stringify(data.attachment_url || null),
        data.payment_type || "cash"
      ]
    );

    // === 3 expense items
    if (Array.isArray(data.items)) {
      const sql = `
      INSERT INTO tbl_expense_items
      (expense_id,item_name,qty,price,item_id)
      VALUES ($1,$2,$3,$4,$5)
      `;

      for (const item of data.items) {
        await conn.query(sql, [
          data.expense_id,
          item.name,
          item.qty,
          item.purchase_price,
          item.id || item.item_id
        ]);
      }
    }

    // === 4 ensure tbl_payment row
    const payRow = await exports.ensurePaymentForSource({
      zodu_id     : data.zodu_id,
      branch_id   : data.branch_id,
      source_type : "expense",
      source_id   : data.expense_id,
      total_amount: data.total_amount,
    });

    // === 5 insert payment history?
    if (data.paid_amount > 0) {
      await exports.insertPaymentHistory({
        payment_id: payRow.payment_id,
        zodu_id   : data.zodu_id,
        branch_id : data.branch_id,
        paid_amount: data.paid_amount,
        payment_type: data.payment_type,
      });
    }

    await conn.query("COMMIT");
    return { success: true, message: "Expense added" };

  } catch (err) {
    await conn.query("ROLLBACK");
    throw new Error("addExpense failed: " + err.message);
  }
};


exports.edit_expense = async (data) => {
  try {
    await conn.query("BEGIN");

    console.log("test",data)

    const total = Number(data.total_amount || 0);
    const desiredPaid = Number(data.paid_amount || 0);

    // 1 update master
    const res = await conn.query(
      `UPDATE tbl_expense SET
        category_id   = $1,
        expense_date  = $2,
        description   = $3,
        attachment_url= $4,
        payment_type  = $5,
        updated_at    = NOW()
      WHERE expense_id = $6
      RETURNING *
      `,
      [
        data.category,
        data.expense_date,
        data.description,
        JSON.stringify(data.attachment_url || null),
        data.payment_type,
        data.expense_id,
      ]
    );

    const exp = res.rows[0];

    console.log("data",res);

    // 2 sync total
    const payRow = await exports.ensurePaymentForSource({
      zodu_id     : exp.zodu_id,
      branch_id   : exp.branch_id,
      source_type : "expense",
      source_id   : exp.expense_id,
      total_amount: total,
    });

    // 3 adjust if user changed paid
    const diff = desiredPaid - Number(payRow.paid_amount);

    if (diff !== 0) {
      await exports.insertPaymentHistory({
        payment_id: payRow.payment_id,
        zodu_id   : exp.zodu_id,
        branch_id : exp.branch_id,
        paid_amount: diff,
        payment_type: data.payment_type || "adjustment",
      });
    }

    // 4 replace items
    await conn.query(`DELETE FROM tbl_expense_items WHERE expense_id=$1`, [
      data.expense_id,
    ]);

    if (Array.isArray(data.items)) {
      for (const it of data.items) {
        await conn.query(
          `INSERT INTO tbl_expense_items
          (expense_id,item_name,qty,price,item_id)
          VALUES ($1,$2,$3,$4,$5)`,
          [
            data.expense_id,
            it.name,
            it.qty,
            it.purchase_price,
            it.id,
          ]
        );
      }
    }

    await conn.query("COMMIT");
    return { success: true, message: "Expense updated" };

  } catch (err) {
    await conn.query("ROLLBACK");
    throw new Error("edit_expense failed: " + err.message);
  }
};



exports.getExpenseById = async (expense_id) => {
  try {
    const query = `
    WITH expense_data AS (
      SELECT
        e.expense_id,
        e.zodu_id,
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
          ) FILTER (WHERE ei.item_id IS NOT NULL),
          '[]'
        ) AS items

      FROM tbl_expense e
      LEFT JOIN tbl_expense_items ei 
        ON e.expense_id = ei.expense_id
      LEFT JOIN tbl_expense_category c 
        ON e.category_id = c.id
      LEFT JOIN tbl_payment pay
        ON pay.source_type = 'expense'
       AND pay.source_id   = e.expense_id
       AND pay.branch_id   = e.branch_id
       AND pay.zodu_id     = e.zodu_id

      WHERE e.expense_id = $1
      GROUP BY
        e.expense_id,
        c.category_name,
        pay.total_amount,
        pay.paid_amount
    )

    SELECT
      ed.*,

      -- payment history
      (
        SELECT COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT(
            'payment_id', ph.transaction_id,
              'paid_amount', ph.paid_amount,
              'payment_type', ph.payment_mode,
              'created_at', ph.created_at
            )
            ORDER BY ph.created_at DESC
          ),
          '[]'
        )
        FROM tbl_payment_history ph
        JOIN tbl_payment p2 ON p2.payment_id = ph.payment_id
        WHERE p2.source_type = 'expense'
          AND p2.source_id   = ed.expense_id
      ) AS payment_history

    FROM expense_data ed;
    `;

    const result = await conn.query(query, [expense_id]);

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0]; // ✅ single expense object
  } catch (err) {
    console.error("Error in getExpenseById:", err.message);
    throw new Error("Unable to fetch expense: " + err.message);
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
              'unit', pi.unit,
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

// exports.getDashboard = async (zodu_id, branch_id, pagination, sortOrder, dateFilter) => {
//   const order = sortOrder === "asc" ? "ASC" : "DESC";


//   const { orders, expenses, topItems, datewise } = pagination;

//   // =========================
//   // DATE FILTER (default = today)
//   // =========================
//   let orderDateCondition = `AND o.order_date = CURRENT_DATE`;
//   let expenseDateCondition = `AND e.updated_at::date = CURRENT_DATE`;
//   let paymentDateCondition = `AND p.updated_at::date = CURRENT_DATE`;

//   if (dateFilter?.dateType === "today") {
//     orderDateCondition = `AND o.order_date = CURRENT_DATE`;
//     expenseDateCondition = `AND e.updated_at::date = CURRENT_DATE`;
//     paymentDateCondition = `AND p.updated_at::date = CURRENT_DATE`;
//   }

//   else if (dateFilter?.dateType === "yesterday") {
//     orderDateCondition = `AND o.order_date = CURRENT_DATE - INTERVAL '1 day'`;
//     expenseDateCondition = `AND e.updated_at::date = CURRENT_DATE - INTERVAL '1 day'`;
//     paymentDateCondition = `AND p.updated_at::date = CURRENT_DATE - INTERVAL '1 day'`;
//   }

//   else if (dateFilter?.dateType === "thisWeek") {
//     orderDateCondition = `AND o.order_date >= date_trunc('week', CURRENT_DATE)`;
//     expenseDateCondition = `AND e.updated_at::date >= date_trunc('week', CURRENT_DATE)`;
//     paymentDateCondition = `AND p.updated_at::date >= date_trunc('week', CURRENT_DATE)`;
//   }

//   else if (dateFilter?.dateType === "last7Days") {
//     orderDateCondition = `AND o.order_date >= CURRENT_DATE - INTERVAL '7 days'`;
//     expenseDateCondition = `AND e.updated_at::date >= CURRENT_DATE - INTERVAL '7 days'`;
//     paymentDateCondition = `AND p.updated_at::date >= CURRENT_DATE - INTERVAL '7 days'`;
//   }

//   else if (dateFilter?.dateType === "last14Days") {
//     orderDateCondition = `AND o.order_date >= CURRENT_DATE - INTERVAL '14 days'`;
//     expenseDateCondition = `AND e.updated_at::date >= CURRENT_DATE - INTERVAL '14 days'`;
//     paymentDateCondition = `AND p.updated_at::date >= CURRENT_DATE - INTERVAL '14 days'`;
//   }

//   else if (dateFilter?.dateType === "last30Days") {
//     orderDateCondition = `AND o.order_date >= CURRENT_DATE - INTERVAL '30 days'`;
//     expenseDateCondition = `AND e.updated_at::date >= CURRENT_DATE - INTERVAL '30 days'`;
//     paymentDateCondition = `AND p.updated_at::date >= CURRENT_DATE - INTERVAL '30 days'`;
//   }

//   else if (dateFilter?.dateType === "thisMonth") {
//     orderDateCondition = `AND o.order_date >= date_trunc('month', CURRENT_DATE)`;
//     expenseDateCondition = `AND e.updated_at::date >= date_trunc('month', CURRENT_DATE)`;
//     paymentDateCondition = `AND p.updated_at::date >= date_trunc('month', CURRENT_DATE)`;
//   }

//   else if (dateFilter?.dateType === "lastMonth") {
//     orderDateCondition = `
//       AND o.order_date >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month')
//       AND o.order_date < date_trunc('month', CURRENT_DATE)
//     `;
//     expenseDateCondition = `
//       AND e.updated_at::date >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month')
//       AND e.updated_at::date < date_trunc('month', CURRENT_DATE)
//     `;
//     paymentDateCondition = `
//       AND p.updated_at::date >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month')
//       AND p.updated_at::date < date_trunc('month', CURRENT_DATE)
//     `;
//   }

//   else if (dateFilter?.dateType === "thisQuarter") {
//     orderDateCondition = `AND o.order_date >= date_trunc('quarter', CURRENT_DATE)`;
//     expenseDateCondition = `AND e.updated_at::date >= date_trunc('quarter', CURRENT_DATE)`;
//     paymentDateCondition = `AND p.updated_at::date >= date_trunc('quarter', CURRENT_DATE)`;
//   }

//   else if (dateFilter?.dateType === "lastQuarter") {
//     orderDateCondition = `
//       AND o.order_date >= date_trunc('quarter', CURRENT_DATE - INTERVAL '3 month')
//       AND o.order_date < date_trunc('quarter', CURRENT_DATE)
//     `;
//     expenseDateCondition = `
//       AND e.updated_at::date >= date_trunc('quarter', CURRENT_DATE - INTERVAL '3 month')
//       AND e.updated_at::date < date_trunc('quarter', CURRENT_DATE)
//     `;
//     paymentDateCondition = `
//       AND p.updated_at::date >= date_trunc('quarter', CURRENT_DATE - INTERVAL '3 month')
//       AND p.updated_at::date < date_trunc('quarter', CURRENT_DATE)
//     `;
//   }

//   else if (dateFilter?.dateType === "custom" && dateFilter.fromDate && dateFilter.toDate) {
//     orderDateCondition = `AND o.order_date BETWEEN '${dateFilter.fromDate}' AND '${dateFilter.toDate}'`;
//     expenseDateCondition = `AND e.updated_at::date BETWEEN '${dateFilter.fromDate}' AND '${dateFilter.toDate}'`;
//     paymentDateCondition = `AND p.updated_at::date BETWEEN '${dateFilter.fromDate}' AND '${dateFilter.toDate}'`;
//   }

//   // ======================
//   // SUMMARY
//   // ======================
//   const summaryQuery = `
//     SELECT
//       (SELECT COUNT(*) 
//        FROM tbl_orders o
//        WHERE o.zodu_id=$1 AND o.branch_id=$2 AND o.final_payment=true ${orderDateCondition}
//       ) AS total_orders,

//       (SELECT COALESCE(SUM(o.total_amt),0) 
//        FROM tbl_orders o
//        WHERE o.zodu_id=$1 AND o.branch_id=$2 AND o.final_payment=true ${orderDateCondition}
//       ) AS total_sales,

//       (SELECT COALESCE(SUM(p.total_amount),0) 
//        FROM tbl_payment p
//        WHERE p.zodu_id=$1 AND p.branch_id=$2 AND p.source_type='expense' ${paymentDateCondition}
//       ) AS total_expense,

//       (SELECT COUNT(*) 
//        FROM tbl_inventory 
//        WHERE zodu_id=$1 AND branch_id=$2 AND stock_qty <= stock_alert
//       ) AS low_stocks
//   `;
//   const summaryRes = await conn.query(summaryQuery, [zodu_id, branch_id]);

//   // ======================
//   // ORDERS
//   // ======================
//   const ordersQuery = `
//     SELECT 
//       o.api_order_id,
//       o.public_order_no,
//       o.total_amt,
//       o.no_of_items,
//       COALESCE(SUM(oi.qty),0) AS total_qty,
//       o.order_type,
//       TO_CHAR(
//         o.order_date + o.order_time::interval,
//         'DD Mon YYYY, HH12:MI AM (Dy)'
//       ) AS formatted_date
//     FROM tbl_orders o
//     LEFT JOIN tbl_ordered_items oi ON oi.api_order_id = o.api_order_id
//     WHERE o.zodu_id = $1 
//       AND o.branch_id = $2 
//       AND o.final_payment = true
//       ${orderDateCondition}
//     GROUP BY o.api_order_id, o.public_order_no, o.total_amt, o.no_of_items, o.order_type, o.order_date, o.order_time
//     ORDER BY o.created_at ${order}
//     LIMIT $3 OFFSET $4;
//   `;

//   const ordersRes = await conn.query(ordersQuery, [
//     zodu_id,
//     branch_id,
//     orders.limit,
//     orders.offset
//   ]);

//   const ordersCount = await conn.query(
//     `SELECT COUNT(*) 
//      FROM tbl_orders o
//      WHERE o.zodu_id=$1 AND o.branch_id=$2 AND o.final_payment=true ${orderDateCondition}`,
//     [zodu_id, branch_id]
//   );

//   // ======================
//   // TOP ITEMS
//   // ======================
//   const topItemsQuery = `
//     SELECT 
//       m.menu_name,
//       c.name AS category_name,
//       u.short_name AS unit,
//       SUM(i.qty) AS total_qty,
//       SUM(i.qty * i.price) AS total_amount
//     FROM tbl_ordered_items i
//     JOIN tbl_orders o ON o.order_id = i.order_id
//     JOIN tbl_menu_item m ON m.menu_id = i.item_id
//     LEFT JOIN tbl_category c ON c.id = m.menu_category_id
//     LEFT JOIN tbl_units u ON u.id = m.menu_unit
//     WHERE o.zodu_id = $1 
//       AND o.branch_id = $2
//       ${orderDateCondition}
//     GROUP BY m.menu_name, c.name, u.short_name
//     ORDER BY total_qty DESC
//     LIMIT $3 OFFSET $4;
//   `;

//   const topItemsRes = await conn.query(topItemsQuery, [
//     zodu_id,
//     branch_id,
//     topItems.limit,
//     topItems.offset
//   ]);

//   const topItemsCount = await conn.query(
//     `SELECT COUNT(DISTINCT i.item_id)
//      FROM tbl_ordered_items i
//      JOIN tbl_orders o ON o.order_id = i.order_id
//      WHERE o.zodu_id = $1 
//        AND o.branch_id = $2
//        ${orderDateCondition}`,
//     [zodu_id, branch_id]
//   );

//   // ======================
//   // DATEWISE (NO FILTER)
//   // ======================
//   const datewiseQuery = `
//     SELECT 
//       order_date::date AS date,
//       COUNT(order_id) AS total_orders,
//       SUM(total_amt) AS total_amount
//     FROM tbl_orders
//     WHERE zodu_id = $1 AND branch_id = $2
//     GROUP BY order_date::date
//     ORDER BY order_date DESC
//     LIMIT $3 OFFSET $4;
//   `;

//   const datewiseRes = await conn.query(datewiseQuery, [
//     zodu_id,
//     branch_id,
//     datewise.limit,
//     datewise.offset
//   ]);

//   const datewiseCount = await conn.query(
//     `SELECT COUNT(DISTINCT order_date)
//      FROM tbl_orders
//      WHERE zodu_id = $1 AND branch_id = $2`,
//     [zodu_id, branch_id]
//   );

//   // ======================
//   // EXPENSES
//   // ======================
//   const expenseQuery = `
//     SELECT 
//       e.expense_id,
//       c.category_name,

//       COALESCE(p.total_amount, 0) AS total_amount,
//       COALESCE(p.paid_amount, 0) AS paid_amount,
//       (COALESCE(p.total_amount, 0) - COALESCE(p.paid_amount, 0)) AS due_amount,

//       COUNT(i.id) AS item_count,
//       e.updated_at
//     FROM tbl_expense e
//     LEFT JOIN tbl_expense_category c 
//       ON c.id = e.category_id
//     LEFT JOIN tbl_payment p 
//       ON p.source_id = e.expense_id
//       AND p.source_type = 'expense'
//     LEFT JOIN tbl_expense_items i 
//       ON i.expense_id = e.expense_id
//     WHERE e.zodu_id = $1 
//       AND e.branch_id = $2
//       ${expenseDateCondition}
//     GROUP BY 
//       e.expense_id,
//       c.category_name,
//       p.total_amount,
//       p.paid_amount,
//       e.updated_at
//     ORDER BY e.updated_at ${order}
//     LIMIT $3 OFFSET $4;
//   `;

//   const expensesRes = await conn.query(expenseQuery, [
//     zodu_id,
//     branch_id,
//     expenses.limit,
//     expenses.offset
//   ]);

//   const expensesCount = await conn.query(
//     `SELECT COUNT(*) 
//      FROM tbl_expense e
//      WHERE e.zodu_id = $1 AND e.branch_id = $2 ${expenseDateCondition}`,
//     [zodu_id, branch_id]
//   );

//   return {
//     data: {
//       summary: summaryRes.rows[0],
//       orders: ordersRes.rows,
//       top_items: topItemsRes.rows,
//       datewise_sales: datewiseRes.rows,
//       expenses: expensesRes.rows
//     },
//     counts: {
//       orders: Number(ordersCount.rows[0].count),
//       topItems: Number(topItemsCount.rows[0].count),
//       datewise: Number(datewiseCount.rows[0].count),
//       expenses: Number(expensesCount.rows[0].count)
//     }
//   };
// };



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
        JOIN tbl_orders o ON o.order_id = oi.order_id
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

