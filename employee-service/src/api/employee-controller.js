const express  = require('express');
const multer   = require('multer');
const router   = express.Router();
const service  = require('../services/employee-service');
const RequestValidator = require('../utils/requestValidator');
const schema   = require('../schema/employee-schema');
const minio    = require('../utils/minio');

// multer — keep file in memory, upload to MinIO
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
    allowed.includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error('Only JPG, PNG, PDF files are allowed'));
  },
});

// ── CREATE  POST /api/employees ───────────────────────────────────────────────
// Body: { zodu_id, branch_id, name, phone, email, ... }
router.post('/', async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema.employee_create, req.body);
    if (errors) return res.status(400).json({ success: false, errors });

    const result = await service.createEmployee(input, req.user?.user_id);
    return res.status(result.success ? 201 : 400).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── LIST  GET /api/employees?zodu_id=&branch_id=&status=&page=&limit= ─────────
router.get('/', async (req, res) => {
  try {
    const { zodu_id, branch_id, status, page, limit, search } = req.query;
    if (!zodu_id)   return res.status(400).json({ success: false, error: 'zodu_id is required' });
    if (!branch_id) return res.status(400).json({ success: false, error: 'branch_id is required' });

    const result = await service.getEmployees({ zodu_id, branch_id, status, page, limit, search });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── DETAIL  GET /api/employees/:id?zodu_id=&branch_id= ───────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { zodu_id, branch_id } = req.query;
    if (!zodu_id)   return res.status(400).json({ success: false, error: 'zodu_id is required' });
    if (!branch_id) return res.status(400).json({ success: false, error: 'branch_id is required' });

    const result = await service.getEmployeeById(req.params.id, { zodu_id, branch_id });
    if (!result) return res.status(404).json({ success: false, error: 'Employee not found' });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── UPDATE  PUT /api/employees/:id ───────────────────────────────────────────
// Body: { zodu_id, branch_id, ...fields }
router.put('/:id', async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema.employee_update, req.body);
    if (errors) return res.status(400).json({ success: false, errors });

    const result = await service.updateEmployee(req.params.id, input, req.user?.user_id);
    return res.status(result.success ? 200 : 400).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE  DELETE /api/employees/:id ────────────────────────────────────────
// Body: { zodu_id, branch_id }
router.delete('/:id', async (req, res) => {
  try {
    const { zodu_id, branch_id } = req.body;
    if (!zodu_id)   return res.status(400).json({ success: false, error: 'zodu_id is required' });
    if (!branch_id) return res.status(400).json({ success: false, error: 'branch_id is required' });

    const result = await service.deleteEmployee(req.params.id, { zodu_id, branch_id });
    return res.status(result.success ? 200 : 400).json(result);
  } catch (err) {
    const status = err.message === 'Employee not found' ? 404 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});

// ── UPLOAD DOCUMENT  POST /api/employees/:id/documents ───────────────────────
// multipart/form-data: file + { zodu_id, branch_id, document_type }
router.post('/:id/documents', upload.single('file'), async (req, res) => {
  try {
    const { zodu_id, branch_id, document_type } = req.body;
    if (!zodu_id)        return res.status(400).json({ success: false, error: 'zodu_id is required' });
    if (!branch_id)      return res.status(400).json({ success: false, error: 'branch_id is required' });
    if (!document_type)  return res.status(400).json({ success: false, error: 'document_type is required' });
    if (!req.file)       return res.status(400).json({ success: false, error: 'file is required' });

    // 1. Upload file to MinIO
    const uploaded = await minio.uploadFile(req.file, `employee-docs/${req.params.id}`);

    // 2. Save URL to DB
    const result = await service.uploadDocument(req.params.id, {
      zodu_id,
      branch_id,
      document_type,
      file_name: uploaded.fileName,
      file_url:  uploaded.fileUrl,
    }, req.user?.user_id);

    return res.status(result.success ? 201 : 400).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE DOCUMENT  DELETE /api/employees/:id/documents/:doc_id ─────────────
// Body: { zodu_id, branch_id }
router.delete('/:id/documents/:doc_id', async (req, res) => {
  try {
    const { zodu_id, branch_id } = req.body;
    if (!zodu_id)   return res.status(400).json({ success: false, error: 'zodu_id is required' });
    if (!branch_id) return res.status(400).json({ success: false, error: 'branch_id is required' });

    const result = await service.deleteDocument(req.params.doc_id, req.params.id, { zodu_id, branch_id });
    return res.status(result.success ? 200 : 400).json(result);
  } catch (err) {
    const status = err.message === 'Document not found' ? 404 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});


module.exports = router;
