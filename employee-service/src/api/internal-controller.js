const express = require('express');
const router  = express.Router();
const db      = require('../database/connection');
const repo    = require('../repository/employee-repo');

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
  console.log('Received request to /internal/employee/by-user with params:', { user_id, zodu_id, branch_id });
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

module.exports = router;
