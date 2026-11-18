// In-app inbox and preferences (§7, §8.2). Every query is scoped to the
// caller (recipient_user_id) and the request's company / branch.
const pool = require('../database/pool');
const { withTransaction } = require('../database/tx');
const config = require('../config');
const { NOTIFICATION_TYPES, CHANNELS } = require('../schema');
const { badRequest, unprocessable } = require('../utils/errors');
const { encodeCursor, decodeCursor } = require('../utils/pagination');
const { isValidTimezone } = require('../utils/time');

// Web Push / email delivery is phase 2 (§7.1): until a dispatcher sends them,
// only the in-app channel may be switched on, so no outbox rows pile up unsent.
const AVAILABLE_CHANNELS = ['IN_APP'];

// created_key: created_at to the microsecond (JS dates stop at milliseconds, and a
// cursor or Last-Event-ID built from one would repeat rows).
const COLUMNS = `id, type, severity, title, body, entity_type, entity_id, action_url, data, read_at, created_at,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_key`;

const out = (n) => ({
  id: n.id, type: n.type, severity: n.severity, title: n.title, body: n.body,
  entity_type: n.entity_type, entity_id: n.entity_id, action_url: n.action_url, data: n.data,
  is_read: Boolean(n.read_at), read_at: n.read_at, created_at: n.created_at,
});

// SSE event id: "<created_at ISO>|<uuid>" (Last-Event-ID on reconnect).
const eventId = (n) => `${n.created_key}|${n.id}`;

