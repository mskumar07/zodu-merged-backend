const express  = require('express');
const multer   = require('multer');
const router   = express.Router();
const service  = require('../services/checklist-service');
const validate = require('../utils/requestValidator');
const schema   = require('../schema/checklist-schema');

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },   // 10 MB
  fileFilter: (req, file, cb) => {
    const allowed = [
      'image/jpeg', 'image/png',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];
    allowed.includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error('Only JPG, PNG, PDF, DOC, XLS files are allowed'));
  },
});

// helper — extract user from gateway-injected headers
// const getUser = (req) => ({
//   user_id: req.headers['x-user-id']   || req.user?.user_id,
//   name:    req.headers['x-user-name'] || req.user?.name || 'Unknown',
// });

const requireParams = (...keys) => (req, res, next) => {
  for (const key of keys) {
    if (!req.query[key] && !req.body[key])
      return res.status(400).json({ success: false, error: `${key} is required` });
  }
  next();
};

// ── CREATE  POST /api/checklists ──────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { errors, input } = await validate(schema.checklist_create, req.body);
    if (errors) return res.status(400).json({ success: false, errors });

    const result = await service.createChecklist(input);
    return res.status(201).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── ASSIGNED TO EMPLOYEES SUMMARY  GET /api/checklists/assigned-employees-summary ─
