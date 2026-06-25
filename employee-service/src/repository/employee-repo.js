const db = require('../database/connection');

// ── AUTO GENERATE EMPLOYEE CODE ──────────────────────────────────────────────
// Gets max number from existing codes like EMP001, EMP002 → returns EMP003

exports.generateEmployeeCode = async (client, zodu_id) => {
  const { rows } = await client.query(
    `SELECT MAX(CAST(NULLIF(REGEXP_REPLACE(employee_code, '[^0-9]', '', 'g'), '') AS INTEGER)) AS max_num
     FROM tbl_employees
     WHERE zodu_id = $1`,
    [zodu_id]
  );
  const next = (rows[0].max_num || 0) + 1;
  return `EMP${String(next).padStart(3, '0')}`;
};

// ── CREATE ────────────────────────────────────────────────────────────────────

exports.createEmployee = async (client, d) => {
  const { rows } = await client.query(
    `INSERT INTO tbl_employees (
      employee_id, employee_code, user_id, zodu_id, branch_id,
      name, phone, email, status,
      date_of_birth, gender, address_line1, address_line2, city, state, pincode,
      employment_type, date_of_joining, reporting_manager_id, reporting_manager_name,
      notes, created_by, updated_by
    ) VALUES (
      $1,$2,$3,$4,$5,
      $6,$7,$8,$9,
      $10,$11,$12,$13,$14,$15,$16,
      $17,$18,$19,$20,
      $21,$22,$23
    ) RETURNING *`,
    [
      d.employee_id, d.employee_code, d.user_id, d.zodu_id, d.branch_id,
      d.name, d.phone, d.email, d.status || 'active',
      d.date_of_birth || null, d.gender || null,
      d.address_line1 || null, d.address_line2 || null,
      d.city || null, d.state || null, d.pincode || null,
      d.employment_type || null, d.date_of_joining || null,
      d.reporting_manager_id || null, d.reporting_manager_name || null,
      d.notes || null, d.created_by || null, d.created_by || null,
    ]
  );
  return rows[0];
};

// ── EMERGENCY CONTACT ─────────────────────────────────────────────────────────

