const db   = require('../database/connection');
const repo = require('../repository/salary-repo');

exports.createSalary = async (data) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const salary = await repo.create(client, data);
    await client.query('COMMIT');
    return { success: true, data: salary };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

exports.getSalary = async (employee_id) => {
  const salary = await repo.findActive(employee_id);
  return { success: true, data: salary || null };
};

exports.getSalaryHistory = async (employee_id) => {
  const data = await repo.findHistory(employee_id);
  return { success: true, data };
};

exports.getSalaryList = async ({ zodu_id, branch_id, page = 1, limit = 10 }) => {
  const parsedLimit  = Math.min(parseInt(limit, 10) || 10, 100);
  const parsedOffset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * parsedLimit;
  const data = await repo.findList({ zodu_id, branch_id, limit: parsedLimit, offset: parsedOffset });
  return { success: true, data };
};

exports.updateSalary = async (employee_id, data) => {
  const existing = await repo.findActive(employee_id);
  if (!existing) throw new Error('No active salary record found');

  const fields = {};
  if (data.basic_salary        !== undefined) fields.basic_salary        = data.basic_salary;
  if (data.allowances          !== undefined) fields.allowances          = data.allowances;
  if (data.payment_type        !== undefined) fields.payment_type        = data.payment_type;
  if (data.bank_name           !== undefined) fields.bank_name           = data.bank_name;
  if (data.ifsc_code           !== undefined) fields.ifsc_code           = data.ifsc_code;
  if (data.bank_account_number !== undefined && !String(data.bank_account_number).includes('X')) {
    fields.bank_account_number = data.bank_account_number;
  }

  if (!Object.keys(fields).length) throw new Error('No salary fields to update');

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const salary = await repo.updateActive(client, employee_id, fields);
    await client.query('COMMIT');
    return { success: true, data: salary };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};
