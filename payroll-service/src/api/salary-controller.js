const express  = require('express');
const router   = express.Router();
const service  = require('../services/salary-service');
const RequestValidator = require('../utils/requestValidator');
const schema   = require('../schema/salary-schema');

// ── INTERNAL — called by employee-service (no JWT, internal network only) ─────

router.post('/internal/salary/create', async (req, res) => {
  const { errors, input } = await RequestValidator(schema.salary_create, req.body);
  if (errors) return res.status(400).json({ success: false, errors });

  const result = await service.createSalary(input);
  return res.status(result.success ? 201 : 400).json(result);
});

router.get('/internal/salary/:employee_id', async (req, res) => {
  const result = await service.getSalary(req.params.employee_id);
  return res.status(200).json(result);
});

router.put('/internal/salary/:employee_id', async (req, res) => {
  const { errors, input } = await RequestValidator(schema.salary_update, req.body);
  if (errors) return res.status(400).json({ success: false, errors });

  const result = await service.updateSalary(req.params.employee_id, input);
  return res.status(result.success ? 200 : 400).json(result);
});

// ── PUBLIC — exposed via API Gateway (JWT verified at gateway) ────────────────

router.get('/api/salary', async (req, res) => {
  const { zodu_id, branch_id, page, limit } = req.query;
  if (!zodu_id) return res.status(400).json({ success: false, error: 'zodu_id is required' });

  const result = await service.getSalaryList({ zodu_id, branch_id, page, limit });
  return res.status(200).json(result);
});

router.get('/api/salary/:employee_id', async (req, res) => {
  const result = await service.getSalary(req.params.employee_id);
  if (!result.data) return res.status(404).json({ success: false, error: 'Salary not found' });
  return res.status(200).json(result);
});

router.get('/api/salary/:employee_id/history', async (req, res) => {
  const result = await service.getSalaryHistory(req.params.employee_id);
  return res.status(200).json(result);
});

router.put('/api/salary/:employee_id', async (req, res) => {
  const { errors, input } = await RequestValidator(schema.salary_update, req.body);
  if (errors) return res.status(400).json({ success: false, errors });

  const result = await service.updateSalary(req.params.employee_id, input);
  return res.status(result.success ? 200 : 400).json(result);
});

module.exports = router;
