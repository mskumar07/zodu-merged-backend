const db = require('../database/connection');

const maskAccount = (row) => {
  if (!row?.bank_account_number) return row;
  const acc = row.bank_account_number;
  return { ...row, bank_account_number: acc.length > 4 ? 'XXXX XXXX ' + acc.slice(-4) : acc };
};

// ── CREATE ────────────────────────────────────────────────────────────────────

exports.create = async (client, d) => {
  const { rows } = await client.query(
    `INSERT INTO tbl_employee_salary
       (employee_id, user_id, zodu_id, branch_id,
        basic_salary, allowances, payment_type,
        bank_account_number, bank_name, ifsc_code,
        is_active, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11)
     RETURNING *`,
    [
      d.employee_id, d.user_id, d.zodu_id, d.branch_id,
      d.basic_salary, d.allowances || 0, d.payment_type || 'Monthly',
      d.bank_account_number || null, d.bank_name || null, d.ifsc_code || null,
      d.created_by || null,
    ]
  );
  return maskAccount(rows[0]);
};

// ── UPDATE ACTIVE RECORD ──────────────────────────────────────────────────────

const UPDATABLE_SALARY_FIELDS = [
  'basic_salary', 'allowances', 'payment_type',
  'bank_account_number', 'bank_name', 'ifsc_code',
];

exports.updateActive = async (client, employee_id, fields) => {
  const sets = [], vals = [];
  let idx = 1;
  console.log('Updating salary for employee_id:', employee_id, 'with fields:', fields);

  for (const key of UPDATABLE_SALARY_FIELDS) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = $${idx++}`);
      vals.push(fields[key]);
    }
  }
  if (!sets.length) return null;

  sets.push('updated_at = NOW()');
  vals.push(employee_id);

  const { rows } = await client.query(
    `UPDATE tbl_employee_salary SET ${sets.join(', ')}
     WHERE employee_id = $${idx} AND is_active = true
     RETURNING *`,
    vals
  );
  return rows[0] ? maskAccount(rows[0]) : null;
};

// ── READ ──────────────────────────────────────────────────────────────────────

exports.findActive = async (employee_id) => {
  const { rows } = await db.query(
    `SELECT * FROM tbl_employee_salary
     WHERE employee_id = $1 AND is_active = true
     ORDER BY created_at DESC LIMIT 1`,
    [employee_id]
  );
  console.log('Found active salary for employee_id:', employee_id, 'result:', rows[0]);
  return rows[0] ? maskAccount(rows[0]) : null;
};

exports.findHistory = async (employee_id) => {
  const { rows } = await db.query(
    `SELECT * FROM tbl_employee_salary
     WHERE employee_id = $1
     ORDER BY created_at DESC`,
    [employee_id]
  );
  return rows.map(maskAccount);
};

exports.findList = async ({ zodu_id, branch_id, limit, offset }) => {
  const conds = ['s.zodu_id = $1', 's.is_active = true'];
  const vals  = [zodu_id];
  let   idx   = 2;

  if (branch_id) { conds.push(`s.branch_id = $${idx++}`); vals.push(branch_id); }
  vals.push(limit, offset);

  const { rows } = await db.query(
    `SELECT s.id, s.employee_id, s.basic_salary, s.allowances,
            s.payment_type, s.branch_id
     FROM tbl_employee_salary s
     WHERE ${conds.join(' AND ')}
     ORDER BY s.created_at DESC
     LIMIT $${idx++} OFFSET $${idx}`,
    vals
  );
  return rows;
};
