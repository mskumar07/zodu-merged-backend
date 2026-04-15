const express = require('express');
const authService  = require('../services/auth-service');
const RequestValidator = require('../utils/requestValidator');
const schema       = require('../schema/auth-schema');
const STATUS_CODES = require('../utils/error/status-codes');
const { logger, ValidateSignature } = require('../utils');

const router = express.Router();

async function handleCreateCompany(req, res) {
  try {
    const { errors, input } = await RequestValidator(schema.add_company, req.body);
    console.log(errors)
    if (errors) return res.status(STATUS_CODES.BAD_REQUEST).json({ errors });

    const data = await authService.AddCompany(input, req.user.user_id);
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
    console.log(errors)
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
    const { errors, input } = await RequestValidator(schema.edit_company, {
      ...req.body,
      zodu_id: req.params.zodu_id,
    });

    console.log(errors)
    if (errors) return res.status(STATUS_CODES.BAD_REQUEST).json({ errors });

    const data = await authService.EditCompany(input, req.user.user_id);
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
router.post('/api/company/add', ValidateSignature, handleCreateCompany);
router.post('/api/create-company', ValidateSignature, handleCreateCompany);
router.post('/api/branch/add', ValidateSignature, handleAddBranch);
router.put('/api/company/edit/:zodu_id', ValidateSignature, handleEditCompany);
router.put('/api/branch/edit/:zodu_id/:branch_id', ValidateSignature, handleEditBranch);

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

module.exports = router;
