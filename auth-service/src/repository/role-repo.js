const conn = require('../database/connection');
const { v4: uuidv4 } = require('uuid');

// ── ROLES ─────────────────────────────────────────────────────────────────────

exports.createRole = async (client, { zodu_id, branch_id, role_name, description }) => {
  const { rows } = await client.query(
    `INSERT INTO tbl_roles (zodu_id, branch_id, role_name, description)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [zodu_id, branch_id, role_name, description || null]
  );
  return rows[0];
};

exports.findRoles = async ({ zodu_id, branch_id }) => {
  const { rows } = await conn.query(
    `SELECT r.*,
       COUNT(DISTINCT ur.user_id)::int AS assigned_users
     FROM tbl_roles r
     LEFT JOIN tbl_user_roles ur ON ur.role_id = r.role_id
     WHERE r.zodu_id = $1 AND (r.role_name = 'Admin' OR r.branch_id = $2)
     GROUP BY r.role_id
     ORDER BY r.created_at ASC`,
    [zodu_id, branch_id]
  );
  return rows;
};

exports.findRoleById = async (role_id, { zodu_id, branch_id }) => {
  const { rows } = await conn.query(
    `SELECT * FROM tbl_roles
     WHERE role_id = $1 AND zodu_id = $2 AND (role_name = 'Admin' OR branch_id = $3)`,
    [role_id, zodu_id, branch_id]
  );
  return rows[0] || null;
};

exports.updateRole = async (client, role_id, { zodu_id, branch_id, role_name, description }) => {
  const sets = [], vals = [];
  let idx = 1;

  if (role_name   !== undefined) { sets.push(`role_name = $${idx++}`);   vals.push(role_name); }
  if (description !== undefined) { sets.push(`description = $${idx++}`); vals.push(description); }
  if (!sets.length) return null;

  sets.push('updated_at = NOW()');
  vals.push(role_id, zodu_id, branch_id);

  const { rows } = await client.query(
    `UPDATE tbl_roles SET ${sets.join(', ')}
     WHERE role_id = $${idx++} AND zodu_id = $${idx++} AND (role_name = 'Admin' OR branch_id = $${idx})
     RETURNING *`,
    vals
  );
  return rows[0] || null;
};

exports.deleteRole = async (client, role_id, { zodu_id, branch_id }) => {
  const { rowCount } = await client.query(
    `DELETE FROM tbl_roles WHERE role_id = $1 AND zodu_id = $2 AND (role_name = 'Admin' OR branch_id = $3)`,
    [role_id, zodu_id, branch_id]
  );
  return rowCount > 0;
};

// ── ACCESS CONTROL ────────────────────────────────────────────────────────────

exports.upsertAccessControl = async (client, { role_id, zodu_id, branch_id, module_id, can_read, can_create, can_edit, can_delete }) => {
  const { rows } = await client.query(
    `INSERT INTO tbl_access_control
       (role_id, zodu_id, branch_id, module_id, can_read, can_create, can_edit, can_delete)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (role_id, module_id)
     DO UPDATE SET
       can_read   = EXCLUDED.can_read,
       can_create = EXCLUDED.can_create,
       can_edit   = EXCLUDED.can_edit,
       can_delete = EXCLUDED.can_delete,
       updated_at = NOW()
     RETURNING *`,
    [role_id, zodu_id, branch_id, module_id,
     can_read ?? false, can_create ?? false, can_edit ?? false, can_delete ?? false]
  );
  return rows[0];
};

exports.findAccessByRole = async (role_id) => {
  const { rows } = await conn.query(
    `SELECT
       ac.*,
       m.module_name, m.parent_module_id, m.sort_order,
       pm.module_name AS parent_module_name
     FROM tbl_access_control ac
     JOIN tbl_modules m  ON m.module_id  = ac.module_id
     LEFT JOIN tbl_modules pm ON pm.module_id = m.parent_module_id
     WHERE ac.role_id = $1
     ORDER BY m.sort_order ASC`,
    [role_id]
  );
  return rows;
};

exports.deleteAccessByRole = async (client, role_id) => {
  await client.query(`DELETE FROM tbl_access_control WHERE role_id = $1`, [role_id]);
};

// ── MODULES ───────────────────────────────────────────────────────────────────

exports.findAllModules = async () => {
  const { rows } = await conn.query(
    `SELECT module_id, module_name, parent_module_id, sort_order
     FROM tbl_modules
     ORDER BY sort_order ASC, module_name ASC`
  );
  return rows;
};

// ── EMPLOYEE USER (internal) ──────────────────────────────────────────────────

exports.createEmployeeUser = async (client, { email, phone, zodu_id, password_hash }) => {
  const user_id = uuidv4();
  await client.query(
    `INSERT INTO tbl_users (user_id, email, phone, password_hash, user_type, is_active)
     VALUES ($1, $2, $3, $4, 'employee', true)`,
    [user_id, email || null, phone || null, password_hash]
  );
  await client.query(
    `INSERT INTO tbl_user_companies (user_id, zodu_id, is_primary)
     VALUES ($1, $2, false)
     ON CONFLICT (user_id, zodu_id) DO NOTHING`,
    [user_id, zodu_id]
  );
  return user_id;
};

exports.assignEmployeeRole = async (client, { user_id, role_id, zodu_id, branch_id, reporting_manager_id, access_level }) => {
  await client.query(
    `INSERT INTO tbl_user_roles (user_id, role_id, zodu_id, branch_id, reporting_manager_id, access_level)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, zodu_id, branch_id)
     DO UPDATE SET
       role_id              = EXCLUDED.role_id,
       reporting_manager_id = EXCLUDED.reporting_manager_id,
       access_level         = EXCLUDED.access_level,
       updated_at           = NOW()`,
    [user_id, role_id, zodu_id, branch_id, reporting_manager_id || null, access_level || 'Full Access']
  );
};

exports.findEmployeeRole = async (user_id) => {
  const { rows } = await conn.query(
    `SELECT
       ur.role_id, ur.access_level, ur.branch_id, ur.zodu_id, ur.reporting_manager_id,
       r.role_name, r.description
     FROM tbl_user_roles ur
     JOIN tbl_roles r ON r.role_id = ur.role_id
     WHERE ur.user_id = $1`,
    [user_id]
  );
  return rows[0] || null;
};

exports.deactivateEmployeeUser = async (user_id) => {
  await conn.query(
    `UPDATE tbl_users SET is_active = false, updated_at = NOW() WHERE user_id = $1`,
    [user_id]
  );
};

exports.checkEmailExists = async (client, email) => {
  const { rowCount } = await client.query(
    `SELECT user_id FROM tbl_users WHERE email = $1`, [email]
  );
  return rowCount > 0;
};

exports.checkPhoneExists = async (client, phone) => {
  const { rowCount } = await client.query(
    `SELECT user_id FROM tbl_users WHERE phone = $1`, [phone]
  );
  return rowCount > 0;
};

// Used for update — exclude the current user's own record
exports.updateUserPassword = async (user_id, password_hash) => {
  await conn.query(
    `UPDATE tbl_users SET password_hash = $1, updated_at = NOW() WHERE user_id = $2`,
    [password_hash, user_id]
  );
};

exports.updateUserEmailPhone = async (user_id, { email, phone }) => {
  const sets = [], vals = [];
  let idx = 1;
  if (email) { sets.push(`email = $${idx++}`); vals.push(email); }
  if (phone) { sets.push(`phone = $${idx++}`); vals.push(phone); }
  if (!sets.length) return;
  sets.push('updated_at = NOW()');
  vals.push(user_id);
  await conn.query(
    `UPDATE tbl_users SET ${sets.join(', ')} WHERE user_id = $${idx}`,
    vals
  );
};

exports.checkEmailExistsExcluding = async (email, exclude_user_id) => {
  const { rowCount } = await conn.query(
    `SELECT user_id FROM tbl_users
     WHERE email = $1 AND ($2::uuid IS NULL OR user_id != $2)`,
    [email, exclude_user_id || null]
  );
  return rowCount > 0;
};

exports.checkPhoneExistsExcluding = async (phone, exclude_user_id) => {
  const { rowCount } = await conn.query(
    `SELECT user_id FROM tbl_users
     WHERE phone = $1 AND ($2::uuid IS NULL OR user_id != $2)`,
    [phone, exclude_user_id || null]
  );
  return rowCount > 0;
};
