const pool = require('./pool');

// Runs fn(client) in one transaction. actorUserId goes into ckl.actor_user_id
// (SET LOCAL): the run_events audit rows name it, and fn_notify never notifies
// the actor about their own action.
async function withTransaction(fn, { actorUserId } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (actorUserId) await client.query("SELECT set_config('ckl.actor_user_id', $1, true)", [String(actorUserId)]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { withTransaction };
