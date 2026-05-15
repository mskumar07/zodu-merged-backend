const conn = require("../database/connection");

// ── EXPENSE ITEM CATALOG (tbl_expense_item) ──────────────────────

exports.getCatalogItems = async ({ zodu_id, branch_id, category_id, search } = {}) => {
  const conditions = [];
  const values = [];
  let idx = 1;

  if (zodu_id)     { conditions.push(`ei.zodu_id = $${idx++}`);     values.push(zodu_id); }
  if (branch_id)   { conditions.push(`ei.branch_id = $${idx++}`);   values.push(branch_id); }
  if (category_id) { conditions.push(`ei.category_id = $${idx++}`); values.push(category_id); }
  if (search) {
    conditions.push(`ei.item_name ILIKE $${idx++}`);
    values.push(`%${search}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const { rows } = await conn.query(
    `SELECT ei.*, c.name AS category_name
     FROM tbl_expense_item ei
     LEFT JOIN tbl_category c ON c.id = ei.category_id
     ${where}
     ORDER BY ei.item_name ASC`,
    values
  );
  return rows;
};

exports.createCatalogItem = async (data) => {
  const { rows } = await conn.query(
    `INSERT INTO tbl_expense_item (zodu_id, branch_id, item_name, category_id)
     VALUES ($1,$2,$3,$4)
     RETURNING *`,
    [data.zodu_id, data.branch_id, data.item_name, data.category_id || null]
  );
  return rows[0];
};

exports.updateCatalogItem = async (id, data) => {
  const { rows } = await conn.query(
    `UPDATE tbl_expense_item
     SET item_name = $1, category_id = $2, active = $3, updated_at = NOW()
     WHERE id = $4
     RETURNING *`,
    [data.item_name, data.category_id || null, data.active !== false, id]
  );
  return rows[0];
};

exports.deleteCatalogItem = async (id) => {
  await conn.query(`DELETE FROM tbl_expense_item WHERE id = $1`, [id]);
};

// ── EXPENSE (tbl_expense) ────────────────────────────────────────

exports.createExpense = async (client, data) => {
  const totalAmount = Number(data.total_amount) || 0;
  const paidAmount  = Number(data.paid_amount)  || 0;

  const { rows } = await client.query(
    `INSERT INTO tbl_expense (
       expense_id, zodu_id, branch_id,
       expense_date, category_id, vendor_id,
       total_amount, paid_amount,
       payment_status, notes, attachment_url, due_date
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
       CASE
         WHEN $8::numeric >= $7::numeric THEN 'paid'
         WHEN $8::numeric = 0            THEN 'pending'
         ELSE 'partial'
       END,
     $9,$10,$11)
     RETURNING *`,
    [
      data.expense_id,
      data.zodu_id,
      data.branch_id,
      data.expense_date,
      data.category_id    || null,
      data.vendor_id      || null,
      totalAmount,
      paidAmount,
      data.notes          || null,
      data.attachment_url ? JSON.stringify(data.attachment_url) : null,
      data.due_date       || null,
    ]
  );
  return rows[0];
};

exports.createExpenseLineItems = async (client, items, expense_id) => {
  for (const item of items) {
    await client.query(
      `INSERT INTO tbl_expense_items (expense_id, item_id, item_name, qty, price, category_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        expense_id,
        item.item_id    || null,
        item.item_name,
        item.qty,
        item.price,
        item.category_id || null,
      ]
    );
  }
};

