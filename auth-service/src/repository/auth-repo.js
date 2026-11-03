const conn = require('../database/connection');
const { v4: uuidv4 } = require('uuid');

async function getNextZoduId() {
  const res = await conn.query("SELECT nextval('zodu_seq') as v");
  const n = parseInt(res.rows[0].v, 10);
  return 'Z' + String(n).padStart(3, '0');
}

async function findEmailExist({ email }) {
  return conn.query(
    `SELECT u.user_id, u.email, u.phone, u.password_hash, u.user_type, u.is_active, u.is_deleted, u.login_user,
            uc.zodu_id, uc.is_primary
     FROM tbl_users u
     JOIN tbl_user_companies uc ON uc.user_id = u.user_id 
     WHERE u.email = $1 AND u.login_user = true`,
    [email]
  );
}

// AND uc.is_primary = true

async function findPhnExist({ phone_number }) {
  return conn.query(
    `SELECT u.user_id, u.email, u.phone, u.password_hash, u.user_type, u.is_active, u.is_deleted, u.login_user,
            uc.zodu_id, uc.is_primary
     FROM tbl_users u
     JOIN tbl_user_companies uc ON uc.user_id = u.user_id
     WHERE u.phone = $1 AND u.login_user = true`,
    [phone_number]
  );
}
// AND uc.is_primary = true

async function findUserById({ user_id }) {
  const { rows } = await conn.query(
    `SELECT user_id, email, phone FROM tbl_users WHERE user_id = $1`,
    [user_id]
  );
  return rows[0] || null;
}


// Runs on the caller's transaction client — participates in CreateAccount's
// single all-or-nothing transaction (user + roles + company + branch).
async function AccountCreationQuery(client, { zodu_id, phone_number, email, password_hash }) {
  const user_id = uuidv4();

  // 1. tbl_users
  await client.query(
    `INSERT INTO tbl_users
       (user_id, email, phone, password_hash, user_type, is_active)
     VALUES ($1, $2, $3, $4, 'super_admin', true)`,
    [user_id, email || null, phone_number || null, password_hash]
  );

  // 2. Default "Owner" role
  const roleResult = await client.query(
    `INSERT INTO tbl_roles (zodu_id, branch_id, role_name, description)
     VALUES ($1, NULL, 'Admin', 'Full access — auto-created on registration')
     RETURNING role_id`,
    [zodu_id]
  );
  const role_id = roleResult.rows[0].role_id;

  // 3. Grant all modules to Owner role
  const { rows: modules } = await client.query(
    'SELECT module_id FROM tbl_modules'
  );

  if (modules.length > 0) {
    const placeholders = modules.map((_, i) =>
      `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3}, true, true, true, true)`
    ).join(', ');
    const params = modules.flatMap(m => [role_id, zodu_id, m.module_id]);

    await client.query(
      `INSERT INTO tbl_access_control
         (role_id, zodu_id, module_id,
          can_read, can_create, can_edit, can_delete)
       VALUES ${placeholders}`,
      params
    );
  }

  // 4. Bind user → Owner role
  await client.query(
    `INSERT INTO tbl_user_roles (user_id, role_id, zodu_id)
     VALUES ($1, $2, $3)`,
    [user_id, role_id, zodu_id]
  );

  // 5. Link user → primary company
  await client.query(
    `INSERT INTO tbl_user_companies (user_id, zodu_id, is_primary)
     VALUES ($1, $2, true)`,
    [user_id, zodu_id]
  );

  return { user_id, role_id };
}

async function updateLastLogin({ user_id }) {
  await conn.query(
    `UPDATE tbl_users SET last_login_at = now() WHERE user_id = $1`,
    [user_id]
  );
}

async function addUserCompany({ user_id, zodu_id, is_primary = false }) {
  await conn.query(
    `INSERT INTO tbl_user_companies (user_id, zodu_id, is_primary)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, zodu_id) DO NOTHING`,
    [user_id, zodu_id, is_primary]
  );
}