async function list(tenant, userId, q) {
  const params = [userId, tenant.zodu_id, tenant.branch_id];
  const where = ['recipient_user_id = $1', 'zodu_id = $2', 'branch_id = $3', 'show_in_inbox'];
  if (q.unread_only) where.push('read_at IS NULL');
  const key = decodeCursor(q.cursor);
  if (key) {
    params.push(key[0], key[1]);
    where.push(`(created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
  }
  params.push(q.limit + 1);
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM ckl.notifications WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC, id DESC LIMIT $${params.length}`,
    params,
  );
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  return {
    data: page.map(out),
    pagination: { limit: q.limit, next_cursor: rows.length > q.limit ? encodeCursor([last.created_key, last.id]) : null },
  };
}

async function unreadCount(tenant, userId) {
  const { rows: [r] } = await pool.query(
    `SELECT count(*) AS count FROM ckl.notifications
      WHERE recipient_user_id = $1 AND zodu_id = $2 AND branch_id = $3 AND show_in_inbox AND read_at IS NULL`,
    [userId, tenant.zodu_id, tenant.branch_id],
  );
  return r.count;
}

// Unknown or someone else's id: nothing happens (no existence leak), still 204.
async function markRead(tenant, userId, id) {
  await pool.query(
    `UPDATE ckl.notifications SET read_at = now()
      WHERE id = $1 AND recipient_user_id = $2 AND zodu_id = $3 AND branch_id = $4 AND read_at IS NULL`,
    [id, userId, tenant.zodu_id, tenant.branch_id],
  );
}

async function markAllRead(tenant, userId, before) {
  await pool.query(
    `UPDATE ckl.notifications SET read_at = now()
      WHERE recipient_user_id = $1 AND zodu_id = $2 AND branch_id = $3 AND read_at IS NULL
        AND ($4::timestamptz IS NULL OR created_at <= $4)`,
    [userId, tenant.zodu_id, tenant.branch_id, before ?? null],
  );
}

// For the SSE hub: these ids, if they belong to this user and tenant.
async function byIds(ids) {
  if (!ids.length) return [];
  const { rows } = await pool.query(
    `SELECT ${COLUMNS}, recipient_user_id, zodu_id, branch_id FROM ckl.notifications
      WHERE id = ANY ($1::uuid[]) AND show_in_inbox`,
    [ids],
  );
  return rows;
}

// Replay after a reconnect: inbox rows newer than Last-Event-ID (at most 50, oldest first).
async function since(tenant, userId, lastEventId) {
  const [iso, id] = String(lastEventId || '').split('|');
  const at = new Date(iso);
  if (!iso || Number.isNaN(at.getTime()) || !/^[0-9a-f-]{36}$/i.test(id || '')) return [];
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM ckl.notifications
      WHERE recipient_user_id = $1 AND zodu_id = $2 AND branch_id = $3 AND show_in_inbox
        AND (created_at, id) > ($4::timestamptz, $5::uuid)
      ORDER BY created_at, id LIMIT 50`,
    [userId, tenant.zodu_id, tenant.branch_id, iso, id],
  );
  return rows;
}

// Preferences are per company (a user's choice follows them across branches).
async function getPreferences(tenant, userId) {
  const [{ rows: [s] }, { rows: prefs }] = await Promise.all([
    pool.query('SELECT timezone, quiet_start, quiet_end, muted_until FROM ckl.notification_settings WHERE zodu_id = $1 AND user_id = $2', [tenant.zodu_id, userId]),
    pool.query('SELECT type, channel, enabled FROM ckl.notification_preferences WHERE zodu_id = $1 AND user_id = $2', [tenant.zodu_id, userId]),
  ]);
  const stored = new Map(prefs.map((p) => [`${p.type}|${p.channel}`, p.enabled]));
  const hm = (t) => (t ? String(t).slice(0, 5) : null);
  return {
    settings: {
      timezone: s?.timezone ?? config.DEFAULT_TIMEZONE,
      quiet_start: hm(s?.quiet_start), quiet_end: hm(s?.quiet_end), muted_until: s?.muted_until ?? null,
    },
    available_channels: AVAILABLE_CHANNELS,
    preferences: NOTIFICATION_TYPES.flatMap((type) => CHANNELS.map((channel) => ({
      type, channel, enabled: stored.get(`${type}|${channel}`) ?? channel === 'IN_APP',
    }))),
  };
}

// Full replace: types/channels not sent fall back to the defaults.
async function putPreferences(tenant, userId, body) {
  const st = body.settings || {};
  if (st.timezone && !(await isValidTimezone(st.timezone))) throw badRequest(`Unknown time zone "${st.timezone}"`, 'INVALID_TIMEZONE');
  if ((st.quiet_start == null) !== (st.quiet_end == null)) throw badRequest('Set both quiet_start and quiet_end, or neither');
  const off = body.preferences.find((p) => p.enabled && !AVAILABLE_CHANNELS.includes(p.channel));
  if (off) throw unprocessable(`${off.channel} notifications are not available yet`, 'CHANNEL_NOT_AVAILABLE');
  const seen = new Set();
  for (const p of body.preferences) {
    const k = `${p.type}|${p.channel}`;
    if (seen.has(k)) throw badRequest(`Duplicate preference ${k}`);
    seen.add(k);
  }
  await withTransaction(async (db) => {
    await db.query(
      `INSERT INTO ckl.notification_settings (zodu_id, user_id, timezone, quiet_start, quiet_end, muted_until, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (zodu_id, user_id) DO UPDATE
         SET timezone = EXCLUDED.timezone, quiet_start = EXCLUDED.quiet_start, quiet_end = EXCLUDED.quiet_end,
             muted_until = EXCLUDED.muted_until, updated_at = now()`,
      [tenant.zodu_id, userId, st.timezone || config.DEFAULT_TIMEZONE, st.quiet_start ?? null, st.quiet_end ?? null, st.muted_until ?? null],
    );
    await db.query('DELETE FROM ckl.notification_preferences WHERE zodu_id = $1 AND user_id = $2', [tenant.zodu_id, userId]);
    if (body.preferences.length) {
      await db.query(
        `INSERT INTO ckl.notification_preferences (zodu_id, user_id, type, channel, enabled)
         SELECT $1, $2, x.type, x.channel, x.enabled
           FROM unnest($3::text[], $4::text[], $5::boolean[]) AS x(type, channel, enabled)`,
        [tenant.zodu_id, userId, body.preferences.map((p) => p.type), body.preferences.map((p) => p.channel),
          body.preferences.map((p) => p.enabled)],
      );
    }
  });
  return getPreferences(tenant, userId);
}

module.exports = { list, unreadCount, markRead, markAllRead, byIds, since, getPreferences, putPreferences, out, eventId };
