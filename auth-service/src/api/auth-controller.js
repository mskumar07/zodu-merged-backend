const express = require('express');
const multer = require('multer');
const authService  = require('../services/auth-service');
const RequestValidator = require('../utils/requestValidator');
const schema       = require('../schema/auth-schema');
const STATUS_CODES = require('../utils/error/status-codes');
const { logger } = require('../utils');
const { createRateLimit } = require('@zodu/security');
const config = require('../config');
const sessions = require('../services/session-service');
const { authenticate, getRedis } = require('../auth');
const {
  readPlatform, setRefreshCookie, clearRefreshCookie, RequestError,
} = require('../auth/request');

const router = express.Router();

// Signed-in routes: the ES256 access token (authenticate), plus req.user in
// the shape these handlers used before (user_id / zodu_id / user_type).
// Tenant checks on the :zodu_id / :branch_id routes come with the per-service
// rollout (Phase 3); until then they keep their current ownership checks.
const withLegacyUser = (req, res, next) => {
  req.user = { user_id: req.auth.userId, zodu_id: req.auth.zoduId, user_type: req.auth.userType };
  next();
};
const ValidateSignature = [authenticate, withLegacyUser];

// Per-IP limits on the public token endpoints (the gateway has a looser one
// in front). Per-account lockout is in the login flow itself.
const loginLimit = createRateLimit({
  name: 'auth-login', limit: config.LOGIN_RATE_LIMIT_PER_MIN, redis: getRedis(),
  onStoreError: (err) => logger.error({ err: err.message }, 'rate limit store'),
});
const signupLimit = createRateLimit({
  name: 'auth-signup', limit: config.SIGNUP_RATE_LIMIT_PER_MIN, redis: getRedis(),
  onStoreError: (err) => logger.error({ err: err.message }, 'rate limit store'),
});
const refreshLimit = createRateLimit({
  name: 'auth-refresh', limit: 60, redis: getRedis(),
  onStoreError: (err) => logger.error({ err: err.message }, 'rate limit store'),
});

// Sends a session-service result: Retry-After, then the refresh token as the
// web cookie or in the body (desktop, mobile, and clients without X-Client-Platform).
function send(res, result, platform) {
  if (result.retryAfter) res.set('Retry-After', String(result.retryAfter));
  const data = { ...result.data };
  if (result.refresh) {
    if (platform === 'web') setRefreshCookie(res, result.refresh.token, result.refresh.maxAge);
    else data.refresh_token = result.refresh.token;
  }
  res.set('Cache-Control', 'no-store');
  return res.status(result.status).json({ data });
}

// Wraps a token endpoint: platform header, errors without internals.
const tokenRoute = (handler) => async (req, res) => {
  let platform;
  try {
    platform = readPlatform(req);
    return await handler(req, res, platform);
  } catch (error) {
    if (error instanceof RequestError) return res.status(error.status).json({ data: { error: error.message } });
    logger.error(error);
    return res.status(STATUS_CODES.INTERNAL_ERROR).json({ data: { error: 'Something went wrong. Please try again.' } });
  }
};

// Signature images are small; keep them in memory and hand the buffer straight
// to file-service rather than touching disk. The 2MB cap is enforced here so an
// oversized upload is rejected before it is buffered; file-service checks the
// content (real type from the bytes) before anything is stored.
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
    // edit_business demands zodu_id + at least one field to change. A logo-only
    // edit sends the file and an empty body, so relax that floor when a file
    // is attached — the file *is* the change.
    const editSchema = req.file ? schema.edit_business.min(1) : schema.edit_business;
    const { errors, input } = await RequestValidator(editSchema, {
      ...req.body,
      zodu_id: req.params.zodu_id,
    });

    if (errors) return res.status(STATUS_CODES.BAD_REQUEST).json({ errors });

    const data = await authService.EditCompany(input, req.user.user_id, req.file || null);
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

// Hard-deletes a branch and every row scoped to it across every service's
// database. See authService.DeleteBranch for the full cascade/ordering
// rationale. This is destructive and irreversible — the frontend must
// confirm with the user before calling this.
async function handleDeleteBranch(req, res) {
  try {
    const { zodu_id, branch_id } = req.params;
    const data = await authService.DeleteBranch({
      zodu_id,
      branch_id,
      user_id: req.user.user_id,
    });
    if (data.error) return res.status(400).json(data);
    return res.status(200).json(data);
  } catch (error) {
    logger.error(error);
    return res.status(STATUS_CODES.INTERNAL_ERROR).json({ message: error.message });
  }
}

// Hard-deletes an entire company and every row scoped to it across every
// service's database, all branches at once. See authService.DeleteCompany
// for the full cascade/ordering rationale. This is destructive and
// irreversible — the frontend must confirm with the user before calling this.
async function handleDeleteCompany(req, res) {
  try {
    const { zodu_id } = req.params;
    const data = await authService.DeleteCompany({
      zodu_id,
      user_id: req.user.user_id,
    });
    if (data.error) return res.status(400).json(data);
    return res.status(200).json(data);
  } catch (error) {
    logger.error(error);
    return res.status(STATUS_CODES.INTERNAL_ERROR).json({ message: error.message });
  }
}

