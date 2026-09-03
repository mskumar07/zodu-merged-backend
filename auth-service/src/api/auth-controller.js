const express = require('express');
const multer = require('multer');
const authService  = require('../services/auth-service');
const RequestValidator = require('../utils/requestValidator');
const schema       = require('../schema/auth-schema');
const STATUS_CODES = require('../utils/error/status-codes');
const { logger, ValidateSignature } = require('../utils');

const router = express.Router();

// Signature images are small; keep them in memory and hand the buffer straight
// to MinIO rather than touching disk. The 2MB cap is enforced here as well as
// in utils/minio so an oversized upload is rejected before it is buffered.
const uploadSignature = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
}).single('signature');

// Company logos are a little larger than a signature but still small enough to
// buffer. Optional on the company create/edit routes: multer ignores a request
// that isn't multipart, so those endpoints keep accepting plain JSON.
const uploadCompanyLogo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
}).single('company_logo');

// multer reports its own errors (wrong field name, file too large) out of band
// — turn them into the same 400 shape the rest of these routes return.
const handleSignatureUpload = (req, res, next) =>
  uploadSignature(req, res, (err) => {
    if (!err) return next();
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'Signature image exceeds the 2MB limit'
        : err.code === 'LIMIT_UNEXPECTED_FILE'
        ? "Unexpected file field — send the image as 'signature'"
        : err.message;
    return res.status(STATUS_CODES.BAD_REQUEST).json({ message });
  });

const handleCompanyLogoUpload = (req, res, next) =>
  uploadCompanyLogo(req, res, (err) => {
    if (!err) return next();
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'Company logo image exceeds the 5MB limit'
        : err.code === 'LIMIT_UNEXPECTED_FILE'
        ? "Unexpected file field — send the image as 'company_logo'"
        : err.message;
    return res.status(STATUS_CODES.BAD_REQUEST).json({ message });
  });

async function handleCreateCompany(req, res) {
  try {
    const { errors, input } = await RequestValidator(schema.add_business, req.body);
    console.log(errors)
    if (errors) return res.status(STATUS_CODES.BAD_REQUEST).json({ errors });

    const data = await authService.AddCompany(input, req.user.user_id, req.file || null);
    if (data.error) return res.status(400).json(data);
    return res.status(201).json(data);
  } catch (error) {
    logger.error(error);
    return res.status(STATUS_CODES.INTERNAL_ERROR).json({ message: error.message });
  }
}

async function handleAddBranch(req, res) {
  try {
    const { errors, input } = await RequestValidator(schema.add_branch, req.body);
    console.log("new",errors)
    if (errors) return res.status(STATUS_CODES.BAD_REQUEST).json({ errors });

    const data = await authService.AddBranch(input, req.user.user_id);
    if (data.error) return res.status(400).json(data);
    return res.status(201).json(data);
  } catch (error) {
    logger.error(error);
    return res.status(STATUS_CODES.INTERNAL_ERROR).json({ message: error.message });
  }
}

async function handleEditCompany(req, res) {
  try {
    console.log(req.body)
    // edit_business demands zodu_id + at least one field to change. A logo-only
    // edit sends the file and an empty body, so relax that floor when a file
    // is attached — the file *is* the change.
    const editSchema = req.file ? schema.edit_business.min(1) : schema.edit_business;
    const { errors, input } = await RequestValidator(editSchema, {
      ...req.body,
      zodu_id: req.params.zodu_id,
    });

    console.log(errors)
    if (errors) return res.status(STATUS_CODES.BAD_REQUEST).json({ errors });

    const data = await authService.EditCompany(input, req.user.user_id, req.file || null);
    console.log(data)
    if (data.error) return res.status(400).json(data);
    return res.status(200).json(data);
  } catch (error) {
    logger.error(error);
    return res.status(STATUS_CODES.INTERNAL_ERROR).json({ message: error.message });
  }
}

async function handleEditBranch(req, res) {
  try {
    const { errors, input } = await RequestValidator(schema.edit_branch, {
      ...req.body,
      zodu_id: req.params.zodu_id,
      branch_id: req.params.branch_id,
    });
    console.log(errors)
    if (errors) return res.status(STATUS_CODES.BAD_REQUEST).json({ errors });

    const data = await authService.EditBranch(input, req.user.user_id);
    if (data.error) return res.status(400).json(data);
    return res.status(200).json(data);
  } catch (error) {
    logger.error(error);
    return res.status(STATUS_CODES.INTERNAL_ERROR).json({ message: error.message });
  }
}

// ── POST /api/create-account ──────────────────────────────────────────────────
router.post('/api/create-account', async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema.account_create, req.body);
    if (errors) {
      console.log(errors)
      logger.error('Validation errors:', errors);
      return res.status(STATUS_CODES.BAD_REQUEST).json({ errors });
    }
    const data = await authService.CreateAccount(input);
    // Return 409 if service returned an error, 201 on success
    if (data.error) {
      return res.status(STATUS_CODES.CONFLICT || 409).json(data);
    }
    return res.status(201).json(data);
  } catch (error) {
    logger.error(error);
    console.log(error)
    return res.status(STATUS_CODES.INTERNAL_ERROR).json({ message: error.message });
  }
});

