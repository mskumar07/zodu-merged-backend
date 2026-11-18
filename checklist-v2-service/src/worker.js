// ROLE=worker: the scheduler tick (generation, time rules, housekeeping, all in
// SQL) and the employee directory sync. One replica is enough; a second one is
// harmless (advisory lock, SKIP LOCKED, unique constraints).
// Web Push / email delivery (phase 2) will add a dispatcher here.
const http = require('node:http');
const pool = require('./database/pool');
const config = require('./config');
const { logger } = require('./utils/logger');
const { SchedulerTick } = require('./jobs/scheduler-tick');
const directory = require('./jobs/directory-sync');

function startWorker() {
  const tick = new SchedulerTick();
  tick.start();

  let syncTimer = null;
  let syncing = null;
  let stopped = false;
  const syncLoop = async () => {
    if (stopped) return;
    syncing = directory.syncAll()
      .catch((err) => logger.error('directory sync loop failed', { error: err.message }));
    await syncing;
    syncing = null;
    if (!stopped) syncTimer = setTimeout(syncLoop, config.DIRECTORY_SYNC_INTERVAL_MS);
  };
  syncLoop();

  // Readiness for the orchestrator: the last tick is less than 3 minutes old.
  const health = http.createServer(async (req, res) => {
    if (req.url === '/health/live') return res.end('{"status":"ok"}');
    if (req.url === '/health/ready') {
      try {
        const { rows: [s] } = await pool.query(
          "SELECT last_run_at > now() - interval '3 minutes' AS fresh, last_run_at FROM ckl.job_state WHERE job = 'tick'",
        );
        res.statusCode = s?.fresh ? 200 : 503;
        return res.end(JSON.stringify({ status: s?.fresh ? 'ok' : 'stale', last_tick: s?.last_run_at ?? null }));
      } catch {
        res.statusCode = 503;
        return res.end('{"status":"db down"}');
      }
    }
    res.statusCode = 404;
    return res.end();
  });
  health.listen(config.WORKER_HEALTH_PORT, () => logger.info(`✅ checklist-v2 worker running (health on ${config.WORKER_HEALTH_PORT})`));

  return async function stop() {
    stopped = true;
    clearTimeout(syncTimer);
    health.close();
    await tick.stop({ waitMs: 30_000 });
    if (syncing) await Promise.race([syncing, new Promise((r) => setTimeout(r, 10_000).unref())]);
  };
}

module.exports = { startWorker };
