const conn = require('../database/connection');
const { v4: uuidv4 } = require('uuid');

async function getNextZoduId() {
  const res = await conn.query("SELECT nextval('zodu_seq') as v");
  const n = parseInt(res.rows[0].v, 10);
  return 'Z' + String(n).padStart(3, '0');
}

async function findEmailExist({ email }) {
  return conn.query(
    `SELECT u.user_id, u.email, u.phone, u.password_hash, u.user_type, u.is_active, u.is_deleted,
            uc.zodu_id, uc.is_primary
     FROM tbl_users u
     JOIN tbl_user_companies uc ON uc.user_id = u.user_id AND uc.is_primary = true
     WHERE u.email = $1`,
    [email]
  );
}

async function findPhnExist({ phone_number }) {
  return conn.query(
    `SELECT u.user_id, u.email, u.phone, u.password_hash, u.user_type, u.is_active, u.is_deleted,
            uc.zodu_id, uc.is_primary
     FROM tbl_users u
     JOIN tbl_user_companies uc ON uc.user_id = u.user_id AND uc.is_primary = true
     WHERE u.phone = $1`,
    [phone_number]
  );
}

async function AccountCreationQuery({ zodu_id, phone_number, email, password_hash }) {
  const client = await conn.connect();
  try {
    await client.query('BEGIN');
    const user_id = uuidv4();

    // 1. tbl_users
    await client.query(
      `INSERT INTO tbl_users
         (user_id, email, phone, password_hash, user_type, is_active)
       VALUES ($1, $2, $3, $4, 'super_admin', true)`,
      [user_id, email || null, phone_number || null, password_hash]
    );

    // 3. Default "Owner" role
    const roleResult = await client.query(
      `INSERT INTO tbl_roles (zodu_id, branch_id, role_name, description)
       VALUES ($1, NULL, 'Owner', 'Full access — auto-created on registration')
       RETURNING role_id`,
      [zodu_id]
    );
    const role_id = roleResult.rows[0].role_id;

    // 4. Grant all modules to Owner role
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

    // 5. Bind user → Owner role
    await client.query(
      `INSERT INTO tbl_user_roles (user_id, role_id, zodu_id)
       VALUES ($1, $2, $3)`,
      [user_id, role_id, zodu_id]
    );

    // 6. Link user → primary company
    await client.query(
      `INSERT INTO tbl_user_companies (user_id, zodu_id, is_primary)
       VALUES ($1, $2, true)`,
      [user_id, zodu_id]
    );

    await client.query('COMMIT');
    return { user_id, role_id };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── session management ────────────────────────────────────────────────────────

async function createSession({ user_id, refresh_token, ip_address, user_agent, expires_at }) {
  const result = await conn.query(
    `INSERT INTO tbl_user_sessions
       (user_id, refresh_token, ip_address, user_agent, expires_at, is_revoked)
     VALUES ($1, $2, $3, $4, $5, false)
     RETURNING session_id, expires_at`,
    [user_id, refresh_token, ip_address || null, user_agent || null, expires_at]
  );
  return result.rows[0];
}

async function findSessionByRefreshToken({ refresh_token }) {
  const result = await conn.query(
    `SELECT s.session_id, s.user_id, s.expires_at, s.is_revoked,
            u.user_type, u.is_active, u.is_deleted,
            uc.zodu_id
     FROM tbl_user_sessions s
     JOIN tbl_users u ON u.user_id = s.user_id
     LEFT JOIN tbl_user_companies uc ON uc.user_id = s.user_id AND uc.is_primary = true
     WHERE s.refresh_token = $1`,
    [refresh_token]
  );
  return result.rows[0] || null;
}

async function revokeSession({ session_id }) {
  await conn.query(
    `UPDATE tbl_user_sessions
     SET is_revoked = true, updated_at = now()
     WHERE session_id = $1`,
    [session_id]
  );
}

async function updateLastLogin({ user_id }) {
  await conn.query(
    `UPDATE tbl_users SET last_login_at = now() WHERE user_id = $1`,
    [user_id]
  );
}

// ── compensating delete ───────────────────────────────────────────────────────

async function deleteAccountByZoduId(zodu_id) {
  const client = await conn.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM tbl_user_companies WHERE zodu_id = $1', [zodu_id]);
    await client.query('DELETE FROM tbl_user_roles      WHERE zodu_id = $1', [zodu_id]);
    await client.query('DELETE FROM tbl_access_control  WHERE zodu_id = $1', [zodu_id]);
    await client.query('DELETE FROM tbl_roles           WHERE zodu_id = $1', [zodu_id]);
    await client.query(
      `DELETE FROM tbl_users
       WHERE user_id IN (
         SELECT user_id FROM tbl_user_companies WHERE zodu_id = $1
       )`,
      [zodu_id]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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

async function createDefaultRoleForCompany({ user_id, zodu_id }) {
  const client = await conn.connect();
  try {
    await client.query('BEGIN');

    // Create a default "Admin" role for the new company
    const roleResult = await client.query(
      `INSERT INTO tbl_roles (zodu_id, branch_id, role_name, description)
       VALUES ($1, NULL, 'Admin', 'Full access — auto-created for new company')
       RETURNING role_id`,
      [zodu_id]
    );
    const role_id = roleResult.rows[0].role_id;

    // Grant all modules to Admin role
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

    // Bind user to the Admin role for this company
    await client.query(
      `INSERT INTO tbl_user_roles (user_id, role_id, zodu_id)
       VALUES ($1, $2, $3)`,
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
  AccountCreationQuery,
  findEmailExist,
  findPhnExist,
  getNextZoduId,
  deleteAccountByZoduId,
  createSession,
  findSessionByRefreshToken,
  revokeSession,
  updateLastLogin,
  addUserCompany,
  getUserCompanies,
  createDefaultRoleForCompany,
};
