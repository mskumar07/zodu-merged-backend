// Removes the stored objects of soft-deleted files once they are older than
// PURGE_AFTER_DAYS. Accounting modules (keepOnDelete) are never purged.
// The tbl_files row stays, with purged_at set, as the record of what existed.
// Safe with several replicas: each batch is locked with SKIP LOCKED.

const { MODULES } = require('../storage/modules');
const { logger } = require('../utils/logger');

const PURGEABLE = Object.entries(MODULES).filter(([, m]) => !m.keepOnDelete).map(([name]) => name);
const BATCH = 200;
const EVERY_MS = 6 * 60 * 60 * 1000;

function createPurgeJob({ repo, storage, olderThanDays, stagingTtlHours = 0 }) {
  // With bucket versioning on, removal leaves a delete marker; the bucket's
  // lifecycle rule expires the old versions (see minio-setup.md).
  const remove = async (rows) => {
    await storage.internal.removeObjects(storage.bucket, rows.map((r) => r.object_key));
    return rows.map((r) => r.file_id);
  };

  async function drain(batch) {
    let total = 0;
    for (;;) {
      const n = await batch();
      total += n;
      if (n < BATCH) return total;
    }
  }

  async function runOnce() {
    const deleted = await drain(() => repo.withPurgeBatch({ modules: PURGEABLE, olderThanDays, limit: BATCH }, remove));
    // Uploads whose record was never saved (never claimed out of staging). 0 = keep them.
    const abandoned = stagingTtlHours > 0 && repo.withExpiredStagingBatch
      ? await drain(() => repo.withExpiredStagingBatch({ olderThanHours: stagingTtlHours, limit: BATCH }, remove))
      : 0;
    if (deleted || abandoned) logger.info({ purged: deleted, abandonedUploads: abandoned }, 'purged files');
    return deleted + abandoned;
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
