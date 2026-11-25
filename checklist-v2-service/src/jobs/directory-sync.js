// employee-service → ckl.employee_directory (the read model generation and
// notifications use). §14 "Directory sync":
//   incremental every DIRECTORY_SYNC_INTERVAL_MS (updated_since) for branches with active checklists
//   full once a day: employees no longer listed are marked inactive
//   on demand (API) when a branch has never been synced
const pool = require('../database/pool');
const employees = require('../clients/employee');
const { logger } = require('../utils/logger');
const { unavailable } = require('../utils/errors');

const FULL_EVERY_MS = 24 * 3600_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function upsertPage(zodu_id, branch_id, rows) {
  if (!rows.length) return;
  await pool.query(
    `INSERT INTO ckl.employee_directory AS d
       (zodu_id, branch_id, employee_id, user_id, employee_name, is_active, source_updated_at, synced_at,
        reporting_manager_id, employee_code)
     SELECT $1, $2, x.employee_id, x.user_id, x.employee_name, x.is_active, x.updated_at, now(),
            x.reporting_manager_id, x.employee_code
       FROM unnest($3::uuid[], $4::uuid[], $5::text[], $6::boolean[], $7::timestamptz[], $8::uuid[], $9::text[])
            AS x(employee_id, user_id, employee_name, is_active, updated_at, reporting_manager_id, employee_code)
     ON CONFLICT (zodu_id, branch_id, employee_id) DO UPDATE
       SET user_id = EXCLUDED.user_id, employee_name = EXCLUDED.employee_name,
           reporting_manager_id = EXCLUDED.reporting_manager_id, employee_code = EXCLUDED.employee_code,
           is_active = EXCLUDED.is_active, source_updated_at = EXCLUDED.source_updated_at,
           synced_at = now()`,
    [
      zodu_id, branch_id,
      rows.map((r) => r.employee_id),
      rows.map((r) => r.user_id ?? null),
      rows.map((r) => String(r.employee_name ?? '').slice(0, 100) || 'Employee'),
      rows.map((r) => r.is_active !== false),
      rows.map((r) => r.updated_at ?? null),
      rows.map((r) => (UUID.test(String(r.reporting_manager_id ?? '')) ? r.reporting_manager_id : null)),
      rows.map((r) => (r.employee_code ? String(r.employee_code).slice(0, 50) : null)),
    ],
  );
}

// Syncs one branch. full: every employee, and those not listed become inactive.
async function syncBranch({ zodu_id, branch_id }, { full = false, timeoutMs = 10_000 } = {}) {
  const { rows: [{ started }] } = await pool.query('SELECT clock_timestamp() AS started');
  const { rows: [state] } = await pool.query(
    'SELECT cursor_updated_at FROM ckl.directory_sync_state WHERE zodu_id = $1 AND branch_id = $2',
    [zodu_id, branch_id],
  );
  const updatedSince = !full && state?.cursor_updated_at ? new Date(state.cursor_updated_at).toISOString() : null;
  let cursor = null;
  let maxUpdated = null;
  let count = 0;
  try {
    do {
      const page = await employees.directoryPage({
        zoduId: zodu_id, branchId: branch_id, updatedSince, cursor, timeoutMs,
      });
      await upsertPage(zodu_id, branch_id, page.data);
      for (const r of page.data) {
        if (r.updated_at && (!maxUpdated || new Date(r.updated_at) > new Date(maxUpdated))) maxUpdated = r.updated_at;
      }
      count += page.data.length;
      cursor = page.next_cursor;
    } while (cursor);

    if (full) {
      await pool.query(
        `UPDATE ckl.employee_directory SET is_active = false
          WHERE zodu_id = $1 AND branch_id = $2 AND is_active AND synced_at < $3`,
        [zodu_id, branch_id, started],
      );
    }
    await pool.query(
      `INSERT INTO ckl.directory_sync_state AS s
         (zodu_id, branch_id, last_success_at, last_full_sync_at, cursor_updated_at, last_error)
       VALUES ($1, $2, now(), CASE WHEN $3 THEN now() END, $4, NULL)
       ON CONFLICT (zodu_id, branch_id) DO UPDATE
         SET last_success_at   = now(),
             last_full_sync_at = CASE WHEN $3 THEN now() ELSE s.last_full_sync_at END,
             cursor_updated_at = GREATEST(s.cursor_updated_at, EXCLUDED.cursor_updated_at),
             last_error        = NULL`,
      [zodu_id, branch_id, full, maxUpdated],
    );
    return { synced: count, full };
  } catch (err) {
    await pool.query(
      `INSERT INTO ckl.directory_sync_state AS s (zodu_id, branch_id, last_error) VALUES ($1, $2, $3)
       ON CONFLICT (zodu_id, branch_id) DO UPDATE SET last_error = EXCLUDED.last_error`,
      [zodu_id, branch_id, String(err.cause?.message || err.message).slice(0, 1000)],
    ).catch(() => {});
    throw err;
  }
}

// API: the branch must have been synced at least once (create checklist, §8.3 step 2).
async function ensureSynced(tenant) {
  const { rows: [s] } = await pool.query(
    'SELECT last_success_at FROM ckl.directory_sync_state WHERE zodu_id = $1 AND branch_id = $2',
    [tenant.zodu_id, tenant.branch_id],
  );
  if (s?.last_success_at) return false;
  try {
    await syncBranch(tenant, { full: true, timeoutMs: 5000 });
    return true;
  } catch {
    throw unavailable('Employee list unavailable, try again', 'DIRECTORY_UNAVAILABLE');
  }
}

// API: pick up employees added since the last sync (an assignee the directory doesn't know yet).
async function refresh(tenant) {
  try {
    await syncBranch(tenant, { full: false, timeoutMs: 5000 });
  } catch (err) {
    logger.warn('directory refresh failed', { zodu_id: tenant.zodu_id, branch_id: tenant.branch_id, error: err.message });
  }
}

// Worker: every branch with an active checklist, plus branches synced before.
async function syncAll() {
  const { rows } = await pool.query(
    `SELECT b.zodu_id, b.branch_id, s.last_full_sync_at
       FROM (SELECT DISTINCT zodu_id, branch_id FROM ckl.checklists
              WHERE status = 'ACTIVE' AND deleted_at IS NULL) b
       LEFT JOIN ckl.directory_sync_state s USING (zodu_id, branch_id)`,
  );
  let ok = 0;
  let failed = 0;
  for (const r of rows) {
    const full = !r.last_full_sync_at || Date.now() - new Date(r.last_full_sync_at).getTime() > FULL_EVERY_MS;
    try {
      await syncBranch(r, { full });
      ok++;
    } catch (err) {
      failed++;
      logger.warn('directory sync failed', { zodu_id: r.zodu_id, branch_id: r.branch_id, error: err.message });
    }
  }
  await pool.query(
    `INSERT INTO ckl.job_state (job, last_run_at, stats) VALUES ('directory_sync', now(), $1)
     ON CONFLICT (job) DO UPDATE SET last_run_at = now(), stats = EXCLUDED.stats`,
    [{ branches: rows.length, ok, failed }],
  );
  return { branches: rows.length, ok, failed };
}

module.exports = { syncBranch, ensureSynced, refresh, syncAll };
