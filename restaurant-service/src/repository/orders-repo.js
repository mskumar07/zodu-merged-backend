const conn = require("../database/connection");
const { randomUUID } = require("crypto");
const { calculateItemTax, calculateOrderTotals } = require("../utils/gstcalcukator");
const { generatePublicOrderNo } = require("./generatePublicOrderNo");

exports.getSingleOrder = async (zodu_id, branch_id, api_order_id) => {
  const query = `
    SELECT
      o.api_order_id,
      o.public_order_no,
      o.order_date,
      o.order_time,
      TO_CHAR(o.created_at, 'DD Mon YYYY, HH12:MI AM (Dy)') AS formatted_date,
      o.order_type,
      o.payment_type,
      o.customer_name,
      o.customer_phone,
      o.table_no,
      o.no_of_items,
      (SELECT COALESCE(SUM(i.qty), 0) FROM tbl_ordered_items i WHERE i.api_order_id = o.api_order_id) AS total_qty,
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
              'item_name', CASE WHEN i.variant_name IS NOT NULL AND BTRIM(i.variant_name) <> ''
                THEN i.item_name || ' - ' || i.variant_name ELSE i.item_name END,
              'qty', i.qty,
              'price', i.price,
              'amount', i.total_amount,
              'unit', i.item_unit,
              'gst_percentage', i.gst_percentage,
              'tax_amount', i.tax_amount,
              'cgst', i.cgst,
              'sgst', i.sgst,
              'tax_inclusive', i.tax_inclusive
            )
          ), '[]'::json
        )
        FROM tbl_ordered_items i WHERE i.api_order_id = o.api_order_id
      ) AS items
    FROM tbl_orders o
    WHERE o.api_order_id = $1
      AND o.zodu_id = $2
      AND o.branch_id = $3
      AND o.final_payment = true
  `;
  const result = await conn.query(query, [api_order_id, zodu_id, branch_id]);
  return result.rows[0] || null;
};