// ── POST /api/create-account ──────────────────────────────────────────────────
router.post('/api/create-account', signupLimit, async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema.account_create, req.body);
    if (errors) {
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
    return res.status(STATUS_CODES.INTERNAL_ERROR).json({ message: error.message });
  }
});

// ── POST /api/login ───────────────────────────────────────────────────────────
// Same response as before (access_token, user, companies), plus expires_in and
// context { zodu_id, branch_id, role }. refresh_token: in the body, or for
// X-Client-Platform: web in the HttpOnly cookie `rt` only.
router.post('/api/login', loginLimit, tokenRoute(async (req, res, platform) => {
  const { errors, input } = await RequestValidator(schema.login, req.body);
  if (errors) return res.status(STATUS_CODES.BAD_REQUEST).json({ errors });
  return send(res, await sessions.login(input, { req, platform }), platform);
}));

// ── POST /api/refresh-token ───────────────────────────────────────────────────
// web: cookie `rt`; desktop / mobile / no platform header: body.refresh_token.
router.post('/api/refresh-token', refreshLimit, tokenRoute(async (req, res, platform) => {
  const result = await sessions.refresh({ req, platform });
  if (result.status === 401 && platform === 'web') clearRefreshCookie(res);
  return send(res, result, platform);
}));

// ── POST /api/logout ──────────────────────────────────────────────────────────
router.post('/api/logout', tokenRoute(async (req, res, platform) => {
  clearRefreshCookie(res);
  return send(res, await sessions.logout({ req, platform }), platform);
}));

// ── POST /api/logout-all ──────────────────────────────────────────────────────
// Ends every session of the signed-in user, on every device.
router.post('/api/logout-all', authenticate, tokenRoute(async (req, res) => {
  clearRefreshCookie(res);
  return send(res, await sessions.logoutAll(req.auth, req));
}));

// ── GET /api/sessions, DELETE /api/sessions/:sid ──────────────────────────────
// The signed-in user's own sessions (devices); `current` marks this one.
router.get('/api/sessions', authenticate, tokenRoute(async (req, res) => (
  send(res, await sessions.listSessions(req.auth))
)));

router.delete('/api/sessions/:sid', authenticate, tokenRoute(async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.sid)) return res.status(404).json({ data: { error: 'Session not found' } });
  return send(res, await sessions.revokeOwnSession(req.auth, req.params.sid.toLowerCase(), req));
}));

// ── POST /api/switch-context ──────────────────────────────────────────────────
// Body { zodu_id, branch_id? }: a new access token for another company or
// branch the user belongs to, in the same session. 404 otherwise.
router.post('/api/switch-context', authenticate, tokenRoute(async (req, res) => {
  const { errors, input } = await RequestValidator(schema.switch_context, req.body);
  if (errors) return res.status(STATUS_CODES.BAD_REQUEST).json({ errors });
  return send(res, await sessions.switchContext(req.auth, input, req));
}));

// ── GET /api/auth-check ───────────────────────────────────────────────────────
router.get('/api/auth-check', authenticate, (req, res) => res.status(STATUS_CODES.OK).json({
  message: 'You are authorized',
  user: {
    user_id: req.auth.userId,
    zodu_id: req.auth.zoduId,
    branch_id: req.auth.branchId,
    user_type: req.auth.userType,
    role: req.auth.role,
  },
}));

// ── POST /api/company/add ─────────────────────────────────────────────────────
// Accepts JSON, or multipart/form-data with the logo image in `company_logo`
// so a company can be created with its logo in a single request.
router.post('/api/company/add', ValidateSignature, handleCompanyLogoUpload, handleCreateCompany);
router.post('/api/create-company', ValidateSignature, handleCompanyLogoUpload, handleCreateCompany);
router.post('/api/branch/add', ValidateSignature, handleAddBranch);
router.put('/api/company/edit/:zodu_id', ValidateSignature, handleCompanyLogoUpload, handleEditCompany);
router.put('/api/branch/edit/:zodu_id/:branch_id', ValidateSignature, handleEditBranch);
router.delete('/api/branch/:zodu_id/:branch_id', ValidateSignature, handleDeleteBranch);
router.delete('/api/company/:zodu_id', ValidateSignature, handleDeleteCompany);

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

// ── GET /api/invoice-settings/:zodu_id/:branch_id?document_type=invoice|quotation|proforma
// document_type defaults to 'invoice'; quotation/proforma are Retail-only (400 otherwise).
router.get('/api/invoice-settings/:zodu_id/:branch_id', ValidateSignature, async (req, res) => {
  try {
    const { zodu_id, branch_id } = req.params;
    const data = await authService.GetInvoiceSettings({
      user_id: req.user.user_id,
      zodu_id,
      branch_id,
      document_type: req.query.document_type,
    });
    if (data.error || data.data?.error) return res.status(400).json(data);
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

    // `document_type` is in the body (validated above) and is passed through
    // with the rest of `input`.
    const data = await authService.EditInvoiceSettings({
      user_id: req.user.user_id,
      ...input,
    });
    if (data.error || data.data?.error) return res.status(400).json(data);
    return res.status(STATUS_CODES.OK).json(data);
  } catch (error) {
    logger.error(error);
    return res.status(STATUS_CODES.INTERNAL_ERROR).json({ message: error.message });
  }
});

