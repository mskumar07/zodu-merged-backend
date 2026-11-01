// Who is calling, for which company and branch. The one place that decides it.
//
//   userId, zoduId, branchId   only from the verified access token (ES256, via
//                              auth-service's JWKS); a user changes company or
//                              branch with auth-service's /api/switch-context
//
// The X-Branch-Id header is not read on user routes, and zodu_id / branch_id /
// user_id are never read from the body, query or path. Membership and module
// permissions are still checked live with auth-service, so a role removed in
// the last 15 minutes takes effect here at once.

const { createInternalAuth } = require('@zodu/security');
const {
  AuthenticationError, ForbiddenError, NotFoundError, UnavailableError, ValidationError,
} = require('../utils/error/errors');
const { getModule } = require('../storage/modules');

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const BRANCH_ID = /^[A-Za-z0-9-][A-Za-z0-9_-]{0,63}$/;   // "_" prefix is reserved for _shared
const BEARER = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/;

const ACTIONS = { read: 'read', create: 'create', delete: 'delete' };

// verifier: createAccessTokenVerifier() from @zodu/security
function createContext({ verifier, authClient }) {
  async function verifyToken(req) {
    const match = BEARER.exec(req.get('Authorization') || '');
    if (!match) throw AuthenticationError('Authorization token missing');
    try {
      return await verifier.verify(match[1]);
    } catch (err) {
      if (err.status === 503) throw UnavailableError('Authentication is temporarily unavailable');
      throw AuthenticationError('Unauthorized: Invalid token');
    }
  }

  async function getRequestContext(req) {
    const { userId, zoduId, branchId } = await verifyToken(req);
    if (branchId && !BRANCH_ID.test(branchId)) throw AuthenticationError('Unauthorized: Invalid token');

    const access = await authClient.getAccess({ userId, zoduId, branchId });
    if (!access?.is_member) throw ForbiddenError('You no longer have access to this company');
    // A branch the user lost access to looks exactly like one that doesn't exist.
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
  const { identify } = createInternalAuth({ tokens });

  return function requireInternal(req, _res, next) {
    if (!req.get('X-Internal-Token')) return next(AuthenticationError('Internal token missing'));
    const caller = identify(req);
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

module.exports = { createContext, createRequireInternal, hasPermission, assertPermission };