async function getUserCompanies({ user_id }) {
  console.log("Fetching companies for user_id:", user_id);
  const result = await conn.query(
    `SELECT uc.zodu_id, uc.is_primary, uc.created_at
     FROM tbl_user_companies uc
     WHERE uc.user_id = $1
     ORDER BY uc.is_primary DESC, uc.created_at ASC`,
    [user_id]
  );
  return result.rows;
}

async function getUserRoleAccess({ user_id, zodu_id, branch_id }) {
  const { rows } = await conn.query(
    `SELECT
       ac.module_id, m.module_name, m.parent_module_id, m.sort_order,
       ac.can_read, ac.can_create, ac.can_edit, ac.can_delete,
       r.role_id, r.role_name
     FROM tbl_user_roles ur
     JOIN tbl_roles r          ON r.role_id = ur.role_id
     JOIN tbl_access_control ac ON ac.role_id = r.role_id
     JOIN tbl_modules m        ON m.module_id = ac.module_id
     WHERE ur.user_id = $1
       AND ur.zodu_id = $2
       AND (r.role_name = 'Admin' OR ur.branch_id IS NULL OR ur.branch_id = $3)
     ORDER BY m.sort_order ASC`,
    [user_id, zodu_id, branch_id || null]
  );
  return rows;
}

// file-service's tenant/branch gate (GET /internal/user-branch-access).
// branch_id null → company-level question only (tenant-wide files).
// Same branch rule as getUserRoleAccess: Admin and company-wide (branch_id NULL)
// roles reach every branch, other roles only their own.
async function getUserBranchAccess({ user_id, zodu_id, branch_id }) {
  const { rows: [flags] } = await conn.query(
    `SELECT
       EXISTS (
         SELECT 1 FROM tbl_users u
         JOIN tbl_user_companies uc ON uc.user_id = u.user_id
         WHERE u.user_id = $1 AND uc.zodu_id = $2
           AND u.is_active = true AND COALESCE(u.is_deleted, false) = false
       ) AS is_member,
       ($3::varchar IS NULL OR EXISTS (
         SELECT 1 FROM tbl_branch WHERE zodu_id = $2 AND branch_id = $3
       )) AS branch_exists,
       EXISTS (
         SELECT 1 FROM tbl_user_roles ur
         JOIN tbl_roles r ON r.role_id = ur.role_id
         WHERE ur.user_id = $1 AND ur.zodu_id = $2
           AND (r.role_name = 'Admin' OR ur.branch_id IS NULL OR ur.branch_id = $3)
       ) AS has_branch_access,
       EXISTS (
         SELECT 1 FROM tbl_user_roles ur
         JOIN tbl_roles r ON r.role_id = ur.role_id
         WHERE ur.user_id = $1 AND ur.zodu_id = $2 AND r.zodu_id = $2 AND r.role_name = 'Admin'
       ) AS is_admin`,
    [user_id, zodu_id, branch_id || null]
  );

  // Several roles may grant the same module: any grant wins.
  const permissions = {};
  for (const row of await getUserRoleAccess({ user_id, zodu_id, branch_id })) {
    const p = (permissions[row.module_name] ??= { read: false, create: false, edit: false, delete: false });
    p.read   ||= row.can_read;
    p.create ||= row.can_create;
    p.edit   ||= row.can_edit;
    p.delete ||= row.can_delete;
  }
  return { ...flags, permissions };
}

// ── login / token context ─────────────────────────────────────────────────────

// The account behind a login identifier, whatever its state: the caller logs
// why a login was refused (inactive, deleted, login_user=false) and answers
// every case with the same generic error.
async function findUserForLogin({ email, phone_number }) {
  const [column, value] = email ? ['email', email] : ['phone', phone_number];
  const { rows } = await conn.query(
    `SELECT user_id, email, phone, password_hash, user_type, is_active, is_deleted, login_user
       FROM tbl_users
      WHERE ${column} = $1
      ORDER BY login_user DESC, created_at ASC
      LIMIT 1`,
    [value]
  );
  return rows[0] || null;
}

async function findUserState({ user_id }) {
  const { rows } = await conn.query(
    `SELECT user_id, email, phone, user_type, is_active, is_deleted, login_user
       FROM tbl_users WHERE user_id = $1`,
    [user_id]
  );
  return rows[0] || null;
}

