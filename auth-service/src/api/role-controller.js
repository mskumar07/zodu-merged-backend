const roleService      = require('../services/role-service');
const RequestValidator = require('../utils/requestValidator');
const schema           = require('../schema/role-schema');
// const { ValidateSignature } = require('../utils');

const router = require('express').Router();

// ── CREATE ROLE ───────────────────────────────────────────────────────────────
// POST /api/roles
// Body: { zodu_id, branch_id, role_name, description, permissions[] }
router.post('/api/roles', /* ValidateSignature, */ async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema.createRole, req.body);
    if (errors) return res.status(400).json({ success: false, errors });

    const result = await roleService.createRole(input);
    return res.status(result.success ? 201 : 400).json(result);
  } catch (err) {
    const status = err.message.includes('already exists') ? 409 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});

// ── GET ALL ROLES ─────────────────────────────────────────────────────────────
// GET /api/roles?zodu_id=Z001&branch_id=B001
router.get('/api/roles', /* ValidateSignature, */ async (req, res) => {
  try {
    const { zodu_id, branch_id } = req.query;
    if (!zodu_id)   return res.status(400).json({ success: false, error: 'zodu_id is required' });
    if (!branch_id) return res.status(400).json({ success: false, error: 'branch_id is required' });

    const result = await roleService.getRoles({ zodu_id, branch_id });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET SINGLE ROLE WITH PERMISSIONS ─────────────────────────────────────────
// GET /api/roles/:role_id?zodu_id=Z001&branch_id=B001
router.get('/api/roles/:role_id', /* ValidateSignature, */ async (req, res) => {
  try {
    const { zodu_id, branch_id } = req.query;
    if (!zodu_id)   return res.status(400).json({ success: false, error: 'zodu_id is required' });
    if (!branch_id) return res.status(400).json({ success: false, error: 'branch_id is required' });

    const result = await roleService.getRoleWithPermissions(req.params.role_id, { zodu_id, branch_id });
    return res.status(result.success ? 200 : 404).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── UPDATE ROLE ───────────────────────────────────────────────────────────────
// PUT /api/roles/:role_id
// Body: { zodu_id, branch_id, role_name?, description?, permissions[]? }
router.put('/api/roles/:role_id', /* ValidateSignature, */ async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema.updateRole, req.body);
    if (errors) return res.status(400).json({ success: false, errors });

    const result = await roleService.updateRole(req.params.role_id, input);
    return res.status(result.success ? 200 : 400).json(result);
  } catch (err) {
    const status = err.message === 'Role not found' ? 404 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});

// ── DELETE ROLE ───────────────────────────────────────────────────────────────
// DELETE /api/roles/:role_id
// Body: { zodu_id, branch_id }
router.delete('/api/roles/:role_id', /* ValidateSignature, */ async (req, res) => {
  try {
    const { zodu_id, branch_id } = req.body;
    if (!zodu_id)   return res.status(400).json({ success: false, error: 'zodu_id is required' });
    if (!branch_id) return res.status(400).json({ success: false, error: 'branch_id is required' });

    const result = await roleService.deleteRole(req.params.role_id, { zodu_id, branch_id });
    return res.status(result.success ? 200 : 400).json(result);
  } catch (err) {
    const status = err.message === 'Role not found' ? 404 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});

// ── GET ALL MODULES ───────────────────────────────────────────────────────────
// GET /api/modules
router.get('/api/modules', /* ValidateSignature, */ async (req, res) => {
  try {
    const result = await roleService.getModules();
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── INTERNAL — called by employee-service (no JWT, internal network only) ─────

router.post('/internal/employee/create-user', async (req, res) => {
  try {
    console.log('Creating employee user:', req.body);
    const { errors, input } = await RequestValidator(schema.createEmployeeUser, req.body);
    if (errors) return res.status(400).json({ success: false, errors });

    const result = await roleService.createEmployeeUser(input);
    return res.status(result.success ? 201 : 400).json(result);
  } catch (err) {
    const status = err.message.includes('already registered') ? 409 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});

router.get('/internal/employee/:user_id/role', async (req, res) => {
  try {
    const result = await roleService.getEmployeeRole(req.params.user_id);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/internal/employee/:user_id/role', async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema.updateEmployeeRole, req.body);
    if (errors) return res.status(400).json({ success: false, errors });

    const result = await roleService.updateEmployeeRole(req.params.user_id, input);
    return res.status(result.success ? 200 : 400).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /internal/employee/check-duplicate
// Body: { email?, phone?, exclude_user_id }
router.post('/internal/employee/check-duplicate', async (req, res) => {
  try {
    const result = await roleService.checkDuplicate(req.body);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /internal/employee/:user_id/update-user
// Updates email, phone, password in tbl_users (only fields present in body)
router.put('/internal/employee/:user_id/update-user', async (req, res) => {
  try {
    const result = await roleService.updateEmployeeUser(req.params.user_id, req.body);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/internal/employee/:user_id/deactivate', async (req, res) => {
  try {
    const result = await roleService.deactivateEmployee(req.params.user_id);
    return res.status(result.success ? 200 : 400).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
