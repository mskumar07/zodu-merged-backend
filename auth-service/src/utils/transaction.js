const conn = require('../database/connection');

// withTransaction(async (client) => { ... })
// Handles BEGIN, COMMIT, ROLLBACK, release automatically
const withTransaction = async (fn) => {
  const client = await conn.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { withTransaction };
