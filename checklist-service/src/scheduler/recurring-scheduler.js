const db = require('../database/connection');
const { logger } = require('../utils/logger');
const { todayInZone, daysAgoInZone, msUntilNextRun } = require('../utils/dates');

// Any number — just has to be the same in every service instance.
const LOCK_KEY = 7_260_001;
// On start-up, back-fill occurrences missed while the service was down.
const CATCH_UP_DAYS = 7;

// Creates the recurring occurrences due in [from, to] via the SQL function.
// A session-level advisory lock keeps several service instances from running
// it at once; the function itself is idempotent, so an overlap is harmless
// anyway — the lock only saves the duplicate work.
const generate = async (from, to) => {
  const client = await db.connect();
  try {
    const { rows: [{ locked }] } = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [LOCK_KEY]);
    if (!locked) return;
    try {
      const { rows: [{ inserted }] } = await client.query(
        'SELECT generate_checklist_instances($1::date, $2::date) AS inserted', [from, to]
      );
      if (inserted > 0) logger.info(`Recurring checklists: ${inserted} occurrence(s) created for ${from}..${to}`);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    }
  } finally {
    client.release();
  }
};

const run = async (from, to) => {
  try {
    await generate(from, to);
  } catch (err) {
    logger.error('Recurring checklist generation failed:', err.message);
  }
};

const scheduleNext = () => {
  setTimeout(async () => {
    const today = todayInZone();
    await run(today, today);
    scheduleNext();
  }, msUntilNextRun()).unref();
};

exports.startRecurringScheduler = () => {
  run(daysAgoInZone(CATCH_UP_DAYS), todayInZone());
  scheduleNext();
};