// Admin left card: total/pending/completed for tasks I created
// Query: zodu_id, branch_id, created_by
router.get('/assigned-employees-summary', requireParams('zodu_id', 'branch_id'), async (req, res) => {
  try {
    const { zodu_id, branch_id, created_by, search, status } = req.query;
    if (!created_by) return res.status(400).json({ success: false, error: 'created_by is required' });

    const result = await service.getAssignedEmployeesSummary({ zodu_id, branch_id, created_by, search, status });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── MY TASK SUMMARY  GET /api/checklists/my-summary ─────────────────────────
// Top section: single employee's task count card
// Query: zodu_id, branch_id, employee_id
router.get('/my-summary', requireParams('zodu_id', 'branch_id'), async (req, res) => {
  try {
    const { zodu_id, branch_id, employee_id, search, status } = req.query;
    if (!employee_id) return res.status(400).json({ success: false, error: 'employee_id is required' });

    const result = await service.getMyTaskSummary({ zodu_id, branch_id, employee_id, search, status });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── MY ASSIGNED TASKS  GET /api/checklists/my-tasks ──────────────────────────
// Bottom table: all tasks assigned TO the employee
// Query: zodu_id, branch_id, employee_id, status, page, limit
router.get('/my-tasks', requireParams('zodu_id', 'branch_id'), async (req, res) => {
  try {
    const { zodu_id, branch_id, employee_id, status, search, page, limit } = req.query;
    if (!employee_id) return res.status(400).json({ success: false, error: 'employee_id is required' });

    const result = await service.getMyAssignedTasks({
      zodu_id, branch_id, employee_id, status, search, page, limit,
    });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── MY TASK DETAIL  GET /api/checklists/my-tasks/:id ──────────────────────────
// Single checklist detail for the logged-in employee — items + their own progress
// Query: zodu_id, branch_id, employee_id
router.get('/my-tasks/:id', requireParams('zodu_id', 'branch_id', 'employee_id'), async (req, res) => {
  try {
    const { zodu_id, branch_id, employee_id } = req.query;
    const result = await service.getMyTaskDetail(req.params.id, { zodu_id, branch_id, employee_id });
    if (!result) return res.status(404).json({ success: false, error: 'Checklist not found' });
    return res.status(result.success === false ? 403 : 200).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── ASSIGNED TO EMPLOYEES  GET /api/checklists/assigned-employees ────────────
// Admin overview table: one row per employee, for tasks THIS admin assigned
// Query: zodu_id, branch_id, created_by, search, page, limit
router.get('/assigned-employees', requireParams('zodu_id', 'branch_id', 'created_by'), async (req, res) => {
  try {
    const { zodu_id, branch_id, created_by, search, status, page, limit } = req.query;
    const result = await service.getAssignedEmployees({ zodu_id, branch_id, created_by, search, status, page, limit });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── LIST  GET /api/checklists?zodu_id=&branch_id=&status=&search=&page=&limit= ─
router.get('/', requireParams('zodu_id', 'branch_id'), async (req, res) => {
  try {
    const { zodu_id, branch_id, status, search, page, limit } = req.query;
    const result = await service.getChecklists({ zodu_id, branch_id, status, search, page, limit });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── DETAIL  GET /api/checklists/:id?zodu_id=&branch_id= ──────────────────────
router.get('/:id', requireParams('zodu_id', 'branch_id'), async (req, res) => {
  try {
    const { zodu_id, branch_id } = req.query;
    const result = await service.getChecklistById(req.params.id, { zodu_id, branch_id });
    if (!result) return res.status(404).json({ success: false, error: 'Checklist not found' });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── UPDATE  PUT /api/checklists/:id ──────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const { errors, input } = await validate(schema.checklist_update, req.body);
    if (errors) return res.status(400).json({ success: false, errors });

    const result = await service.updateChecklist(req.params.id, input);
    return res.status(200).json(result);  
  } catch (err) {
    const status = err.message === 'Checklist not found' ? 404 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});

// ── UPDATE TASK STATUS  PUT /api/checklists/:id/task-status ──────────────────
// Admin "Update Task Status" modal — bulk update item status + remarks,
// checklist's own status is auto-derived from the resulting item statuses.
// Body: { zodu_id, branch_id, items: [{ item_id, status, remarks }] }
router.put('/:id/task-status', async (req, res) => {
  try {
    const { errors, input } = await validate(schema.task_status_update, req.body);
    if (errors) return res.status(400).json({ success: false, errors });

    const result = await service.updateTaskStatus(req.params.id, input);
    return res.status(200).json(result);
  } catch (err) {
    const status = err.message === 'Checklist not found' ? 404 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});

// ── DELETE  DELETE /api/checklists/:id ───────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const { zodu_id, branch_id } = req.body;
    if (!zodu_id)   return res.status(400).json({ success: false, error: 'zodu_id is required' });
    if (!branch_id) return res.status(400).json({ success: false, error: 'branch_id is required' });

    const result = await service.deleteChecklist(req.params.id, { zodu_id, branch_id });
    return res.status(200).json(result);
  } catch (err) {
    const status = err.message === 'Checklist not found' ? 404 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});

// ── UPLOAD ATTACHMENTS  POST /api/checklists/:id/attachments ─────────────────
// Called at task creation time only — uploads up to 5 files at once
// multipart/form-data: files[] + { zodu_id, branch_id }
router.post('/:id/attachments', upload.array('files', 5), async (req, res) => {
  try {
    const { zodu_id, branch_id, employee_id, employee_name } = req.body;
    if (!zodu_id)        return res.status(400).json({ success: false, error: 'zodu_id is required' });
    if (!branch_id)      return res.status(400).json({ success: false, error: 'branch_id is required' });
    if (!req.files?.length) return res.status(400).json({ success: false, error: 'At least one file is required' });

    const result = await service.uploadAttachments(
      req.params.id, req.files, { zodu_id, branch_id, employee_id, employee_name }
    );
    return res.status(201).json(result);
  } catch (err) {
    const status = err.message.includes('not found') ? 404
                 : err.message.includes('Maximum')   ? 400
                 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});

// ── DELETE ATTACHMENT FILE  DELETE /api/checklists/:id/attachments/:file_id ──
router.delete('/:id/attachments/:file_id', async (req, res) => {
  try {
    const result = await service.deleteAttachment(req.params.id, req.params.file_id);
    return res.status(200).json(result);
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});

// ── UPLOAD FILE(S) TO ITEM  POST /api/checklists/items/:item_id/files ────────
// Admin on create OR employee when completing the item
// multipart/form-data: files[] (up to 5) + { employee_id, employee_name }
router.post('/items/:item_id/files', upload.array('files', 5), async (req, res) => {
  try {
    const { employee_id, employee_name, employee_checklist_upload } = req.body;
    if (!employee_id || !employee_name || !req.files?.length)
      return res.status(400).json({ success: false, error: 'employee_id, employee_name, files are required' });

    const isEmployeeUpload = employee_checklist_upload === 'true' || employee_checklist_upload === true;
    const result = await service.uploadItemFile(req.params.item_id, req.files, employee_id, employee_name, isEmployeeUpload);
    return res.status(201).json(result);
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});

// ── DELETE ITEM  DELETE /api/checklists/items/:item_id ───────────────────────
router.delete('/items/:item_id', async (req, res) => {
  try {
    const result = await service.deleteItem(req.params.item_id);
    return res.status(200).json(result);
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});

// ── DELETE FILE FROM ITEM  DELETE /api/checklists/items/:item_id/files/:file_id
// Body: { employee_checklist_upload: true } → removes from employee_checklist_upload column
// Body: {} or omitted                       → removes from file_url column (normal flow)
router.delete('/items/:item_id/files/:file_id', async (req, res) => {
  try {
    const { employee_checklist_upload } = req.body;
    const isEmployeeUpload = employee_checklist_upload === true || employee_checklist_upload === 'true';
    const result = await service.deleteItemFile(req.params.item_id, req.params.file_id, isEmployeeUpload);
    return res.status(200).json(result);
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});

// ── LIST INSTANCES  GET /api/checklists/instances?zodu_id=&branch_id=&checklist_id=&status= ─
router.get('/instances/list', requireParams('zodu_id', 'branch_id'), async (req, res) => {
  try {
    const { zodu_id, branch_id, checklist_id, status, page, limit } = req.query;
    const result = await service.getInstances({ checklist_id, zodu_id, branch_id, status, page, limit });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── MARK ITEM PROGRESS  POST /api/checklists/progress ────────────────────────
// Body: { instance_id, item_id, employee_id, is_completed }
router.post('/progress', async (req, res) => {
  try {
    const { errors, input } = await validate(schema.item_progress, req.body);
    if (errors) return res.status(400).json({ success: false, errors });

    const result = await service.markItemProgress(input);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET ITEM PROGRESS  GET /api/checklists/progress/:instance_id?employee_id= ─
router.get('/progress/:instance_id', async (req, res) => {
  try {
    const { employee_id } = req.query;
    if (!employee_id) return res.status(400).json({ success: false, error: 'employee_id is required' });

    const result = await service.getItemProgress(req.params.instance_id, employee_id);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
