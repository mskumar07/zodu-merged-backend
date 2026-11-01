const express  = require('express');
const multer   = require('multer');
const router   = express.Router();
const service  = require('../services/employee-service');
const RequestValidator = require('../utils/requestValidator');
const schema   = require('../schema/employee-schema');
const files    = require('../utils/file-client');
const faceService = require('../services/face-service');
const faceUpload  = require('../utils/face-upload');
const security    = require('../security');
const { tenantOf, callerOf } = require('../security/request');

security.protectParams(router);

// multer — keep file in memory, hand it to file-service
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
    const { errors, input } = await RequestValidator(schema.employee_create, { ...req.body, ...tenantOf(req) });
    if (errors) return res.status(400).json({ success: false, errors });

    const result = await service.createEmployee(input, req.auth.userId);
    return res.status(result.success ? 201 : 400).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── LIST  GET /api/employees?zodu_id=&branch_id=&status=&page=&limit= ─────────
router.get('/', async (req, res) => {
  try {
    const { status, page, limit, search } = req.query;
    const { zodu_id, branch_id } = tenantOf(req);
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
    const { zodu_id, branch_id } = tenantOf(req);
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
    const { errors, input } = await RequestValidator(schema.employee_update, { ...req.body, ...tenantOf(req) });
    if (errors) return res.status(400).json({ success: false, errors });

    const result = await service.updateEmployee(req.params.id, input, req.auth.userId, callerOf(req));
    return res.status(result.success ? 200 : 400).json(result);
  } catch (err) {
    if (err.status === 403 || err.message === 'Employee not found') {
      return res.status(err.status || 404).json({ success: false, error: err.message });
    }
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── SET LOGIN DETAILS  PUT /api/employees/:id/login-details ──────────────────
// Body: { zodu_id, branch_id, role_id?, password?, confirm_password? } — only the
// fields the employee is missing (see has_role / has_password on the list API)
router.put('/:id/login-details', async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema.employee_login_details, { ...req.body, ...tenantOf(req) });
    if (errors) return res.status(400).json({ success: false, errors });
    // Choosing a role decides the user's permissions: role:edit (the owner, for now).
    const caller = callerOf(req);
    if (input.role_id && !caller.canAssignRoles) {
      return res.status(403).json({ success: false, error: 'Permission denied' });
    }

    const result = await service.setLoginDetails(req.params.id, input, caller);
    return res.status(200).json(result);
  } catch (err) {
    const status = err.message === 'Employee not found' ? 404 : (err.status || 500);
    return res.status(status).json({ success: false, error: err.message });
  }
});

// ── PUT  PUT /api/employees/:id ────────────────────────────────────────
// Body: { zodu_id, branch_id, status }
router.put('/active-inactive/:id', async (req, res) => {
  try {
    const { status } = req.body || {};
    const { zodu_id, branch_id } = tenantOf(req);
    if (!branch_id) return res.status(400).json({ success: false, error: 'branch_id is required' });
    if (!status) return res.status(400).json({ success: false, error: 'status is required' });

    const result = await service.deleteEmployee(req.params.id, { zodu_id, branch_id, status }, callerOf(req));
    return res.status(result.success ? 200 : 400).json(result);
  } catch (err) {
    const status = err.status === 403 ? 403 : err.message === 'Employee not found' ? 404 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});

// ── UPLOAD DOCUMENT  POST /api/employees/:id/documents ───────────────────────
// multipart/form-data: file + { zodu_id, branch_id, document_type }
router.post('/:id/documents', upload.single('file'), security.tenantBody, async (req, res) => {
  try {
    const { document_type } = req.body;
    const { zodu_id, branch_id } = tenantOf(req);
    if (!branch_id)      return res.status(400).json({ success: false, error: 'branch_id is required' });
    if (!document_type)  return res.status(400).json({ success: false, error: 'document_type is required' });
    if (!req.file)       return res.status(400).json({ success: false, error: 'file is required' });

    // Stored in file-service (module employee); the row keeps the file_id and
    // the response carries a fresh URL in file_url.
    const result = await service.uploadDocument(req.params.id, {
      zodu_id,
      branch_id,
      document_type,
      file: req.file,
    }, req.auth.userId, files.requestCtx(req, { zoduId: zodu_id, branchId: branch_id, userId: req.auth.userId }));

    return res.status(result.success ? 201 : 400).json(result);
  } catch (err) {
    if (err.message === 'Employee not found') return res.status(404).json({ success: false, error: err.message });
    // file-service refused the file (wrong type, too big, unsafe content) or is down.
    if (err instanceof files.FileServiceError) {
      return res.status(err.status).json({ success: false, error: err.details?.[0]?.error || err.message });
    }
    console.error('[documents] upload failed:', err);
    return res.status(500).json({ success: false, error: 'Failed to upload document. Please try again.' });
  }
});

// ── DELETE DOCUMENT  DELETE /api/employees/:id/documents/:doc_id ─────────────
// Body: { zodu_id, branch_id }
router.delete('/:id/documents/:doc_id', async (req, res) => {
  try {
    const { zodu_id, branch_id } = tenantOf(req);
    if (!branch_id) return res.status(400).json({ success: false, error: 'branch_id is required' });

    const result = await service.deleteDocument(req.params.doc_id, req.params.id, { zodu_id, branch_id },
      files.requestCtx(req, { zoduId: zodu_id, branchId: branch_id, userId: req.auth.userId }));
    return res.status(result.success ? 200 : 400).json(result);
  } catch (err) {
    const status = err.message === 'Document not found' ? 404 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});

// ── FACE (attendance)  /api/employees/:id/face ───────────────────────────────
// POST   multipart: face (photo) + { zodu_id, branch_id } — register / replace
// GET    → { registered, updated_at }
// DELETE → removes the registered face
router.post('/:id/face', faceUpload('face'), security.tenantBody, async (req, res) => {
  try {
    const { zodu_id, branch_id } = tenantOf(req);
    if (!branch_id) return res.status(400).json({ success: false, message: 'branch_id is required' });
    if (!req.file)  return res.status(400).json({ success: false, message: 'face photo is required' });

    const result = await faceService.registerFace({
      employee_id: req.params.id, zodu_id, branch_id, file: req.file,
    });
    return res.status(201).json(result);
  } catch (err) {
    return faceUpload.sendError(res, err);
  }
});

router.get('/:id/face', async (req, res) => {
  try {
    return res.status(200).json(await faceService.getFaceStatus(req.params.id, tenantOf(req)));
  } catch (err) {
    return faceUpload.sendError(res, err);
  }
});

router.delete('/:id/face', async (req, res) => {
  try {
    return res.status(200).json(await faceService.deleteFace(req.params.id, tenantOf(req)));
  } catch (err) {
    return faceUpload.sendError(res, err);
  }
});


module.exports = router;
