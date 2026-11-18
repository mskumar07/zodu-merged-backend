// Express middleware on top of the access-token verifier.
//
//   const { authenticate } = createAuthenticate({ redis, respond });
//   router.get('/api/x', authenticate, requirePermission('expense:read'), handler);
//
// The token is read from 'Authorization: Bearer' only, never from the query
// string. Failures: 401 with WWW-Authenticate, 503 if auth-service's keys
// can't be fetched. `respond` keeps each service's own error body.

const { createAccessTokenVerifier } = require('./access-token');
const { OWNER_ROLE } = require('./permissions');

const defaultRespond = (req, res, status, message) => res.status(status).json({ success: false, message });

const BEARER = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/;

// ── DEV ONLY: AUTH_DISABLED=true ─────────────────────────────────────────────
// Initial build / local development: the JWT access token is NOT checked. The
// caller is trusted to name itself with X-User-Id / X-Zodu-Id / X-Branch-Id
// (/ X-User-Type) and acts as the company Owner. Never works when
// NODE_ENV=production. Remove AUTH_DISABLED from the .env files (and
// VITE_AUTH_DISABLED from the frontend's) to go back to the JWT checks below.
const SAFE_DEV_ID = /^[A-Za-z0-9_-]{1,64}$/;
const authDisabled = () => process.env.AUTH_DISABLED === 'true' && process.env.NODE_ENV !== 'production';
if (authDisabled()) {
  console.warn('[zodu-security] AUTH_DISABLED=true: access tokens are NOT verified. Development only.');
}

function devAuth(req) {
  const id = (name) => {
    const v = req.get(name);
    return v && SAFE_DEV_ID.test(v) ? v : null;
  };
  return {
    userId: id('X-User-Id'),
    zoduId: id('X-Zodu-Id'),
    branchId: id('X-Branch-Id'),
    role: OWNER_ROLE,
    perms: [],
    userType: id('X-User-Type'),
    platform: 'web',
    sessionId: 'dev-auth-disabled',
    tokenId: 'dev-auth-disabled',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  };
}

function createAuthenticate({ verifier, respond = defaultRespond, ...verifierOptions } = {}) {
  // Not built while AUTH_DISABLED: no JWKS / key set is needed to run in dev.
  const v = verifier ?? (authDisabled() ? undefined : createAccessTokenVerifier(verifierOptions));

  function authenticate(req, res, next) {
    if (authDisabled()) {
      const auth = devAuth(req);
      if (!auth.userId) return respond(req, res, 401, 'X-User-Id header missing (AUTH_DISABLED)');
      req.auth = auth;
      return next();
    }
    const match = BEARER.exec(req.get('Authorization') || '');
    if (!match) {
      res.set('WWW-Authenticate', 'Bearer');
      return respond(req, res, 401, 'Authorization token missing');
    }
    v.verify(match[1]).then(
      (auth) => {
        req.auth = auth;
        next();
      },
      (err) => {
        const status = err.status === 503 ? 503 : 401;
        if (status === 401) res.set('WWW-Authenticate', 'Bearer error="invalid_token"');
        respond(req, res, status, err.status ? err.message : 'Invalid token');
      },
    );
  }

  return { authenticate, verifier: v };
}

// requirePermission('purchase:create')       the token must carry it
// requirePermission('report:read', 'gst:export')   all of them
// requireRole('Admin')                         one of these roles
// allowAuthenticated()                         any signed-in user, stated on purpose
//
// The owner (OWNER_ROLE) passes every permission check, only inside the token's
// company: services take zodu_id from req.auth, never from the request.
function createAuthorize({ respond = defaultRespond } = {}) {
  const guard = (check, label) => {
    const mw = (req, res, next) => {
      if (!req.auth) return respond(req, res, 401, 'Authorization token missing');
      if (!check(req.auth)) return respond(req, res, 403, 'Permission denied');
      next();
    };
    mw.authorization = label;   // read by the route inventory (permissions matrix)
    return mw;
  };

  const requirePermission = (...perms) => guard(
    (auth) => auth.role === OWNER_ROLE || perms.every((p) => auth.perms.includes(p)),
    `perm:${perms.join('+')}`,
  );
  const requireRole = (...roles) => guard((auth) => roles.includes(auth.role), `role:${roles.join('|')}`);
  const allowAuthenticated = () => guard(() => true, 'authenticated');

  return { requirePermission, requireRole, allowAuthenticated };
}

module.exports = { createAuthenticate, createAuthorize, ...createAuthorize() };
