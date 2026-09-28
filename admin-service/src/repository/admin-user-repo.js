const conn = require('../database/connection');

// Columns returned to callers — never password_hash, except findByEmail
// which admin-auth-service needs for the bcrypt.compare on login.
const PUBLIC_COLUMNS = `id, name, email, role, is_active, last_login_at, created_at, updated_at`;

exports.findByEmail = async (email) => {
  const { rows } = await conn.query(
    `SELECT id, name, email, password_hash, role, is_active
     FROM tbl_admin_users WHERE email = $1`,
    [email]
  );
  return rows[0] || null;
};

exports.findById = async (id) => {
  const { rows } = await conn.query(
    `SELECT id, name, email, role, is_active FROM tbl_admin_users WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
};

exports.touchLastLogin = async (id) => {
  await conn.query(`UPDATE tbl_admin_users SET last_login_at = now() WHERE id = $1`, [id]);
};

exports.list = async () => {
  const { rows } = await conn.query(
    `SELECT ${PUBLIC_COLUMNS} FROM tbl_admin_users ORDER BY created_at DESC`
  );
  return rows;
};

exports.create = async ({ name, email, passwordHash, role }) => {
  const { rows } = await conn.query(
    `INSERT INTO tbl_admin_users (name, email, password_hash, role)
     VALUES ($1, $2, $3, $4)
     RETURNING ${PUBLIC_COLUMNS}`,
    [name, email, passwordHash, role]
  );
  return rows[0];
};
