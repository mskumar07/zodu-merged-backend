const conn = require("../database/connection");




const INV_COLS = `
  i.item_uuid,
  i.item_id,
  i.zodu_id,
  i.branch_id,
  m.menu_name      AS item_name,
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


exports.createPurchase = async (client, data) => {
  const { rows } = await client.query(
    `INSERT INTO tbl_purchase (
      purchase_id, zodu_id, branch_id,
      purchase_date, vendor_id,
      total_amount, paid_amount,
      payment_status, notes, attachment_url,due_date
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING *`,
    [
      data.purchase_id,
      data.zodu_id,
      data.branch_id,
      data.purchase_date,
      data.vendor_id || null,
      data.total_amount,
      data.paid_amount || 0,
      data.payment_status || "pending",
      data.notes || null,
      data.attachment_url ? JSON.stringify(data.attachment_url) : null,
      data.due_date || null,
    ]
  );
  return rows[0];
};

exports.createPurchaseItems = async (client, items, purchase_id) => {
  for (const item of items) {
    await client.query(
      `INSERT INTO tbl_purchase_items (
        purchase_id, item_id, item_name,
        qty, unit, purchase_price,
        gst_percentage, tax_amount, cgst, sgst,
        category_id, item_uuid
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        purchase_id,
        item.item_id || null,
        item.item_name,
        item.qty,
        item.unit || null,
        item.purchase_price != null && item.purchase_price !== "NULL" ? Number(item.purchase_price) : null,
        item.gst_percentage != null && item.gst_percentage !== "NULL" ? Number(item.gst_percentage) : null,
        item.tax_amount     != null && item.tax_amount     !== "NULL" ? Number(item.tax_amount)     : null,
        item.cgst           != null && item.cgst           !== "NULL" ? Number(item.cgst)           : null,
        item.sgst           != null && item.sgst           !== "NULL" ? Number(item.sgst)           : null,
        item.category_id    != null && item.category_id    !== "NULL" ? Number(item.category_id)    : null,
        item.item_uuid || null,
      ]
    );
  }
};