// ── GET /api/pos-settings/:zodu_id/:branch_id ─────────────────────────────────
router.get('/api/pos-settings/:zodu_id/:branch_id', ValidateSignature, async (req, res) => {
  try {
    const { zodu_id, branch_id } = req.params;
    const data = await authService.GetPosSettings({
      user_id: req.user.user_id,
      zodu_id,
      branch_id,
    });
    if (data.data?.error) return res.status(400).json(data);
    return res.status(STATUS_CODES.OK).json(data);
  } catch (error) {
    logger.error(error);
    return res.status(STATUS_CODES.INTERNAL_ERROR).json({ message: error.message });
  }
});

// ── PUT /api/pos-settings/:zodu_id/:branch_id ─────────────────────────────────
router.put('/api/pos-settings/:zodu_id/:branch_id', ValidateSignature, async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema.edit_pos_settings, {
      ...req.body,
      zodu_id: req.params.zodu_id,
      branch_id: req.params.branch_id,
    });
    if (errors) return res.status(STATUS_CODES.BAD_REQUEST).json({ errors });

    const data = await authService.EditPosSettings({
      user_id: req.user.user_id,
      ...input,
    });
    if (data.data?.error) return res.status(400).json(data);
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
        document_type: req.query.document_type,
      });
      if (data.error || data.data?.error) return res.status(400).json(data);
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
      document_type: req.query.document_type,
    });
    if (data.error || data.data?.error) return res.status(400).json(data);
    return res.status(STATUS_CODES.OK).json(data);
  } catch (error) {
    logger.error(error);
    return res.status(STATUS_CODES.INTERNAL_ERROR).json({ message: error.message });
  }
});

// ── Watermark + receiver signature images ─────────────────────────────────────
// Same contract as the signature routes above:
//   POST   /api/invoice-settings/:zodu_id/:branch_id/watermark            (field `watermark`)
//   DELETE /api/invoice-settings/:zodu_id/:branch_id/watermark
//   POST   /api/invoice-settings/:zodu_id/:branch_id/receiver-signature   (field `receiver_signature`)
//   DELETE /api/invoice-settings/:zodu_id/:branch_id/receiver-signature
// Both return the full updated settings row.
const INVOICE_IMAGE_ROUTES = [
  { path: 'watermark',          kind: 'watermark',          field: 'watermark',          label: 'Watermark',          maxMb: 5 },
  { path: 'receiver-signature', kind: 'receiver_signature', field: 'receiver_signature', label: 'Receiver signature', maxMb: 2 },
];

for (const { path, kind, field, label, maxMb } of INVOICE_IMAGE_ROUTES) {
  const route = `/api/invoice-settings/:zodu_id/:branch_id/${path}`;
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxMb * 1024 * 1024 },
  }).single(field);

  const handleUpload = (req, res, next) =>
    upload(req, res, (err) => {
      if (!err) return next();
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? `${label} image exceeds the ${maxMb}MB limit`
          : err.code === 'LIMIT_UNEXPECTED_FILE'
          ? `Unexpected file field — send the image as '${field}'`
          : err.message;
      return res.status(STATUS_CODES.BAD_REQUEST).json({ message });
    });

  router.post(route, ValidateSignature, handleUpload, async (req, res) => {
    try {
      if (!req.file) {
        return res.status(STATUS_CODES.BAD_REQUEST).json({ message: `No file uploaded — send the image as '${field}'` });
      }
      const { zodu_id, branch_id } = req.params;
      const data = await authService.UploadInvoiceImage({
        kind,
        user_id: req.user.user_id,
        zodu_id,
        branch_id,
        file: req.file,
        document_type: req.query.document_type,
      });
      if (data.error || data.data?.error) return res.status(400).json(data);
      return res.status(STATUS_CODES.OK).json(data);
    } catch (error) {
      logger.error(error);
      return res.status(STATUS_CODES.INTERNAL_ERROR).json({ message: error.message });
    }
  });

  router.delete(route, ValidateSignature, async (req, res) => {
    try {
      const { zodu_id, branch_id } = req.params;
      const data = await authService.DeleteInvoiceImage({
        kind,
        user_id: req.user.user_id,
        zodu_id,
        branch_id,
        document_type: req.query.document_type,
      });
      if (data.error || data.data?.error) return res.status(400).json(data);
      return res.status(STATUS_CODES.OK).json(data);
    } catch (error) {
      logger.error(error);
      return res.status(STATUS_CODES.INTERNAL_ERROR).json({ message: error.message });
    }
  });
}

module.exports = router;