async function updatePasswordHash({ user_id, password_hash }) {
  await conn.query(
    `UPDATE tbl_users SET password_hash = $2, updated_at = now() WHERE user_id = $1`,
    [user_id, password_hash]
  );
}

// The user's roles in one company: { role_name, branch_id } (branch_id NULL = company-wide).
async function getUserRolesInCompany({ user_id, zodu_id }) {
  const { rows } = await conn.query(
    `SELECT r.role_name, ur.branch_id
       FROM tbl_user_roles ur
       JOIN tbl_roles r ON r.role_id = ur.role_id
      WHERE ur.user_id = $1 AND ur.zodu_id = $2 AND r.zodu_id = $2
      ORDER BY (r.role_name = 'Admin') DESC, ur.created_at ASC`,
    [user_id, zodu_id]
  );
  return rows;
}

async function getActiveBranchIds({ zodu_id }) {
  const { rows } = await conn.query(
    `SELECT branch_id FROM tbl_branch
      WHERE zodu_id = $1 AND COALESCE(active, true) = true
      ORDER BY branch_id ASC`,
    [zodu_id]
  );
  return rows.map((r) => r.branch_id);
}

// Users whose permissions change with this role (session revocation).
async function getRoleUserIds({ role_id }) {
  const { rows } = await conn.query(
    `SELECT DISTINCT user_id FROM tbl_user_roles WHERE role_id = $1`,
    [role_id]
  );
  return rows.map((r) => r.user_id);
}

async function getCompanyUserIds({ zodu_id }) {
  const { rows } = await conn.query(
    `SELECT DISTINCT user_id FROM tbl_user_companies WHERE zodu_id = $1`,
    [zodu_id]
  );
  return rows.map((r) => r.user_id);
}

async function createDefaultRoleForCompany({ user_id, zodu_id }) {
  const client = await conn.connect();
  try {
    await client.query('BEGIN');

    // The company's "Admin" (owner) role: created here, or reused when the
    // company already has one (role names are unique per company). Without
    // it the creator has no role in the company and is refused it.
    const roleResult = await client.query(
      `INSERT INTO tbl_roles (zodu_id, branch_id, role_name, description)
       VALUES ($1, NULL, 'Admin', 'Full access — auto-created for new company')
       ON CONFLICT (zodu_id, role_name) DO NOTHING
       RETURNING role_id`,
      [zodu_id]
    );
    const created = roleResult.rows.length > 0;
    const role_id = created
      ? roleResult.rows[0].role_id
      : (await client.query(
          `SELECT role_id FROM tbl_roles WHERE zodu_id = $1 AND role_name = 'Admin'`,
          [zodu_id]
        )).rows[0].role_id;

    // Grant all modules to a new Admin role (an existing one keeps its grants)
    const { rows: modules } = created
      ? await client.query('SELECT module_id FROM tbl_modules')
      : { rows: [] };

    if (modules.length > 0) {
      const placeholders = modules.map((_, i) =>
        `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3}, true, true, true, true)`
      ).join(', ');
      const params = modules.flatMap(m => [role_id, zodu_id, m.module_id]);

      await client.query(
        `INSERT INTO tbl_access_control
           (role_id, zodu_id, module_id,
            can_read, can_create, can_edit, can_delete)
         VALUES ${placeholders}`,
        params
      );
    }

    // Bind user to the Admin role for this company
    await client.query(
      `INSERT INTO tbl_user_roles (user_id, role_id, zodu_id)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [user_id, role_id, zodu_id]
    );

    await client.query('COMMIT');
    return role_id;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  conn,
  AccountCreationQuery,
  findEmailExist,
  findPhnExist,
  findUserById,
  getNextZoduId,
  updateLastLogin,
  addUserCompany,
  getUserCompanies,
  createDefaultRoleForCompany,
  getUserRoleAccess,
  getUserBranchAccess,
  findUserForLogin,
  findUserState,
  updatePasswordHash,
  getUserRolesInCompany,
  getActiveBranchIds,
  getRoleUserIds,
  getCompanyUserIds,
};
