// Service-to-service routes: auth-service only (api-app.js checks its
// X-Internal-Token; the gateway blocks /internal). Idempotent purges for the
// delete-branch / delete-company orchestrators (§10.3).
const express = require('express');
const { withTransaction } = require('../database/tx');
const files = require('../clients/file-client');
const { logger } = require('../utils/logger');
const { ah, badRequest } = require('../utils/errors');

const router = express.Router();
const SAFE = /^[A-Za-z0-9_-]{1,50}$/;

// Files go after the DB commit; a failure is logged, and the next purge call
// finds nothing left in the DB but file-service keeps the soft-deleted rows
// it already has (its own retention removes them).
async function purge(fileQuery, purgeSql, params, ctx) {
  const { fileIds, result } = await withTransaction(async (db) => {
    const { rows } = await db.query(fileQuery, params);
    const { rows: [r] } = await db.query(purgeSql, params);
    return { fileIds: rows.map((x) => x.file_id), result: r.result };
  });
  for (let i = 0; i < fileIds.length; i += 200) {
    try {
      await files.remove(ctx, fileIds.slice(i, i + 200));
    } catch (err) {
      logger.warn('purge: file delete failed', { error: err.message, count: fileIds.length });
      break;
    }
  }
  return { ...result, files: fileIds.length };
}

router.post('/branches/:zodu_id/:branch_id/purge', ah(async (req, res) => {
  const { zodu_id: z, branch_id: b } = req.params;
  if (!SAFE.test(z) || !SAFE.test(b)) throw badRequest('Invalid ids');
  const data = await purge(
    `SELECT i.file_id FROM ckl.checklist_images i JOIN ckl.checklists c ON c.id = i.checklist_id
      WHERE c.zodu_id = $1 AND c.branch_id = $2
     UNION ALL
     SELECT p.file_id FROM ckl.run_item_photos p JOIN ckl.run_items it ON it.id = p.run_item_id
       JOIN ckl.runs r ON r.id = it.run_id WHERE r.zodu_id = $1 AND r.branch_id = $2
     UNION ALL
     SELECT f.file_id FROM ckl.task_files f WHERE f.zodu_id = $1 AND f.branch_id = $2`,
    'SELECT ckl.fn_purge_branch($1, $2) AS result',
    [z, b],
    { zoduId: z, branchId: b },
  );
  res.json({ success: true, data });
}));

router.post('/companies/:zodu_id/purge', ah(async (req, res) => {
  const { zodu_id: z } = req.params;
  if (!SAFE.test(z)) throw badRequest('Invalid ids');
  const data = await purge(
    `SELECT i.file_id FROM ckl.checklist_images i JOIN ckl.checklists c ON c.id = i.checklist_id WHERE c.zodu_id = $1
     UNION ALL
     SELECT p.file_id FROM ckl.run_item_photos p JOIN ckl.run_items it ON it.id = p.run_item_id
       JOIN ckl.runs r ON r.id = it.run_id WHERE r.zodu_id = $1
     UNION ALL
     SELECT f.file_id FROM ckl.task_files f WHERE f.zodu_id = $1`,
    'SELECT ckl.fn_purge_company($1) AS result',
    [z],
    { zoduId: z },
  );
  res.json({ success: true, data });
}));

module.exports = router;
