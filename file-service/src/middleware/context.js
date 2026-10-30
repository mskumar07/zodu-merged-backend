// Who is calling, for which company and branch. The one place that decides it:
// when tokens gain branch_id / company switching (JWT upgrade), only
// getRequestContext changes.
//
//   userId, zoduId  only from the verified token
//   branchId        X-Branch-Id header, checked against tbl_user_roles via auth-service
//
// zodu_id / branch_id / user_id are never read from the body, query or path.

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const {
  AuthenticationError, ForbiddenError, NotFoundError, ValidationError,
} = require('../utils/error/errors');
const { getModule } = require('../storage/modules');

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const BRANCH_ID = /^[A-Za-z0-9-][A-Za-z0-9_-]{0,63}$/;   // "_" prefix is reserved for _shared

const ACTIONS = { read: 'read', create: 'create', delete: 'delete' };

function createContext({ appSecret, authClient }) {
  function verifyToken(req) {
    const header = req.get('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
    if (!token) throw AuthenticationError('Authorization token missing');
    let payload;
    try {
      // Same check as auth-service's ValidateSignature, pinned to HS256.
      payload = jwt.verify(token, appSecret, { algorithms: ['HS256'] });
    } catch {
      throw AuthenticationError('Unauthorized: Invalid token');
    }
    if (typeof payload.user_id !== 'string' || !SAFE_ID.test(String(payload.zodu_id || ''))) {
      throw AuthenticationError('Unauthorized: Invalid token');
    }
    return payload;
  }

  async function getRequestContext(req) {
    const payload = verifyToken(req);
    const userId = payload.user_id;
    const zoduId = payload.zodu_id;

    const branchHeader = req.get('X-Branch-Id');
    let branchId = null;
    if (branchHeader !== undefined && branchHeader !== '') {
      if (!BRANCH_ID.test(branchHeader)) throw ValidationError('Invalid X-Branch-Id header');
      branchId = branchHeader;
    }

    const access = await authClient.getAccess({ userId, zoduId, branchId });
    if (!access?.is_member) throw ForbiddenError('You no longer have access to this company');
    // A branch the user isn't assigned to looks exactly like one that doesn't exist.
    if (branchId && !(access.branch_exists && access.has_branch_access)) throw NotFoundError('Not found');

    return { userId, zoduId, branchId, access };
  }

  // Express middleware: sets req.ctx.
  async function requireUser(req, _res, next) {
    try {
      req.ctx = { ...(await getRequestContext(req)), ip: req.ip };
      next();
    } catch (err) {
      next(err);
    }
  }

  return { getRequestContext, requireUser };
}

// The module's tbl_modules permission. Admin bypasses it, but only inside its
// own company: ctx.access was looked up for the token's zoduId.
function hasPermission(ctx, moduleName, action) {
  if (ctx.internal) return true;   // the calling service already authorised the user
  const mod = getModule(moduleName);
  if (ctx.access?.is_admin) return true;
  return Boolean(ctx.access?.permissions?.[mod.permission]?.[ACTIONS[action]]);
}

function assertPermission(ctx, moduleName, action) {
  if (!hasPermission(ctx, moduleName, action)) {
    throw ForbiddenError(`You do not have ${action} permission for ${getModule(moduleName).permission}`);
  }
}

// /internal/*: one token per calling service in X-Internal-Token. The caller
// passes the user context it has already verified in X-User-Id / X-Zodu-Id /
// X-Branch-Id, and the end user's address in X-Client-Ip (rate limits, audit).
// X-Zodu-Id may be missing only for staged uploads (upload, discard); every
// other operation needs a tenant and fails without one.
function createRequireInternal(tokens) {
  const hashed = Object.entries(tokens).map(([name, token]) => [name, sha256(token)]);

  return function requireInternal(req, _res, next) {
    const presented = req.get('X-Internal-Token');
    if (!presented) return next(AuthenticationError('Internal token missing'));
    const digest = sha256(presented);
    // Compare against every token so timing doesn't reveal which one matched.
    let caller = null;
    for (const [name, h] of hashed) {
      if (crypto.timingSafeEqual(digest, h) && !caller) caller = name;
    }
    if (!caller) return next(AuthenticationError('Invalid internal token'));

    const zoduId = req.get('X-Zodu-Id') || null;
    const branchId = req.get('X-Branch-Id') || null;
    const userId = req.get('X-User-Id') || null;
    const clientIp = req.get('X-Client-Ip') || null;
    // Anonymous staging: uploading to the staging area and discarding unclaimed staged files.
    const staging = (req.path === '/upload' && req.query.module === 'uploads') || req.path === '/discard';
    if (zoduId ? !SAFE_ID.test(zoduId) : !staging) return next(ValidationError('X-Zodu-Id header is required'));
    if (branchId && !BRANCH_ID.test(branchId)) return next(ValidationError('Invalid X-Branch-Id header'));
    if (userId && !/^[A-Za-z0-9_.:@-]{1,100}$/.test(userId)) return next(ValidationError('Invalid X-User-Id header'));
    if (clientIp && !/^[0-9A-Fa-f:.]{2,45}$/.test(clientIp)) return next(ValidationError('Invalid X-Client-Ip header'));

    req.ctx = { userId, zoduId, branchId, caller, internal: true, ip: clientIp || req.ip };
    next();
  };
}

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest();

module.exports = { createContext, createRequireInternal, hasPermission, assertPermission };
