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

function createAuthenticate({ verifier, respond = defaultRespond, ...verifierOptions } = {}) {
  const v = verifier ?? createAccessTokenVerifier(verifierOptions);

  function authenticate(req, res, next) {
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