exports.getExpenses = async ({ zodu_id, branch_id, category_id, vendor_id, payment_status, search } = {}) => {
  const conditions = [];
  const values = [];
  let idx = 1;

  if (zodu_id)        { conditions.push(`e.zodu_id = $${idx++}`);         values.push(zodu_id); }
  if (branch_id)      { conditions.push(`e.branch_id = $${idx++}`);       values.push(branch_id); }
  if (category_id)    { conditions.push(`e.category_id = $${idx++}`);     values.push(category_id); }
  if (vendor_id)      { conditions.push(`e.vendor_id = $${idx++}`);       values.push(vendor_id); }
  if (payment_status) { conditions.push(`e.payment_status = $${idx++}`);  values.push(payment_status); }
  if (search) {
    conditions.push(`(e.expense_id ILIKE $${idx} OR e.notes ILIKE $${idx})`);
    values.push(`%${search}%`);
    idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const { rows } = await conn.query(
    `SELECT
       e.*,
       c.name AS category_name,
       v.vendor_name,
       v.company_name,
       TO_CHAR(e.expense_date, 'DD Mon YYYY') AS expense_date_formatted,
       TO_CHAR(e.due_date,     'DD Mon YYYY') AS due_date_formatted
     FROM tbl_expense e
     LEFT JOIN tbl_category c ON c.id = e.category_id
     LEFT JOIN tbl_vendor v ON v.vendor_id = e.vendor_id AND v.zodu_id = e.zodu_id AND v.branch_id = e.branch_id
     ${where}
     ORDER BY e.expense_date DESC, e.created_at DESC NULLS LAST`,
    values
  );
  return rows;
};

exports.getExpenseById = async (id, { branch_id, zodu_id } = {}) => {
  const conditions = [`e.expense_id = $1`];
  const values = [id];

  if (branch_id) { values.push(branch_id); conditions.push(`e.branch_id = $${values.length}`); }
  if (zodu_id)   { values.push(zodu_id);   conditions.push(`e.zodu_id = $${values.length}`); }

  const { rows: expenseRows } = await conn.query(
    `SELECT
       e.*,
       c.name AS category_name,
       TO_CHAR(e.expense_date, 'DD Mon YYYY') AS expense_date_formatted,
       TO_CHAR(e.due_date,     'DD Mon YYYY') AS due_date_formatted
     FROM tbl_expense e
     LEFT JOIN tbl_category c ON c.id = e.category_id
     WHERE ${conditions.join(" AND ")}`,
    values
  );

  const expense = expenseRows[0];
  if (!expense) return null;

  const { rows: items } = await conn.query(
    `SELECT
       ei.*,
       c.name AS category_name
     FROM tbl_expense_items ei
     LEFT JOIN tbl_category c ON c.id = ei.category_id
     WHERE ei.expense_id = $1
     ORDER BY ei.expense_item_id ASC`,
    [expense.expense_id]
  );

  const { rows: payments } = await conn.query(
    `SELECT *,
       TO_CHAR(payment_date, 'DD Mon YYYY') AS payment_date_formatted
     FROM tbl_expense_payment
     WHERE expense_id = $1
     ORDER BY payment_date ASC, created_at ASC`,
    [expense.expense_id]
  );

  return { ...expense, items, payments };
};

exports.getExpenseByIdForUpdate = async (client, expense_id) => {
  const { rows } = await client.query(
    `SELECT * FROM tbl_expense WHERE expense_id = $1 FOR UPDATE`,
    [expense_id]
  );
  return rows[0];
};

exports.getExpenseLineItems = async (client, expense_id) => {
  const { rows } = await client.query(
    `SELECT * FROM tbl_expense_items WHERE expense_id = $1`,
    [expense_id]
  );
  return rows;
};

exports.deleteExpenseLineItems = async (client, expense_id) => {
  await client.query(`DELETE FROM tbl_expense_items WHERE expense_id = $1`, [expense_id]);
};

exports.updateExpense = async (client, expense_id, data) => {
  const totalAmount = Number(data.total_amount) || 0;
  const paidAmount  = Number(data.paid_amount)  || 0;

  await client.query(
    `UPDATE tbl_expense
     SET expense_date   = $1,
         category_id    = $2,
         vendor_id      = $3,
         total_amount   = $4::numeric,
         paid_amount    = $5::numeric,
         payment_status = CASE
                            WHEN $5::numeric >= $4::numeric THEN 'paid'
                            WHEN $5::numeric = 0            THEN 'pending'
                            ELSE 'partial'
                          END,
         notes          = $6,
         attachment_url = $7,
         updated_at     = NOW()
     WHERE expense_id = $8`,
    [
      data.expense_date,
      data.category_id    || null,
      data.vendor_id      || null,
      totalAmount,
      paidAmount,
      data.notes          || null,
      data.attachment_url ? JSON.stringify(data.attachment_url) : null,
      String(expense_id),
    ]
  );
};

exports.deleteExpensePayments = async (client, expense_id) => {
  await client.query(`DELETE FROM tbl_expense_payment WHERE expense_id = $1`, [expense_id]);
};

exports.deleteExpense = async (client, expense_id) => {
  await client.query(`DELETE FROM tbl_expense WHERE expense_id = $1`, [expense_id]);
};

exports.createExpensePayment = async (client, data) => {
  await client.query(
    `INSERT INTO tbl_expense_payment (
       expense_id, zodu_id, branch_id,
       payment_date, paid_amount,
       transaction_type, transaction_id, status
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      data.expense_id,
      data.zodu_id,
      data.branch_id,
      data.payment_date,
      data.paid_amount,
      data.transaction_type || "cash",
      data.transaction_id   || null,
      data.status           || "completed",
    ]
  );
};