// ── POST /api/login ───────────────────────────────────────────────────────────
router.post('/api/login', async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema.login, req.body);
    console.log(errors,input)
    if (errors) return res.status(STATUS_CODES.BAD_REQUEST).json({ errors });

    // Pass request metadata for session tracking
    const meta = {
      ip_address: req.ip || req.headers['x-forwarded-for'],
      user_agent: req.headers['user-agent'],
    };

    const data = await authService.AccountLogin(input, meta);
    if (data.error) {
      return res.status(401).json(data);
    }
    console.log(data);
    return res.status(STATUS_CODES.OK).json(data);
  } catch (error) {
    logger.error(error);
    return res.status(STATUS_CODES.INTERNAL_ERROR).json({ message: error.message });
  }
});

// ── POST /api/refresh-token ───────────────────────────────────────────────────
router.post('/api/refresh-token', async (req, res) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) {
      return res.status(STATUS_CODES.BAD_REQUEST).json({ error: 'refresh_token required' });
    }
    const data = await authService.RefreshToken({ refresh_token });
    if (data.error) {
      return res.status(401).json(data);
    }
    return res.status(STATUS_CODES.OK).json(data);
  } catch (error) {
    logger.error(error);
    return res.status(STATUS_CODES.INTERNAL_ERROR).json({ message: error.message });
  }
});

// ── POST /api/logout ──────────────────────────────────────────────────────────
router.post('/api/logout', async (req, res) => {
  try {
    const { refresh_token } = req.body;
    const data = await authService.Logout({ refresh_token });
    return res.status(STATUS_CODES.OK).json(data);
  } catch (error) {
    logger.error(error);
    return res.status(STATUS_CODES.INTERNAL_ERROR).json({ message: error.message });
  }
});

// ── GET /api/auth-check ───────────────────────────────────────────────────────
router.get('/api/auth-check', ValidateSignature, async (req, res) => {
  try {
    logger.info('Auth check hit by:', req.user?.zodu_id);
    return res.status(STATUS_CODES.OK).json({
      message: 'You are authorized',
      user: req.user,
    });
  } catch (error) {
    logger.error(error);
    return res.status(STATUS_CODES.INTERNAL_ERROR).json({ message: error.message });
  }
});

// ── POST /api/company/add ─────────────────────────────────────────────────────
// Accepts JSON, or multipart/form-data with the logo image in `company_logo`
// so a company can be created with its logo in a single request.
router.post('/api/company/add', ValidateSignature, handleCompanyLogoUpload, handleCreateCompany);
router.post('/api/create-company', ValidateSignature, handleCompanyLogoUpload, handleCreateCompany);
router.post('/api/branch/add', ValidateSignature, handleAddBranch);
router.put('/api/company/edit/:zodu_id', ValidateSignature, handleCompanyLogoUpload, handleEditCompany);
router.put('/api/branch/edit/:zodu_id/:branch_id', ValidateSignature, handleEditBranch);

// ── POST /api/company/:zodu_id/logo ───────────────────────────────────────────
// multipart/form-data, image in the `company_logo` field. Replaces whatever
// logo the company had and returns the full updated company row.
router.post(
  '/api/company/:zodu_id/logo',
  ValidateSignature,
  handleCompanyLogoUpload,
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(STATUS_CODES.BAD_REQUEST).json({ message: "No file uploaded — send the image as 'company_logo'" });
      }

      const data = await authService.UploadCompanyLogo({
        user_id: req.user.user_id,
        zodu_id: req.params.zodu_id,
        file: req.file,
      });
      if (data.error) return res.status(400).json(data);
      return res.status(STATUS_CODES.OK).json(data);
    } catch (error) {
      logger.error(error);
      return res.status(STATUS_CODES.INTERNAL_ERROR).json({ message: error.message });
    }
  }
);

// ── DELETE /api/company/:zodu_id/logo ─────────────────────────────────────────
router.delete('/api/company/:zodu_id/logo', ValidateSignature, async (req, res) => {
  try {
    const data = await authService.DeleteCompanyLogo({
      user_id: req.user.user_id,
      zodu_id: req.params.zodu_id,
    });
    if (data.error) return res.status(400).json(data);
    return res.status(STATUS_CODES.OK).json(data);
  } catch (error) {
    logger.error(error);
    return res.status(STATUS_CODES.INTERNAL_ERROR).json({ message: error.message });
  }
});

