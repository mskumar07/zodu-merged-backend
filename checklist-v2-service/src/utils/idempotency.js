// Idempotency-Key on POST create endpoints (§8.1): the same key with the same
// body replays the stored response; the same key with another body → 422.
// A request still running under that key → 409.
const crypto = require('node:crypto');
const pool = require('../database/pool');
const { badRequest, conflict, unprocessable } = require('./errors');

const KEY = /^[A-Za-z0-9_.:-]{8,80}$/;

const hashOf = (req) => crypto.createHash('sha256')
  .update(`${req.method} ${req.baseUrl}${req.path}\n${JSON.stringify(req.body ?? null)}`)
  .digest('hex');

// handler() → { status, body }. Sends the response itself.
async function idempotent(req, res, handler) {
  const key = req.get('Idempotency-Key');
  if (!key) {
    const out = await handler();
    return res.status(out.status).json(out.body);
  }
  if (!KEY.test(key)) throw badRequest('Idempotency-Key must be 8–80 characters [A-Za-z0-9_.:-]', 'INVALID_IDEMPOTENCY_KEY');
  const userId = req.auth.userId;
  const hash = hashOf(req);

  const claimed = await pool.query(
    `INSERT INTO ckl.idempotency_keys (key, user_id, request_hash) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, key) DO NOTHING RETURNING key`,
    [key, userId, hash],
  );
  if (!claimed.rowCount) {
    const { rows: [row] } = await pool.query(
      'SELECT request_hash, response_status, response_body FROM ckl.idempotency_keys WHERE user_id = $1 AND key = $2',
      [userId, key],
    );
    if (!row) throw conflict('Request with this Idempotency-Key is being retried, try again', 'IDEMPOTENCY_IN_PROGRESS');
    if (row.request_hash !== hash) throw unprocessable('Idempotency-Key was already used with a different body', 'IDEMPOTENCY_KEY_REUSED');
    if (row.response_status === null) throw conflict('A request with this Idempotency-Key is still running', 'IDEMPOTENCY_IN_PROGRESS');
    res.set('Idempotent-Replayed', 'true');
    return res.status(row.response_status).json(row.response_body);
  }

  let out;
  try {
    out = await handler();
  } catch (err) {
    // Failed requests may be retried with the same key.
    await pool.query('DELETE FROM ckl.idempotency_keys WHERE user_id = $1 AND key = $2', [userId, key]).catch(() => {});
    throw err;
  }
  await pool.query(
    'UPDATE ckl.idempotency_keys SET response_status = $3, response_body = $4 WHERE user_id = $1 AND key = $2',
    [userId, key, out.status, JSON.stringify(out.body)],
  );
  return res.status(out.status).json(out.body);
}

module.exports = { idempotent };