exports.createOrder = async (orderData) => {
  try {
    await conn.query("BEGIN");

    const api_order_id = randomUUID();
    const public_order_no = await generatePublicOrderNo(orderData.branch_id);

    console.log("Creating order with API Order ID:",orderData);

    const totals = calculateOrderTotals(
      orderData.items || [],
      orderData.discount_type,
      orderData.discount_value
    );

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
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,true,$16,$17,$18)
      RETURNING *`,
      [
        orderData.zodu_id, orderData.branch_id,
        api_order_id, public_order_no,
        orderData.table_no, orderData.order_type, totals.total_items,
        orderData.customer_name, orderData.customer_phone,
        totals.subtotal, totals.total_tax, totals.total_amount,
        totals.discount_type || orderData.discount_type, orderData.discount_value, totals.discount_amount,
        orderData.payment_type, orderData.order_date, orderData.order_time
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
    if (!Array.isArray(items) || items.length === 0) throw new Error("Items array is empty or invalid");

    const insertedItems = [];
    for (const item of items) {
      const hasVariant = !!item.variant_id;

      const checkQuery = hasVariant
        ? `SELECT * FROM tbl_ordered_items WHERE api_order_id = $1 AND item_id = $2 AND variant_id = $3`
        : `SELECT * FROM tbl_ordered_items WHERE api_order_id = $1 AND item_id = $2 AND variant_id IS NULL`;
      const checkValues = hasVariant
        ? [orderData.api_order_id, item.menu_id, item.variant_id]
        : [orderData.api_order_id, item.menu_id];

      const existingItem = await conn.query(checkQuery, checkValues);

      if (existingItem.rowCount > 0) {
        const updateQuery = hasVariant
          ? `UPDATE tbl_ordered_items SET qty = qty + $1 WHERE api_order_id = $2 AND item_id = $3 AND variant_id = $4 RETURNING *`
          : `UPDATE tbl_ordered_items SET qty = qty + $1 WHERE api_order_id = $2 AND item_id = $3 AND variant_id IS NULL RETURNING *`;
        const updateValues = hasVariant
          ? [item.qty, orderData.api_order_id, item.menu_id, item.variant_id]
          : [item.qty, orderData.api_order_id, item.menu_id];
        const result = await conn.query(updateQuery, updateValues);
        insertedItems.push(result.rows[0]);
      } else {
        const taxData = calculateItemTax(item);
        const result = await conn.query(
          `INSERT INTO tbl_ordered_items (
            zodu_id, branch_id, api_order_id, item_id, item_name,
            qty, price, item_unit, variant_id, variant_name,
            gst_percentage, tax_amount, cgst, sgst, tax_inclusive
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,false) RETURNING *`,
          [
            orderData.zodu_id, orderData.branch_id, orderData.api_order_id,
            item.menu_id, item.name, item.qty, item.price, item.menu_unit,
            hasVariant ? item.variant_id : null,
            hasVariant ? item.variant_name : null,
            taxData.gst_percentage, taxData.tax_amount, taxData.cgst, taxData.sgst
          ]
        );
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

exports.get_all_report_data = async (zodu_id, branch_id, page = 1, limit = 10, filtered_type, start_date, end_date, year, search = "") => {
  try {
    const offset = (page - 1) * limit;
    const isMonthYearWise = filtered_type === "month_year_wise";
    const isDateWise = filtered_type === "date_wise";

    const hasDateFilter = start_date && end_date &&
      start_date !== "" && end_date !== "" &&
      start_date !== "null" && end_date !== "null";

    if (isMonthYearWise) {
      const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];

      if (year && year !== "null" && year !== "undefined") {
        const parsedYear = parseInt(year, 10);
        const { rows } = await conn.query(
          `SELECT EXTRACT(MONTH FROM created_at)::int AS month_number,
            COUNT(*) AS total_orders, COALESCE(SUM(total_amt),0) AS total_amount,
            SUM(COUNT(*)) OVER() AS total_count,
            COALESCE(SUM(SUM(total_amt)) OVER(),0) AS all_total_amount,
            COALESCE(SUM(SUM(no_of_items)) OVER(),0) AS all_items_total
           FROM tbl_orders WHERE zodu_id = $1 AND branch_id = $2 AND final_payment = true
            AND EXTRACT(YEAR FROM created_at)::int = $3
           GROUP BY month_number ORDER BY month_number`,
          [zodu_id, branch_id, parsedYear]
        );
        const monthMap = {};
        let yearTotalOrders = 0, yearTotalAmount = 0;
        rows.forEach(r => { monthMap[r.month_number] = r; yearTotalOrders += Number(r.total_orders); yearTotalAmount += Number(r.total_amount); });
        return {
          rows: [],
          totals: rows.length ? { total_count: rows[0].total_count, all_total_amount: rows[0].all_total_amount, all_items_total: rows[0].all_items_total } : { total_count: 0, all_total_amount: 0, all_items_total: 0 },
          monthly_summary: [{ year: parsedYear, total_orders: yearTotalOrders, total_amount: yearTotalAmount, months: monthNames.map((m, i) => ({ month_number: i + 1, month: m, total_orders: Number(monthMap[i + 1]?.total_orders || 0), total_amount: Number(monthMap[i + 1]?.total_amount || 0) })) }]
        };
      }

      const { rows } = await conn.query(
        `SELECT EXTRACT(YEAR FROM created_at)::int AS year, EXTRACT(MONTH FROM created_at)::int AS month_number,
          COUNT(*) AS total_orders, COALESCE(SUM(total_amt),0) AS total_amount,
          SUM(COUNT(*)) OVER() AS total_count,
          COALESCE(SUM(SUM(total_amt)) OVER(),0) AS all_total_amount,
          COALESCE(SUM(SUM(no_of_items)) OVER(),0) AS all_items_total
         FROM tbl_orders WHERE zodu_id = $1 AND branch_id = $2 AND final_payment = true
         GROUP BY year, month_number ORDER BY year, month_number`,
        [zodu_id, branch_id]
      );
      const yearMap = {};
      rows.forEach(r => {
        if (!yearMap[r.year]) yearMap[r.year] = { total_orders: 0, total_amount: 0, months: {} };
        yearMap[r.year].months[r.month_number] = r;
        yearMap[r.year].total_orders += Number(r.total_orders);
        yearMap[r.year].total_amount += Number(r.total_amount);
      });
      return {
        rows: [],
        totals: rows.length ? { total_count: rows[0].total_count, all_total_amount: rows[0].all_total_amount, all_items_total: rows[0].all_items_total } : { total_count: 0, all_total_amount: 0, all_items_total: 0 },
        monthly_summary: Object.keys(yearMap).sort((a, b) => a - b).map(y => ({ year: Number(y), total_orders: yearMap[y].total_orders, total_amount: yearMap[y].total_amount, months: monthNames.map((m, i) => ({ month_number: i + 1, month: m, total_orders: Number(yearMap[y].months[i + 1]?.total_orders || 0), total_amount: Number(yearMap[y].months[i + 1]?.total_amount || 0) })) }))
      };
    }

    let whereClauses = [];
    let baseParams = [zodu_id, branch_id];

    if (hasDateFilter) {
      whereClauses.push(`created_at::date BETWEEN $${baseParams.length + 1} AND $${baseParams.length + 2}`);
      baseParams.push(start_date, end_date);
    }
    if (search && search.trim() !== "") {
      whereClauses.push(`(public_order_no ILIKE $${baseParams.length + 1} OR payment_type ILIKE $${baseParams.length + 1} OR order_type ILIKE $${baseParams.length + 1})`);
      baseParams.push(`%${search}%`);
    }

    const whereSQL = whereClauses.length ? `AND ${whereClauses.join(" AND ")}` : "";
    const limitIdx = `$${baseParams.length + 1}`;
    const offsetIdx = `$${baseParams.length + 2}`;

    const cteQuery = `
      WITH filtered AS (
        SELECT public_order_no, api_order_id, created_at, order_type, no_of_items, total_tax, total_amt, payment_type
        FROM tbl_orders WHERE zodu_id = $1 AND branch_id = $2 AND final_payment = true ${whereSQL}
      ),
      totals AS (SELECT COUNT(*) AS total_count, SUM(total_amt) AS all_total_amount, SUM(no_of_items) AS all_items_total FROM filtered)
      SELECT TO_CHAR(f.created_at,'DD Mon YYYY, HH12:MI AM (Dy)') AS created_at,
        f.public_order_no, f.api_order_id, f.order_type, f.no_of_items, f.total_tax, f.total_amt, f.payment_type,
        t.total_count, t.all_total_amount, t.all_items_total
      FROM filtered f CROSS JOIN totals t
      ORDER BY f.created_at DESC LIMIT ${limitIdx} OFFSET ${offsetIdx}
    `;

    const queries = [conn.query(cteQuery, [...baseParams, limit, offset])];

    if (isDateWise) {
      const datewiseQuery = hasDateFilter
        ? `SELECT to_char(created_at::date,'DD-Mon-YYYY') AS created_at, COUNT(*) AS total_orders, SUM(total_amt) AS all_total_amount
           FROM tbl_orders WHERE zodu_id = $1 AND branch_id = $2 AND final_payment = true AND created_at::date BETWEEN $3 AND $4
           GROUP BY created_at::date ORDER BY created_at::date DESC LIMIT $5 OFFSET $6`
        : `SELECT to_char(created_at::date,'DD-Mon-YYYY') AS created_at, COUNT(*) AS total_orders, SUM(total_amt) AS all_total_amount
           FROM tbl_orders WHERE zodu_id = $1 AND branch_id = $2 AND final_payment = true
           GROUP BY created_at::date ORDER BY created_at::date DESC LIMIT $3 OFFSET $4`;
      queries.push(hasDateFilter
        ? conn.query(datewiseQuery, [zodu_id, branch_id, start_date, end_date, limit, offset])
        : conn.query(datewiseQuery, [zodu_id, branch_id, limit, offset])
      );
    }

    const results = await Promise.all(queries);
    const listRows = results[0].rows;
    const totals = listRows.length
      ? { total_count: listRows[0].total_count, all_total_amount: listRows[0].all_total_amount, all_items_total: listRows[0].all_items_total }
      : { total_count: 0, all_total_amount: 0, all_items_total: 0 };
    const rows = listRows.map(({ total_count, all_total_amount, all_items_total, ...r }) => r);

    return { rows, totals, datewise_summary: isDateWise ? results[1]?.rows || [] : [] };
  } catch (err) {
    throw new Error("Unable to fetch report data: " + err.message);
  }
};

exports.get_category_item_wise_report = async (zodu_id, branch_id, page = 1, limit = 10, search = "") => {
  try {
    const offset = (page - 1) * limit;
    const params = [zodu_id, branch_id];
    let searchFilter = "";

    if (search && search.trim() !== "") {
      params.push(`%${search}%`);
      searchFilter = `AND (c.name ILIKE $3 OR oi.item_name ILIKE $3)`;
    }

    const countQuery = `
      SELECT COUNT(DISTINCT c.id)::int AS total_count
      FROM tbl_ordered_items oi
      JOIN tbl_menu_items mi ON mi.menu_id = oi.item_id AND mi.zodu_id = oi.zodu_id AND mi.branch_id = oi.branch_id
      JOIN tbl_category c ON c.id = mi.menu_category_id
      WHERE oi.zodu_id = $1 AND oi.branch_id = $2 ${searchFilter}
    `;
    const dataQuery = `
      WITH aggregated AS (
        SELECT c.id AS category_id, c.name AS category_name, mi.menu_id AS item_id, oi.item_name,
          SUM(oi.qty)::numeric(10,2) AS total_qty, SUM(oi.total_amount)::numeric(10,2) AS total_amount
        FROM tbl_ordered_items oi
        JOIN tbl_menu_items mi ON mi.menu_id = oi.item_id AND mi.zodu_id = oi.zodu_id AND mi.branch_id = oi.branch_id
        JOIN tbl_category c ON c.id = mi.menu_category_id
        WHERE oi.zodu_id = $1 AND oi.branch_id = $2 ${searchFilter}
        GROUP BY c.id, c.name, mi.menu_id, oi.item_name
      ),
      paged_categories AS (
        SELECT DISTINCT category_id, category_name FROM aggregated ORDER BY category_name
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      )
      SELECT a.* FROM aggregated a JOIN paged_categories pc ON pc.category_id = a.category_id
      ORDER BY a.category_name ASC, a.item_name ASC
    `;
    const summaryQuery = `
      SELECT COUNT(DISTINCT oi.api_order_id)::int AS total_orders,
        COALESCE(SUM(oi.qty),0)::numeric AS total_qty,
        COALESCE(SUM(oi.total_amount),0)::numeric AS total_amount
      FROM tbl_ordered_items oi
      JOIN tbl_menu_items mi ON mi.menu_id = oi.item_id AND mi.zodu_id = oi.zodu_id AND mi.branch_id = oi.branch_id
      JOIN tbl_category c ON c.id = mi.menu_category_id
      WHERE oi.zodu_id = $1 AND oi.branch_id = $2 ${searchFilter}
    `;

    const [countRes, dataRes, summaryRes] = await Promise.all([
      conn.query(countQuery, params),
      conn.query(dataQuery, [...params, limit, offset]),
      conn.query(summaryQuery, params)
    ]);

    const categoryMap = {};
    for (const row of dataRes.rows) {
      if (!categoryMap[row.category_id]) {
        categoryMap[row.category_id] = { category_id: row.category_id, category_name: row.category_name, total_qty: 0, total_amount: 0, items: [] };
      }
      categoryMap[row.category_id].total_qty += Number(row.total_qty);
      categoryMap[row.category_id].total_amount += Number(row.total_amount);
      categoryMap[row.category_id].items.push({ item_id: row.item_id, item_name: row.item_name, total_qty: Number(row.total_qty), total_amount: Number(row.total_amount) });
    }

    const totalRecords = Number(countRes.rows[0].total_count);
    return {
      overall_summary: { total_orders: Number(summaryRes.rows[0].total_orders), total_qty: Number(summaryRes.rows[0].total_qty), total_amount: Number(summaryRes.rows[0].total_amount) },
      rows: Object.values(categoryMap),
      pagination: { page, limit, totalRecords, totalPages: Math.ceil(totalRecords / limit) }
    };
  } catch (err) {
    throw new Error("Unable to fetch category/item wise report: " + err.message);
  }
};

exports.get_ordered_data = async (branch_id) => {
  const query = `
    SELECT
      o.api_order_id, o.legacy_order_ref, o.table_no, o.order_type,
      o.customer_name, o.customer_phone, o.total_amt, o.final_payment,
      o.branch_id, o.order_date, o.order_time,
      COALESCE(JSON_AGG(DISTINCT JSONB_BUILD_OBJECT(
        'item_id', i.item_id, 'item_name', i.item_name, 'qty', i.qty,
        'price', i.price, 'item_unit', i.item_unit, 'item_image', mi.menu_image,
        'variant_name', i.variant_name, 'variant_id', i.variant_id
      )) FILTER (WHERE i.item_id IS NOT NULL), '[]') AS ordered_items,
      COALESCE(JSON_AGG(DISTINCT JSONB_BUILD_OBJECT(
        'kot_no', k.kot_no, 'item_id', k.item_id, 'item_name', k.item_name,
        'qty', k.qty, 'table_no', k.table_no, 'status', k.status
      )) FILTER (WHERE k.item_id IS NOT NULL), '[]') AS kot_items
    FROM tbl_tmp_orders o
    LEFT JOIN tbl_tmp_ordered_items i ON o.api_order_id = i.api_order_id
    LEFT JOIN tbl_menu_items mi ON i.item_id = mi.menu_id
    LEFT JOIN tbl_kot_list k ON o.api_order_id = k.api_order_id
    WHERE o.branch_id = $1 AND o.final_payment = false
    GROUP BY o.api_order_id, o.legacy_order_ref, o.table_no, o.order_type,
      o.customer_name, o.customer_phone, o.total_amt, o.final_payment,
      o.branch_id, o.order_date, o.order_time
    ORDER BY o.created_at DESC;
  `;
  try {
    const { rows } = await conn.query(query, [branch_id]);
    return rows || [];
  } catch (error) {
    throw new Error("Failed to fetch ordered data: " + error.message);
  }
};

exports.createtmpOrder = async (orderData) => {
  try {
    await conn.query("BEGIN");

    if (orderData.api_order_id) {
      const existing = await conn.query(`SELECT * FROM tbl_tmp_orders WHERE api_order_id = $1 LIMIT 1`, [orderData.api_order_id]);
      if (existing.rowCount > 0) { await conn.query("COMMIT"); return existing.rows[0]; }
    }

    if (orderData.order_type === "Dine-In" && orderData.table_no) {
      const existing = await conn.query(
        `SELECT * FROM tbl_tmp_orders WHERE branch_id = $1 AND table_no = $2 AND final_payment = false LIMIT 1`,
        [orderData.branch_id, orderData.table_no]
      );
      if (existing.rowCount > 0) { await conn.query("COMMIT"); return existing.rows[0]; }
    }

    const api_order_id = orderData.api_order_id || randomUUID();
    const legacy_order_ref = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    let subtotal = 0, total_tax = 0, no_of_items = 0;
    for (const item of orderData.items) {
      const taxData = calculateItemTax(item);
      subtotal += taxData.base;
      total_tax += taxData.tax_amount;
      no_of_items += 1;
    }
    const total_amt = subtotal + total_tax;

    const result = await conn.query(
      `INSERT INTO tbl_tmp_orders (
        zodu_id, branch_id, api_order_id, legacy_order_ref,
        table_no, order_type, no_of_items, customer_name, customer_phone,
        subtotal, total_tax, total_amt, final_payment, payment_type, order_date, order_time
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,false,$13,CURRENT_DATE,CURRENT_TIME)
      ON CONFLICT (api_order_id) DO UPDATE SET
        subtotal = EXCLUDED.subtotal, total_tax = EXCLUDED.total_tax,
        total_amt = EXCLUDED.total_amt, no_of_items = EXCLUDED.no_of_items
      RETURNING *`,
      [
        orderData.zodu_id, orderData.branch_id, api_order_id, legacy_order_ref,
        orderData.table_no, orderData.order_type, no_of_items,
        orderData.customer_name || null, orderData.customer_phone || null,
        subtotal, total_tax, total_amt, orderData.payment_type || null
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
    if (!Array.isArray(items) || items.length === 0) throw new Error("Items array is empty or invalid");

    const insertedItems = [];
    for (const item of items) {
      const hasVariant = !!item.variant_id;
      const taxData = calculateItemTax(item);

      const checkQuery = hasVariant
        ? `SELECT * FROM tbl_tmp_ordered_items WHERE api_order_id = $1 AND item_id = $2 AND variant_id = $3`
        : `SELECT * FROM tbl_tmp_ordered_items WHERE api_order_id = $1 AND item_id = $2 AND variant_id IS NULL`;
      const checkValues = hasVariant
        ? [orderData.api_order_id, item.menu_id, item.variant_id]
        : [orderData.api_order_id, item.menu_id];

      const existingItem = await conn.query(checkQuery, checkValues);

      if (existingItem.rowCount > 0) {
        const updateQuery = hasVariant
          ? `UPDATE tbl_tmp_ordered_items SET qty=qty+$1,gst_percentage=$2,tax_amount=tax_amount+$3,cgst=cgst+$4,sgst=sgst+$5 WHERE api_order_id=$6 AND item_id=$7 AND variant_id=$8 RETURNING *`
          : `UPDATE tbl_tmp_ordered_items SET qty=qty+$1,gst_percentage=$2,tax_amount=tax_amount+$3,cgst=cgst+$4,sgst=sgst+$5 WHERE api_order_id=$6 AND item_id=$7 AND variant_id IS NULL RETURNING *`;
        const updateValues = hasVariant
          ? [item.qty, taxData.gst_percentage, taxData.tax_amount, taxData.cgst, taxData.sgst, orderData.api_order_id, item.menu_id, item.variant_id]
          : [item.qty, taxData.gst_percentage, taxData.tax_amount, taxData.cgst, taxData.sgst, orderData.api_order_id, item.menu_id];
        const result = await conn.query(updateQuery, updateValues);
        insertedItems.push(result.rows[0]);
      } else {
        const result = await conn.query(
          `INSERT INTO tbl_tmp_ordered_items (
            zodu_id, branch_id, api_order_id, item_id, item_name,
            qty, price, item_unit, variant_id, variant_name,
            gst_percentage, tax_amount, cgst, sgst, tax_inclusive
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,false) RETURNING *`,
          [
            orderData.zodu_id, orderData.branch_id, orderData.api_order_id,
            item.menu_id, item.name, item.qty, item.price, item.menu_unit,
            hasVariant ? item.variant_id : null, hasVariant ? item.variant_name : null,
            taxData.gst_percentage, taxData.tax_amount, taxData.cgst, taxData.sgst
          ]
        );
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

exports.createKOT = async (orderData) => {
  try {
    await conn.query("BEGIN");
    const items = orderData.items;
    if (!Array.isArray(items) || items.length === 0) throw new Error("Items array is empty or invalid");

    const insertedItems = [];
    for (const item of items) {
      const itemName = item.variant_name && item.variant_name.trim() !== "" ? item.variant_name : item.name;
      const result = await conn.query(
        `INSERT INTO tbl_kot_list (zodu_id, branch_id, api_order_id, legacy_order_ref, kot_no, table_no, item_id, item_name, qty)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [orderData.zodu_id, orderData.branch_id, orderData.api_order_id, orderData.legacy_order_ref, orderData.kot_no, orderData.table_no, item.menu_id, itemName, item.qty]
      );
      insertedItems.push(result.rows[0]);
    }

    await conn.query("COMMIT");
    return insertedItems;
  } catch (err) {
    await conn.query("ROLLBACK");
    throw new Error("Unable to create KOT: " + err.message);
  }
};