// ── GET /api/my-companies ─────────────────────────────────────────────────────
router.get('/api/my-companies', ValidateSignature, async (req, res) => {
  try {
    console.log("test")
    const data = await authService.GetMyCompanies(req.user.user_id);
    return res.status(STATUS_CODES.OK).json(data);
  } catch (error) {
    logger.error(error);
    return res.status(STATUS_CODES.INTERNAL_ERROR).json({ message: error.message });
  }
});

// ── GET /api/role-access ──────────────────────────────────────────────────────
// Query: user_id, zodu_id, branch_id
// Admin role → zodu_id-only access (branch ignored). Other roles → zodu_id + branch_id.
router.get('/api/role-access', ValidateSignature, async (req, res) => {
  try {
    const { zodu_id, branch_id } = req.query;
    const data = await authService.GetRoleAccess({
      user_id: req.user.user_id,
      zodu_id,
      branch_id,
    });
    if (data.error) return res.status(400).json(data);
    return res.status(STATUS_CODES.OK).json(data);
  } catch (error) {
    logger.error(error);
    return res.status(STATUS_CODES.INTERNAL_ERROR).json({ message: error.message });
  }
});

// ── GET /api/settings/:zodu_id/:branch_id ─────────────────────────────────────
// Common settings endpoint — returns every settings category for this branch
// in one response, namespaced by category (currently just "invoice"). Add new
// categories to authService.GetAllSettings as their tables land; this route
// stays the same.
router.get('/api/settings/:zodu_id/:branch_id', ValidateSignature, async (req, res) => {
  try {
    const { zodu_id, branch_id } = req.params;
    const data = await authService.GetAllSettings({
      user_id: req.user.user_id,
      zodu_id,
      branch_id,
    });
    if (data.error) return res.status(400).json(data);
    return res.status(STATUS_CODES.OK).json(data);
  } catch (error) {
    logger.error(error);
    return res.status(STATUS_CODES.INTERNAL_ERROR).json({ message: error.message });
  }
});

// ── GET /api/invoice-settings/:zodu_id/:branch_id ─────────────────────────────
router.get('/api/invoice-settings/:zodu_id/:branch_id', ValidateSignature, async (req, res) => {
  try {
    const { zodu_id, branch_id } = req.params;
    const data = await authService.GetInvoiceSettings({
      user_id: req.user.user_id,
      zodu_id,
      branch_id,
    });
    if (data.error) return res.status(400).json(data);
    return res.status(STATUS_CODES.OK).json(data);
  } catch (error) {
    logger.error(error);
    return res.status(STATUS_CODES.INTERNAL_ERROR).json({ message: error.message });
  }
});

// ── PUT /api/invoice-settings/:zodu_id/:branch_id ─────────────────────────────
router.put('/api/invoice-settings/:zodu_id/:branch_id', ValidateSignature, async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema.edit_invoice_settings, {
      ...req.body,
      zodu_id: req.params.zodu_id,
      branch_id: req.params.branch_id,
    });
    if (errors) return res.status(STATUS_CODES.BAD_REQUEST).json({ errors });

    const data = await authService.EditInvoiceSettings({
      user_id: req.user.user_id,
      ...input,
    });
    if (data.error) return res.status(400).json(data);
    return res.status(STATUS_CODES.OK).json(data);
  } catch (error) {
    logger.error(error);
    return res.status(STATUS_CODES.INTERNAL_ERROR).json({ message: error.message });
  }
});

// ── POST /api/invoice-settings/:zodu_id/:branch_id/signature ──────────────────
// multipart/form-data, image in the `signature` field. Replaces whatever
// signature the branch had and returns the full updated settings row.
router.post(
  '/api/invoice-settings/:zodu_id/:branch_id/signature',
  ValidateSignature,
  handleSignatureUpload,
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(STATUS_CODES.BAD_REQUEST).json({ message: "No file uploaded — send the image as 'signature'" });
      }

      const { zodu_id, branch_id } = req.params;
      const data = await authService.UploadInvoiceSignature({
        user_id: req.user.user_id,
        zodu_id,
        branch_id,
        file: req.file,
      });
      if (data.error) return res.status(400).json(data);
      return res.status(STATUS_CODES.OK).json(data);
    } catch (error) {
      logger.error(error);
      return res.status(STATUS_CODES.INTERNAL_ERROR).json({ message: error.message });
    }
  }
);

// ── DELETE /api/invoice-settings/:zodu_id/:branch_id/signature ────────────────
router.delete('/api/invoice-settings/:zodu_id/:branch_id/signature', ValidateSignature, async (req, res) => {
  try {
    const { zodu_id, branch_id } = req.params;
    const data = await authService.DeleteInvoiceSignature({
      user_id: req.user.user_id,
      zodu_id,
      branch_id,
    });
    if (data.error) return res.status(400).json(data);
    return res.status(STATUS_CODES.OK).json(data);
  } catch (error) {
    logger.error(error);
    return res.status(STATUS_CODES.INTERNAL_ERROR).json({ message: error.message });
  }
});

module.exports = router;
