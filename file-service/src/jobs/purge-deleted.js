// Removes the stored objects of soft-deleted files once they are older than
// PURGE_AFTER_DAYS. Accounting modules (keepOnDelete) are never purged.
// The tbl_files row stays, with purged_at set, as the record of what existed.
// Safe with several replicas: each batch is locked with SKIP LOCKED.

const { MODULES } = require('../storage/modules');
const { logger } = require('../utils/logger');

const PURGEABLE = Object.entries(MODULES).filter(([, m]) => !m.keepOnDelete).map(([name]) => name);
const BATCH = 200;
const EVERY_MS = 6 * 60 * 60 * 1000;

function createPurgeJob({ repo, storage, olderThanDays }) {
  async function runOnce() {
    let total = 0;
    for (;;) {
      const n = await repo.withPurgeBatch({ modules: PURGEABLE, olderThanDays, limit: BATCH }, async (rows) => {
        // With bucket versioning on, this leaves a delete marker; the bucket's
        // lifecycle rule expires the old versions (see minio-setup.md).
        await storage.internal.removeObjects(storage.bucket, rows.map((r) => r.object_key));
        return rows.map((r) => r.file_id);
      });
      total += n;
      if (n < BATCH) break;
    }
    if (total) logger.info({ purged: total }, 'purged soft-deleted files');
    return total;
  }

  function start() {
    const tick = () => runOnce().catch((err) => logger.error({ err }, 'purge job failed'));
    const first = setTimeout(tick, 60_000);
    const timer = setInterval(tick, EVERY_MS);
    first.unref();
    timer.unref();
  }

  return { runOnce, start };
}

module.exports = { createPurgeJob, PURGEABLE };
