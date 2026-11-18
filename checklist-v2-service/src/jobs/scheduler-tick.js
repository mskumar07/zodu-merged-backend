// The worker's scheduler: CALL ckl.sp_scheduler_tick() every TICK_INTERVAL_MS
// on its own connection (not the pool: the session advisory lock and the
// statement_timeout must never leak into pooled connections). All the logic is
// in SQL (V006); this only provides the clock and the lock. §3.3.
const { Client } = require('pg');
const { connection } = require('../database/pool');
const config = require('../config');
const { logger } = require('../utils/logger');

const LOCK_KEY = 7260801;

class SchedulerTick {
  constructor({ intervalMs = config.TICK_INTERVAL_MS, horizonHours = config.GENERATION_HORIZON_HOURS } = {}) {
    this.intervalMs = intervalMs;
    this.horizonHours = horizonHours;
    this.client = null;
    this.timer = null;
    this.running = null;   // promise of the tick in flight
    this.stopped = true;
  }

  async getClient() {
    if (this.client) return this.client;
    const client = new Client({ ...connection(), keepAlive: true });
    client.on('error', (err) => {
      logger.error('tick: connection error', { error: err.message });
      if (this.client === client) this.client = null;
    });
    await client.connect();
    await client.query("SET statement_timeout = '55s'");
    await client.query("SET application_name = 'checklist-v2-worker'");
    this.client = client;
    return client;
  }

  // One tick. → { ran: boolean, ms }
  async tickOnce() {
    const started = Date.now();
    const client = await this.getClient();
    const { rows: [{ locked }] } = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [LOCK_KEY]);
    if (!locked) return { ran: false, ms: Date.now() - started };   // another worker is ticking
    try {
      // Simple query protocol (no bind parameters): a procedure that COMMITs
      // must run as a top-level statement, not inside the extended protocol's
      // implicit transaction. The horizon is a number from config.
      const hours = Math.max(1, Math.min(240, Number(this.horizonHours) || 36));
      await client.query(`CALL ckl.sp_scheduler_tick(interval '${hours} hours')`);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    }
    return { ran: true, ms: Date.now() - started };
  }

  start() {
    this.stopped = false;
    const loop = async () => {
      if (this.stopped) return;
      this.running = this.tickOnce()
        .then((r) => { if (r.ran) logger.debug('tick done', r); })
        .catch((err) => {
          logger.error('tick failed', { error: err.message });
          const c = this.client;
          this.client = null;
          if (c) c.end().catch(() => {});
        });
      await this.running;
      this.running = null;
      // setTimeout chain: the next tick starts only after this one finished (no overlap).
      if (!this.stopped) this.timer = setTimeout(loop, this.intervalMs);
    };
    loop();
  }

  async stop({ waitMs = 30_000 } = {}) {
    this.stopped = true;
    clearTimeout(this.timer);
    if (this.running) {
      await Promise.race([this.running, new Promise((r) => setTimeout(r, waitMs).unref())]);
    }
    const c = this.client;
    this.client = null;
    if (c) await c.end().catch(() => {});
  }
}

module.exports = { SchedulerTick, LOCK_KEY };
