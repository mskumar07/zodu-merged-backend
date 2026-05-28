const conn = require("../database/connection");
const repo = require("../repository/expense-repo");

// ── EXPENSE ITEM CATALOG ─────────────────────────────────────────

exports.getCatalogItems = async (params = {}) => {
  try {
    const data = await repo.getCatalogItems(params);
    return { success: true, data };
  } catch (err) {
    return { success: false, message: err.message };
  }
};

exports.createCatalogItem = async (data) => {
  try {
    if (!data.item_name || !data.zodu_id || !data.branch_id) {
      return { success: false, message: "item_name, zodu_id and branch_id are required" };
    }
    const item = await repo.createCatalogItem(data);
    return { success: true, data: item };
  } catch (err) {
    return { success: false, message: err.message };
  }
};

exports.updateCatalogItem = async (id, data) => {
  try {
    const item = await repo.updateCatalogItem(id, data);
    if (!item) return { success: false, message: "Item not found" };
    return { success: true, data: item };
  } catch (err) {
    return { success: false, message: err.message };
  }
};

exports.deleteCatalogItem = async (id) => {
  try {
    await repo.deleteCatalogItem(id);
    return { success: true, message: "Deleted successfully" };
  } catch (err) {
    return { success: false, message: err.message };
  }
};

// ── EXPENSE ──────────────────────────────────────────────────────

exports.createExpense = async (data) => {
  const client = await conn.connect();
  try {
    await client.query("BEGIN");

    const expense_id = "EXP-" + Date.now();

    const expense = await repo.createExpense(client, { ...data, expense_id });

    if (data.items && data.items.length > 0) {
      await repo.createExpenseLineItems(client, data.items, expense_id);
    }

    if (data.paid_amount && data.paid_amount > 0) {
      await repo.createExpensePayment(client, {
        expense_id,
        zodu_id:          data.zodu_id,
        branch_id:        data.branch_id,
        payment_date:     data.payment_date,
        paid_amount:      data.paid_amount,
        transaction_type: data.transaction_type || "cash",
        transaction_id:   data.transaction_id   || null,
        status:           "completed",
      });
    }

    await client.query("COMMIT");
    return { success: true, data: expense };
  } catch (err) {
    await client.query("ROLLBACK");
    console.log("Error creating expense:", err);
    return { success: false, message: err.message };
  } finally {
    client.release();
  }
};

exports.getExpenses = async (params = {}) => {
  try {
    const { data, currentPage, totalPages, totalRecords, limit } = await repo.getExpenses(params);
    return { success: true, data, currentPage, totalPages, totalRecords, limit };
  } catch (err) {
    return { success: false, message: err.message };
  }
};

exports.getExpenseById = async (id, params = {}) => {
  try {
    const data = await repo.getExpenseById(id, params);
    if (!data) return { success: false, message: "Not found" };
    return { success: true, data };
  } catch (err) {
    return { success: false, message: err.message };
  }
};

exports.getExpenseSummary = async ({ zodu_id, branch_id }) => {
  try {
    const { rows } = await conn.query(
      `SELECT
         COUNT(*)::text                                           AS total_expense_count,
         COALESCE(SUM(paid_amount),    0)::text                  AS total_paid_amount,
         COALESCE(SUM(balance_amount), 0)::text                  AS total_unpaid_amount,
         COALESCE(SUM(
           CASE WHEN payment_status = 'pending' THEN total_amount ELSE 0 END
         ), 0)::text                                             AS pending_amount,
         COALESCE(SUM(
           CASE
             WHEN DATE_TRUNC('month', expense_date) = DATE_TRUNC('month', CURRENT_DATE)
             THEN total_amount ELSE 0
           END
         ), 0)::text                                             AS this_month_spent,
         COALESCE(SUM(
           CASE
             WHEN DATE_TRUNC('month', expense_date) = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
             THEN total_amount ELSE 0
           END
         ), 0)::text                                             AS last_month_spent
       FROM tbl_expense
       WHERE zodu_id = $1 AND branch_id = $2`,
      [zodu_id, branch_id]
    );
    return { success: true, data: rows[0] };
  } catch (err) {
    return { success: false, message: err.message };
  }
};

exports.updateExpense = async (expense_id, data) => {
  const client = await conn.connect();
  try {
    await client.query("BEGIN");

    const old = await repo.getExpenseByIdForUpdate(client, expense_id);
    if (!old) {
      await client.query("ROLLBACK");
      return { success: false, message: "Expense not found" };
    }

    await repo.deleteExpenseLineItems(client, expense_id);
    await repo.updateExpense(client, expense_id, data);

    if (data.items && data.items.length > 0) {
      await repo.createExpenseLineItems(client, data.items, expense_id);
    }

    const oldPaid  = Number(old.paid_amount || 0);
    const newPaid  = Number(data.paid_amount || 0);
    const paidDiff = newPaid - oldPaid;

    if (paidDiff > 0) {
      await repo.createExpensePayment(client, {
        expense_id,
        zodu_id:          old.zodu_id,
        branch_id:        old.branch_id,  
        payment_date:     data.payment_date,
        paid_amount:      paidDiff,
        transaction_type: data.transaction_type || "cash",
        transaction_id:   data.transaction_id   || null,
        status:           "completed",
      });
    }

    await client.query("COMMIT");
    return { success: true, message: "Updated successfully" };
  } catch (err) {
    await client.query("ROLLBACK");
    return { success: false, message: err.message };
  } finally {
    client.release();
  }
};

exports.deleteExpense = async (expense_id) => {
  const client = await conn.connect();
  try {
    await client.query("BEGIN");

    const expense = await repo.getExpenseByIdForUpdate(client, expense_id);
    if (!expense) {
      await client.query("ROLLBACK");
      return { success: false, message: "Expense not found" };
    }

    await repo.deleteExpenseLineItems(client, expense_id);
    await repo.deleteExpensePayments(client, expense_id);
    await repo.deleteExpense(client, expense_id);

    await client.query("COMMIT");
    return { success: true, message: "Deleted successfully" };
  } catch (err) {
    await client.query("ROLLBACK");
    return { success: false, message: err.message };
  } finally {
    client.release();
  }
};

exports.markPayment = async (expense_id, data) => {
  const client = await conn.connect();
  try {
    await client.query("BEGIN");

    await repo.createExpensePayment(client, { expense_id, ...data });

    const updated = await client.query(
      `UPDATE tbl_expense
       SET paid_amount = paid_amount + $1,
           payment_status =
             CASE
               WHEN (paid_amount + $1) >= total_amount THEN 'paid'
               WHEN (paid_amount + $1) = 0             THEN 'pending'
               ELSE 'partial'
             END,
           updated_at = NOW()
       WHERE expense_id = $2
       RETURNING *`,
      [data.paid_amount, expense_id]
    );

    await client.query("COMMIT");
    return { success: true, data: updated.rows[0] };
  } catch (err) {
    await client.query("ROLLBACK");
    return { success: false, message: err.message };
  } finally {
    client.release();
  }
};
