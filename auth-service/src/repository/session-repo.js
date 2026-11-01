const conn = require('../database/connection');

// tbl_user_sessions: one row per session family (device login), for listing
// and auditing. The refresh token itself lives only in Redis, as a hash; the
// refresh_token column is NULL for these rows (it still holds the plaintext of
// sessions from before the ES256 switch until they are migrated or expire).

async function createSessionRow({ session_id, user_id, platform, ip_address, user_agent, expires_at }) {
  await conn.query(
    `INSERT INTO tbl_user_sessions
       (session_id, user_id, refresh_token, platform, ip_address, user_agent, expires_at, is_revoked, last_used_at)
     VALUES ($1, $2, NULL, $3, $4, $5, $6, false, now())`,
    [session_id, user_id, platform, ip_address || null, user_agent ? String(user_agent).slice(0, 512) : null, expires_at],
  );
}

async function touchSessionRow({ session_id, platform, ip_address }) {
  await conn.query(
    `UPDATE tbl_user_sessions
        SET last_used_at = now(), updated_at = now(),
            platform = COALESCE($2, platform), ip_address = COALESCE($3, ip_address)
      WHERE session_id = $1`,
    [session_id, platform || null, ip_address || null],
  );
}

async function revokeSessionRows(session_ids, reason) {
  if (!session_ids.length) return;
  await conn.query(
    `UPDATE tbl_user_sessions
        SET is_revoked = true, revoked_at = now(), revoke_reason = $2, updated_at = now()
      WHERE session_id = ANY($1::uuid[]) AND is_revoked = false`,
    [session_ids, reason],
  );
}

// Every session row of the user, including legacy rows (old refresh tokens).
async function revokeUserSessionRows(user_id, reason) {
  await conn.query(
    `UPDATE tbl_user_sessions
        SET is_revoked = true, revoked_at = now(), revoke_reason = $2, updated_at = now()
      WHERE user_id = $1 AND is_revoked = false`,
    [user_id, reason],
  );
}

async function listActiveSessions({ user_id, idle_days }) {
  const { rows } = await conn.query(
    `SELECT session_id, platform, ip_address, user_agent, created_at, last_used_at, expires_at
       FROM tbl_user_sessions
      WHERE user_id = $1 AND is_revoked = false AND refresh_token IS NULL
        AND expires_at > now()
        AND COALESCE(last_used_at, created_at) > now() - make_interval(days => $2)
      ORDER BY COALESCE(last_used_at, created_at) DESC
      LIMIT 100`,
    [user_id, idle_days],
  );
  return rows;
}

async function findUserSession({ user_id, session_id }) {
  const { rows } = await conn.query(
    `SELECT session_id, is_revoked FROM tbl_user_sessions WHERE user_id = $1 AND session_id = $2`,
    [user_id, session_id],
  );
  return rows[0] || null;
}

// Pre-ES256 sessions: the old refresh JWT is stored in plain text.
async function findLegacySession({ refresh_token }) {
  const { rows } = await conn.query(
    `SELECT session_id, user_id, expires_at, is_revoked
       FROM tbl_user_sessions WHERE refresh_token = $1`,
    [refresh_token],
  );
  return rows[0] || null;
}

// Marks a legacy row as exchanged; false if another request already did.
async function claimLegacySession({ session_id }) {
  const { rowCount } = await conn.query(
    `UPDATE tbl_user_sessions
        SET is_revoked = true, revoked_at = now(), revoke_reason = 'migrated', updated_at = now()
      WHERE session_id = $1 AND is_revoked = false`,
    [session_id],
  );
  return rowCount === 1;
}

// ── tbl_security_events ─────────────────────────────────────────────────────
// Never passwords, tokens or request bodies: only who, what, where, and a few
// non-secret details (reason codes, ids).
async function insertSecurityEvent({ user_id, zodu_id, event, ip, user_agent, platform, details }) {
  await conn.query(
    `INSERT INTO tbl_security_events (user_id, zodu_id, event, ip, user_agent, platform, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [user_id || null, zodu_id || null, event, ip || null,
      user_agent ? String(user_agent).slice(0, 512) : null, platform || null, details ? JSON.stringify(details) : null],
  );
}

module.exports = {
  createSessionRow,
  touchSessionRow,
  revokeSessionRows,
  revokeUserSessionRows,
  listActiveSessions,
  findUserSession,
  findLegacySession,
  claimLegacySession,
  insertSecurityEvent,
};