exports.upsertEmergencyContact = async (client, d) => {
  // Check if record exists
  const { rows: existing } = await client.query(
    `SELECT id FROM tbl_employee_emergency_contacts WHERE employee_id = $1`,
    [d.employee_id]
  );

  if (existing.length === 0) {
    // INSERT — mobile_number required for new record
    if (!d.mobile_number) return null;
    const { rows } = await client.query(
      `INSERT INTO tbl_employee_emergency_contacts
         (employee_id, zodu_id, branch_id, contact_name, relationship, mobile_number)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [d.employee_id, d.zodu_id, d.branch_id, d.contact_name, d.relationship || null, d.mobile_number]
    );
    return rows[0];
  }

  // UPDATE — only update fields that are present
  const sets = [], vals = [];
  let idx = 1;
  if (d.contact_name  !== undefined) { sets.push(`contact_name = $${idx++}`);  vals.push(d.contact_name); }
  if (d.relationship  !== undefined) { sets.push(`relationship = $${idx++}`);  vals.push(d.relationship || null); }
  if (d.mobile_number !== undefined) { sets.push(`mobile_number = $${idx++}`); vals.push(d.mobile_number); }
  if (!sets.length) return null;

  sets.push('updated_at = NOW()');
  vals.push(d.employee_id);

  const { rows } = await client.query(
    `UPDATE tbl_employee_emergency_contacts SET ${sets.join(', ')}
     WHERE employee_id = $${idx} RETURNING *`,
    vals
  );
  return rows[0];
};

// ── LIST ──────────────────────────────────────────────────────────────────────

exports.findAll = async ({ zodu_id, branch_id, status, search, limit, offset }) => {
  const conds = ['e.zodu_id = $1', 'e.branch_id = $2'];
  const vals  = [zodu_id, branch_id];
  let   idx   = 3;

  if (status) { conds.push(`e.status = $${idx++}`); vals.push(status); }
  if (search) {
    conds.push(`(e.name ILIKE $${idx} OR e.employee_code ILIKE $${idx})`);
    vals.push(`%${search}%`);
    idx++;
  }

  vals.push(limit, offset);

  const { rows } = await db.query(
    `SELECT
       e.employee_id, e.employee_code, e.name, e.phone, e.email,
       e.status, e.employment_type,
       TO_CHAR(e.date_of_joining, 'YYYY-MM-DD') AS date_of_joining,
       e.reporting_manager_name, e.branch_id, e.created_at
     FROM tbl_employees e
     WHERE ${conds.join(' AND ')}
     ORDER BY e.created_at DESC
     LIMIT $${idx++} OFFSET $${idx}`,
    vals
  );
  return rows;
};

exports.countAll = async ({ zodu_id, branch_id, status, search }) => {
  const conds = ['zodu_id = $1', 'branch_id = $2'];
  const vals  = [zodu_id, branch_id];
  let   idx   = 3;

  if (status) { conds.push(`status = $${idx++}`); vals.push(status); }
  if (search) {
    conds.push(`(name ILIKE $${idx} OR employee_code ILIKE $${idx})`);
    vals.push(`%${search}%`);
    idx++;
  }

  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS total FROM tbl_employees WHERE ${conds.join(' AND ')}`,
    vals
  );
  return rows[0].total;
};

// ── DETAIL ────────────────────────────────────────────────────────────────────

exports.findById = async (employee_id, { zodu_id, branch_id }) => {
  const { rows } = await db.query(
    `SELECT
       e.*,
       TO_CHAR(e.date_of_birth,  'YYYY-MM-DD') AS date_of_birth,
       TO_CHAR(e.date_of_joining, 'YYYY-MM-DD') AS date_of_joining,
       ec.contact_name  AS emergency_contact_name,
       ec.relationship  AS emergency_relationship,
       ec.mobile_number AS emergency_mobile
     FROM tbl_employees e
     LEFT JOIN tbl_employee_emergency_contacts ec ON ec.employee_id = e.employee_id
     WHERE e.employee_id = $1 AND e.zodu_id = $2 AND e.branch_id = $3`,
    [employee_id, zodu_id, branch_id]
  );
  return rows[0] || null;
};

exports.findDocuments = async (employee_id) => {
  const { rows } = await db.query(
    `SELECT * FROM tbl_employee_documents
     WHERE employee_id = $1 ORDER BY created_at DESC`,
    [employee_id]
  );
  return rows;
};

// ── UPDATE ────────────────────────────────────────────────────────────────────

const UPDATABLE_FIELDS = [
  'name','phone','email','status',
  'date_of_birth','gender','address_line1','address_line2','city','state','pincode',
  'employment_type','date_of_joining','reporting_manager_id','reporting_manager_name',
  'notes','updated_by',
];

exports.updateEmployee = async (client, employee_id, fields) => {
  const sets = [], vals = [];
  let   idx  = 1;

  for (const key of UPDATABLE_FIELDS) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = $${idx++}`);
      vals.push(fields[key]);
    }
  }
  if (!sets.length) return null;

  sets.push('updated_at = NOW()');
  vals.push(employee_id, fields.zodu_id, fields.branch_id);

  const { rows } = await client.query(
    `UPDATE tbl_employees SET ${sets.join(', ')}
     WHERE employee_id = $${idx++} AND zodu_id = $${idx++} AND branch_id = $${idx}
     RETURNING *,
       TO_CHAR(date_of_birth, 'YYYY-MM-DD')  AS date_of_birth,
       TO_CHAR(date_of_joining, 'YYYY-MM-DD') AS date_of_joining`,
    vals
  );
  return rows[0] || null;
};

// ── SOFT DELETE ───────────────────────────────────────────────────────────────

exports.softDelete = async (employee_id, { zodu_id, branch_id }) => {
  const { rowCount } = await db.query(
    `UPDATE tbl_employees SET status = 'inactive', updated_at = NOW()
     WHERE employee_id = $1 AND zodu_id = $2 AND branch_id = $3`,
    [employee_id, zodu_id, branch_id]
  );
  return rowCount > 0;
};

// ── DOCUMENTS ─────────────────────────────────────────────────────────────────

exports.insertDocument = async (client, d) => {
  const { rows } = await client.query(
    `INSERT INTO tbl_employee_documents
       (employee_id, zodu_id, branch_id, document_type, file_name, file_url, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [d.employee_id, d.zodu_id, d.branch_id, d.document_type, d.file_name, d.file_url, d.uploaded_by || null]
  );
  return rows[0];
};

exports.deleteDocument = async (id, employee_id) => {
  const { rows } = await db.query(
    `DELETE FROM tbl_employee_documents
     WHERE id = $1 AND employee_id = $2 RETURNING file_url`,
    [id, employee_id]
  );
  return rows[0] || null;
};
