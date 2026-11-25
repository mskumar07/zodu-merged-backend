const express = require('express');
const router  = express.Router();
const db      = require('../database/connection');
const repo    = require('../repository/employee-repo');
const faceService = require('../services/face-service');
const faceUpload  = require('../utils/face-upload');

// Callers are checked in express-app.js (X-Internal-Token): auth-service for most
// routes; checklist / checklist_v2 for by-user; checklist_v2 for the directory.

// Called by auth-service after signup to seed the first Admin employee row.
// Body: { zodu_id, branch_id, user_id, phone, email }
router.post('/employee/create-admin', async (req, res) => {
  const { zodu_id, branch_id, user_id, phone, email } = req.body;

  if (!zodu_id || !user_id) {
    return res.status(400).json({ success: false, error: 'zodu_id and user_id are required' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const employee_code = await repo.generateEmployeeCode(client, zodu_id, branch_id || 'B1');

    const { rows } = await client.query(
      `INSERT INTO tbl_employees (
         employee_code, user_id, zodu_id, branch_id,
         name, phone, email, status, date_of_joining,
         created_by, updated_by, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4,
         $5, $6, $7, 'active', CURRENT_DATE,
         $8, $8, NOW(), NOW()
       ) RETURNING employee_id, employee_code`,
      [
        employee_code, user_id, zodu_id, branch_id || 'B1',
        'Admin', phone || null, email || null,
        user_id,
      ]
    );

    await client.query('COMMIT');
    return res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[internal] create-admin employee failed:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// Called by auth-service on login to get employee_id and employee_code by user_id.
// Query: ?user_id=&zodu_id=
router.get('/employee/by-user', async (req, res) => {
  const { user_id, zodu_id, branch_id } = req.query;

  if (!user_id || !zodu_id) {
    return res.status(400).json({ success: false, error: 'user_id and zodu_id are required' });
  }
  try {
    const { rows } = await db.query(
      `SELECT employee_id, branch_id, employee_code, name as employee_name, reporting_manager_id
       FROM tbl_employees
       WHERE user_id = $1 AND zodu_id = $2 AND branch_id = $3
       LIMIT 1`,
      [user_id, zodu_id, branch_id]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }

    return res.status(200).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('[internal] by-user lookup failed:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /internal/employees/directory — checklist-v2-service only (directory sync).
// Query: zodu_id, branch_id, updated_since (ISO, optional), cursor (last employee_id), limit ≤ 500
// → { data: [{ employee_id, user_id, employee_name, employee_code, reporting_manager_id, is_active, updated_at }], next_cursor }
// Paged by employee_id so a row edited mid-sync can't be skipped. updated_at is stored
// without a zone in the server's TimeZone; it goes out (and updated_since comes in) as UTC.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
router.get('/employees/directory', async (req, res) => {
  const { zodu_id, branch_id, updated_since, cursor } = req.query;
  if (typeof zodu_id !== 'string' || !zodu_id || typeof branch_id !== 'string' || !branch_id) {
    return res.status(400).json({ success: false, error: 'zodu_id and branch_id are required' });
  }
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 500, 1), 500);
  if (cursor !== undefined && (typeof cursor !== 'string' || !UUID_RE.test(cursor))) {
    return res.status(400).json({ success: false, error: 'invalid cursor' });
  }
  if (updated_since !== undefined && (typeof updated_since !== 'string' || Number.isNaN(Date.parse(updated_since)))) {
    return res.status(400).json({ success: false, error: 'invalid updated_since' });
  }
  try {
    const { rows } = await db.query(
      `SELECT employee_id, user_id, name AS employee_name, employee_code, reporting_manager_id,
              COALESCE(status, 'active') = 'active' AS is_active,
              updated_at AT TIME ZONE current_setting('TimeZone') AS updated_at
         FROM tbl_employees
        WHERE zodu_id = $1 AND branch_id = $2
          AND ($3::timestamptz IS NULL OR updated_at >= ($3::timestamptz AT TIME ZONE current_setting('TimeZone')))
          AND ($4::uuid IS NULL OR employee_id > $4::uuid)
        ORDER BY employee_id
        LIMIT $5`,
      [zodu_id, branch_id, updated_since || null, cursor || null, limit + 1]
    );
    const more = rows.length > limit;
    const data = more ? rows.slice(0, limit) : rows;
    return res.status(200).json({ success: true, data, next_cursor: more ? data[data.length - 1].employee_id : null });
  } catch (err) {
    console.error('[internal] directory failed:', err.message);
    return res.status(500).json({ success: false, error: 'directory lookup failed' });
  }
});

// GET /internal/employees/roster — attendance-service only. The branch's employees (every status), which it
// joins into its attendance / leave / dashboard queries instead of keeping an employee table of its own.
// Query: zodu_id, branch_id → { data: [{ employee_id, employee_code, user_id, name, status, reporting_manager_id,
// reporting_manager_name }] }. A branch's roster is a few hundred rows; capped so a bad scope can't return a table.
router.get('/employees/roster', async (req, res) => {
  const { zodu_id, branch_id } = req.query;
  if (typeof zodu_id !== 'string' || !zodu_id || typeof branch_id !== 'string' || !branch_id) {
    return res.status(400).json({ success: false, error: 'zodu_id and branch_id are required' });
  }
  try {
    const { rows } = await db.query(
      `SELECT employee_id, employee_code, user_id, name, status, reporting_manager_id, reporting_manager_name,
              zodu_id, branch_id
         FROM tbl_employees
        WHERE zodu_id = $1 AND branch_id = $2
        ORDER BY name, employee_id
        LIMIT 5000`,
      [zodu_id, branch_id]
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error('[internal] roster failed:', err.message);
    return res.status(500).json({ success: false, error: 'roster lookup failed' });
  }
});

// POST /internal/branches/:zodu_id/:branch_id/purge — hard-delete every row
// scoped to this branch. Called by auth-service's delete-branch orchestrator.
router.post('/branches/:zodu_id/:branch_id/purge', async (req, res) => {
  try {
    const { zodu_id, branch_id } = req.params;
    const results = await repo.purgeBranch(zodu_id, branch_id);
    return res.status(200).json({ success: true, data: results });
  } catch (err) {
    console.error('[internal] purgeBranch:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /internal/companies/:zodu_id/purge — hard-delete every row scoped to
// this company, all branches. Called by auth-service's delete-company orchestrator.
router.post('/companies/:zodu_id/purge', async (req, res) => {
  try {
    const { zodu_id } = req.params;
    const results = await repo.purgeCompany(zodu_id);
    return res.status(200).json({ success: true, data: results });
  } catch (err) {
    console.error('[internal] purgeCompany:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /internal/faces/identify — who is in the photo. Called by attendance-service
// for face check-in / check-out (it records the punch in its own database).
// multipart: image + { zodu_id, branch_id, employee_id? }. With employee_id only that
// employee's face is compared (self check-in); without it, the branch's staff (kiosk).
// 200 { data: { employee_id, employee_name, employee_code, similarity } }; 4xx / 503
// carry a message the app shows as-is.
const SCOPE_RE = /^[A-Za-z0-9_-]{1,50}$/;

router.post('/faces/identify', faceUpload('image'), async (req, res) => {
  try {
    const { zodu_id, branch_id, employee_id } = req.body || {};
    if (!SCOPE_RE.test(zodu_id || '') || !SCOPE_RE.test(branch_id || '')) {
      return res.status(400).json({ success: false, message: 'zodu_id and branch_id are required' });
    }
    if (employee_id && !UUID_RE.test(employee_id)) {
      return res.status(400).json({ success: false, message: 'employee_id must be a UUID' });
    }
    if (!req.file) return res.status(400).json({ success: false, message: 'image is required' });

    const result = await faceService.identifyFace({
      zodu_id, branch_id, employee_id: employee_id || undefined, file: req.file,
    });
    return res.status(200).json(result);
  } catch (err) {
    return faceUpload.sendError(res, err);
  }
});

module.exports = router;
