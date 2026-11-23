const db = require('./connection');

/**
 * Runs `work(client)` in one transaction on its own connection. It is committed when `work` returns, and rolled back
 * when `work` throws or returns null (null = "nothing was saved", the caller decides what that means).
 */
async function inTransaction(work) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query(result === null ? 'ROLLBACK' : 'COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { inTransaction };
