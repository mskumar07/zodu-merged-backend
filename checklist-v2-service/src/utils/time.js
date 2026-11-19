// Time zones are checked against the database's own list (pg_timezone_names),
// so a zone the API accepts is always one Postgres can compute slots in.
const pool = require('../database/pool');

let zones = null;
let loadedAt = 0;

async function isValidTimezone(tz) {
  if (typeof tz !== 'string' || tz.length > 64) return false;
  if (!zones || Date.now() - loadedAt > 24 * 3600_000) {
    const { rows } = await pool.query('SELECT name FROM pg_timezone_names');
    zones = new Set(rows.map((r) => r.name));
    loadedAt = Date.now();
  }
  return zones.has(tz);
}

// Today's local date (YYYY-MM-DD) in a zone, computed by Postgres.
async function todayIn(tz, db = pool) {
  const { rows: [r] } = await db.query('SELECT (now() AT TIME ZONE $1)::date AS d', [tz]);
  return r.d;
}

const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);

module.exports = { isValidTimezone, todayIn, addDays, daysBetween };