exports.getPurchases = async ({
  zodu_id,
  branch_id,
  vendor_id,
  payment_status,
  search,
} = {}) => {
  const conditions = [];
  const values = [];
  let idx = 1;

  if (zodu_id) {
    conditions.push(`p.zodu_id = $${idx++}`);
    values.push(zodu_id);
  }
  if (branch_id) {
    conditions.push(`p.branch_id = $${idx++}`);
    values.push(branch_id);
  }
  if (vendor_id) {
    conditions.push(`p.vendor_id = $${idx++}`);
    values.push(vendor_id);
  }
  if (payment_status) {
    conditions.push(`p.payment_status = $${idx++}`);
    values.push(payment_status);
  }
  if (search) {
    conditions.push(
      `(p.purchase_id ILIKE $${idx} OR p.vendor_id ILIKE $${idx} OR v.vendor_name ILIKE $${idx})`
    );
    values.push(`%${search}%`);
    idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const { rows } = await conn.query(
    `SELECT
       p.*,
       TO_CHAR(p.purchase_date, 'DD Mon YYYY') AS purchase_date_formatted,
       TO_CHAR(p.due_date, 'DD Mon YYYY') AS due_date_formatted,
       v.vendor_name,
       v.company_name,
       v.vendor_phone
     FROM tbl_purchase p
     LEFT JOIN tbl_vendor v ON v.vendor_id = p.vendor_id AND p.zodu_id = v.zodu_id AND p.branch_id = v.branch_id
     ${where}
     ORDER BY p.purchase_date DESC, p.created_at DESC NULLS LAST`,
    values
  );

  return rows;
};

exports.getPurchaseById = async (id, { branch_id, zodu_id } = {}) => {
  const conditions = [`p.purchase_id = $1`];
  const values = [id];

  if (branch_id) {
    values.push(branch_id);
    conditions.push(`p.branch_id = $${values.length}`);
  }
  if (zodu_id) {
    values.push(zodu_id);
    conditions.push(`p.zodu_id = $${values.length}`);
  }

  // ── 1. Purchase header + vendor ─────────────────────────────
 const { rows: purchaseRows } = await conn.query(
  `SELECT
     p.*,
     TO_CHAR(p.purchase_date, 'DD Mon YYYY') AS purchase_date_formatted,
     TO_CHAR(p.due_date, 'DD Mon YYYY') AS due_date_formatted,
     v.vendor_name,
     v.company_name,
     v.vendor_phone,
     v.vendor_email,
     v.vendor_address_1,
     v.vendor_address_2,
     v.city,
     v.state,
     v.pincode,
     v.gst AS vendor_gst
   FROM tbl_purchase p
   LEFT JOIN tbl_vendor v ON v.vendor_id = p.vendor_id AND p.zodu_id = v.zodu_id AND p.branch_id = v.branch_id
   WHERE ${conditions.join(" AND ")}`,
  values
);

  const purchase = purchaseRows[0];
  if (!purchase) return null;

  // ── 2. Purchase items ────────────────────────────────────────
const { rows: items } = await conn.query(
  `SELECT
     pi.purchase_item_id,
     pi.item_id,
     pi.item_uuid,
     pi.item_name,
     pi.qty,
     pi.unit,
     pi.purchase_price,
     pi.gst_percentage,
     pi.tax_amount,
     pi.cgst,
     pi.sgst,
     pi.subtotal,
     pi.total_price,
     pi.category_id,
     mi.hsn_code                -- 🔥 ADDED
   FROM tbl_purchase_items pi
   LEFT JOIN tbl_menu_items mi 
     ON mi.menu_id = pi.item_id AND mi.branch_id = $3 AND mi.zodu_id = $2  -- 🔥 JOIN WITH MENU ITEMS TO GET HSN CODE
   WHERE pi.purchase_id = $1
   ORDER BY pi.purchase_item_id ASC`,
  [purchase.purchase_id, purchase.zodu_id, purchase.branch_id]
);

console.log(items)

  // ── 3. Payment history ───────────────────────────────────────
  const { rows: payments } = await conn.query(
    `SELECT
       pp.payment_id,
     TO_CHAR(pp.payment_date, 'DD Mon YYYY') AS payment_date,
       pp.paid_amount,
       pp.transaction_type,
       pp.transaction_id,
       pp.status,
       pp.created_at
     FROM tbl_purchase_payment pp
     WHERE pp.purchase_id = $1
     ORDER BY pp.payment_date ASC, pp.created_at ASC`,
    [purchase.purchase_id]
  );

  return {
    ...purchase,
    items,
    payments,
  };
};

// Used inside transactions — must use the client
exports.getPurchaseByIdForUpdate = async (client, purchase_id) => {
  const { rows: purchaseRows } = await client.query(
    `SELECT * FROM tbl_purchase WHERE purchase_id = $1 FOR UPDATE`,
    [purchase_id]
  );
  const purchase = purchaseRows[0];
  if (!purchase) return null;

  const { rows: items } = await client.query(
    `SELECT
       tpi.purchase_item_id,
       tpi.item_id,
       tpi.item_uuid,
       tpi.item_name,
       tpi.qty,
       mi.item_uuid  AS menu_item_uuid,
       mi.menu_name,
       mi.menu_type
     FROM tbl_purchase_items tpi
     LEFT JOIN tbl_menu_items mi ON mi.menu_id = tpi.item_id
     WHERE tpi.purchase_id = $1`,
    [purchase_id]
  );

  return { ...purchase, items };
};

exports.getPurchaseItems = async (client, purchase_id) => {
  const { rows } = await client.query(
    `SELECT * FROM tbl_purchase_items WHERE purchase_id = $1`,
    [purchase_id]
  );
  return rows;
};

exports.deletePurchaseItems = async (client, purchase_id) => {
  await client.query(
    `DELETE FROM tbl_purchase_items WHERE purchase_id = $1`,
    [purchase_id]
  );
};

exports.updatePurchase = async (client, purchase_id, data) => {
  const totalAmount = Number(data.total_amount) || 0;
  const paidAmount  = Number(data.paid_amount) || 0;

  await client.query(
    `UPDATE tbl_purchase
     SET vendor_id        = $1,
         purchase_date    = $2,
         total_amount     = $3::numeric,
         paid_amount      = $4::numeric,
         due_date         = $8,
         payment_status   = CASE
                              WHEN $4::numeric >= $3::numeric THEN 'paid'
                              WHEN $4::numeric = 0            THEN 'pending'
                              ELSE 'partial'
                            END,
         notes            = $5,
         attachment_url   = $6,
         updated_at       = NOW()
     WHERE purchase_id = $7::varchar`,   // ✅ FIX HERE
    [
      data.vendor_id || null,
      data.purchase_date,
      totalAmount,
      paidAmount,
      data.notes || null,
      data.attachment_url ? JSON.stringify(data.attachment_url) : null,
      String(purchase_id), // ✅ FORCE STRING
      data.due_date || null,
    ]
  );
};

exports.deletePurchasePayments = async (client, purchase_id) => {
  await client.query(
    `DELETE FROM tbl_purchase_payment WHERE purchase_id = $1`,
    [purchase_id]
  );
};

exports.deletePurchase = async (client, purchase_id) => {
  await client.query(
    `DELETE FROM tbl_purchase WHERE purchase_id = $1`,
    [purchase_id]
  );
};

exports.createPurchasePayment = async (client, data) => {
  await client.query(
    `INSERT INTO tbl_purchase_payment (
      purchase_id, zodu_id, branch_id,
      payment_date, paid_amount,
      transaction_type, transaction_id, status
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      data.purchase_id,
      data.zodu_id,
      data.branch_id,
      data.payment_date,
      data.paid_amount,
      data.transaction_type || "cash",
      data.transaction_id || null,
      data.status || "completed",
    ]
  );
};


exports.getInventoryByItemUuid = async (client, item_uuid) => {
  const { rows } = await client.query(
    `SELECT
       ${INV_COLS},
       ${STOCK_STATUS_EXPR} AS stock_status,
       ROUND(i.stock_qty * COALESCE(NULLIF(m.purchase_price, 'NULL')::numeric, 0), 2) AS stock_value
     ${INV_FROM}
     WHERE i.item_uuid = $1`,
    [item_uuid]
  );
  return rows[0] ?? null;
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
      data.notes || null,
    ]
  );
  return rows[0];
};