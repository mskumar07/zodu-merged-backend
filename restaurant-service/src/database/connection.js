const { Pool } = require('pg');
const { AsyncLocalStorage } = require('async_hooks');
const {
  DB_USERNAME,
  DB_PASSWORD,
  DB_PORT,
  DB_HOSTNAME,
  DB_NAME,
} = require('../config');

const pool = new Pool({
  user: DB_USERNAME,
  host: DB_HOSTNAME,
  database: DB_NAME,
  password: DB_PASSWORD,
  port: Number(DB_PORT),

  // 🔥 REQUIRED for stability
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

// 🔐 Prevent ECONNRESET crashes
pool.on('error', (err) => {
  if (err.code === 'ECONNRESET') {
    console.warn('⚠️ PostgreSQL ECONNRESET — recovered');
    return;
  }
  console.error('🔥 PostgreSQL pool error:', err);
});

// ── Transactions through conn.query() ────────────────────────────────────────
// Many repositories run conn.query('BEGIN') … conn.query('COMMIT' | 'ROLLBACK')
// on the pool. A plain pool sends each statement to whichever connection is
// free: no transaction at all (a rolled-back insert stays), and the connection
// that got BEGIN goes back to the pool still inside a transaction.
//
// Here BEGIN checks out one connection for the rest of that async call chain
// (AsyncLocalStorage: concurrent requests never share it). Every conn.query()
// in the chain goes to it until COMMIT / ROLLBACK releases it. A BEGIN inside
// an open transaction joins it; only the outermost COMMIT commits. Calls
// started side by side in one tick (Promise.all of functions that each BEGIN)
// share the caller's context, so a BEGIN arriving before the open one has
// started is a sibling and gets its own transaction. Code that takes its own
// client (conn.connect()) is unchanged.
const txContext = new AsyncLocalStorage();
const TX_CONTROL = /^\s*(BEGIN|START TRANSACTION|COMMIT|END|ROLLBACK)\s*;?\s*$/i;
// A transaction never finished (a code path that returns without COMMIT /
// ROLLBACK) is rolled back after this, so its connection isn't lost for good.
const ABANDONED_MS = 60_000;

const poolQuery = pool.query.bind(pool);
const done = (command) => ({ command, rowCount: null, rows: [], fields: [] });

function controlOf(text) {
  const sql = typeof text === 'string' ? text : text?.text;
  const m = typeof sql === 'string' ? TX_CONTROL.exec(sql) : null;
  if (!m) return null;
  const word = m[1].toUpperCase();
  if (word === 'START TRANSACTION') return 'BEGIN';
  return word === 'END' ? 'COMMIT' : word;
}

function begin() {
  const tx = { depth: 1, finished: false, started: false };
  // Synchronous, before any await: the caller's continuation sees this transaction.
  txContext.enterWith(tx);
  tx.client = pool.connect().then(async (client) => {
    try {
      await client.query('BEGIN');
      tx.started = true;
      return client;
    } catch (err) {
      client.release(err);
      throw err;
    }
  });
  tx.client.catch(() => { tx.finished = true; });   // could not start: later queries go to the pool
  tx.timer = setTimeout(() => {
    console.error('🔥 transaction neither committed nor rolled back in 60s: rolled back');
    finish(tx, 'ROLLBACK').catch(() => {});
  }, ABANDONED_MS);
  tx.timer.unref?.();
  return tx.client.then(() => done('BEGIN'));
}

async function finish(tx, command) {
  if (tx.finished) return done(command);
  tx.finished = true;
  clearTimeout(tx.timer);
  let client;
  try {
    client = await tx.client;
  } catch (err) {
    if (command === 'ROLLBACK') return done(command);   // BEGIN itself failed: nothing to undo
    throw err;
  }
  try {
    return await client.query(command);
  } catch (err) {
    client.release(err);
    client = null;
    throw err;
  } finally {
    client?.release();
  }
}

pool.query = function query(text, params, callback) {
  if (typeof params === 'function' || typeof callback === 'function') return poolQuery(text, params, callback);
  const tx = txContext.getStore();
  const open = tx && !tx.finished ? tx : null;
  const control = controlOf(text);

  if (control === 'BEGIN') {
    if (!open || !open.started) return begin();
    open.depth += 1;
    return Promise.resolve(done('BEGIN'));
  }
  if (control === 'COMMIT' || control === 'ROLLBACK') {
    if (!open) return poolQuery(text, params);   // no transaction: as before (Postgres warns)
    if (control === 'COMMIT' && --open.depth > 0) return Promise.resolve(done('COMMIT'));
    return finish(open, control);
  }
  if (open) return open.client.then((client) => client.query(text, params));
  return poolQuery(text, params);
};

module.exports = pool;
