// Everything a customer-facing service needs, wired once:
//
//   const security = createServiceSecurity({ rules, respond, logger });
//   app.use(express.json());
//   app.use(security.middleware);              // limits, auth, tenant, route policy
//   security.protectParams(router);            // in each controller with :zodu_id / :branch_id
//   router.post('/x', upload.single('file'), security.tenantBody, handler);
//
// respond(req, res, status, message) keeps the service's error body.

const { createAccessTokenVerifier, jwksUrlFromEnv } = require('./access-token');
const { createAuthenticate } = require('./authenticate');
const { createTenantGuard, createAccessClient } = require('./tenant');
const { createRoutePolicy } = require('./route-policy');

const ORDER = /^(asc|desc)$/i;
const FIELD = /^[A-Za-z_][A-Za-z0-9_.]{0,63}$/;
const LIMIT_KEYS = ['limit', 'page_size', 'pageSize', 'per_page', 'size'];
const ORDER_KEYS = ['order', 'sort_order', 'sortOrder', 'order_dir', 'direction'];
const FIELD_KEYS = ['sort', 'sort_by', 'sortBy', 'order_by', 'orderBy'];

// Caps page sizes and refuses sort values that aren't a direction or a plain
// column name (they end up next to ORDER BY in several repos).
function listQueryLimits({ maxLimit = 500, respond }) {
  return function listLimits(req, res, next) {
    const q = req.query;
    if (!q || !Object.keys(q).length) return next();
    const fixed = { ...q };
    for (const k of LIMIT_KEYS) {
      if (fixed[k] === undefined) continue;
      const n = Number.parseInt(fixed[k], 10);
      fixed[k] = String(Number.isFinite(n) && n > 0 ? Math.min(n, maxLimit) : Math.min(50, maxLimit));
    }
    if (fixed.page !== undefined) {
      const n = Number.parseInt(fixed.page, 10);
      fixed.page = String(Number.isFinite(n) && n > 0 ? Math.min(n, 1_000_000) : 1);
    }
    for (const k of ORDER_KEYS) {
      if (fixed[k] !== undefined && !ORDER.test(String(fixed[k]))) return respond(req, res, 400, `Invalid ${k}`);
    }
    for (const k of FIELD_KEYS) {
      if (fixed[k] === undefined) continue;
      const v = String(fixed[k]);
      // "name" / "created_at DESC" / "-created_at"
      const [field, dir, extra] = v.replace(/^-/, '').trim().split(/\s+/);
      if (extra !== undefined || !FIELD.test(field) || (dir !== undefined && !ORDER.test(dir))) {
        return respond(req, res, 400, `Invalid ${k}`);
      }
    }
    Object.defineProperty(req, 'query', { value: fixed, writable: true, configurable: true, enumerable: true });
    next();
  };
}

function createServiceSecurity({
  rules,
  respond = (req, res, status, message) => res.status(status).json({ success: false, message }),
  logger = console,
  verifier,
  accessClient,
  maxLimit,
  redis,
  // auth-service on the internal network (keys + access checks); default AUTH_SERVICE_URL
  authServiceUrl = process.env.AUTH_SERVICE_URL,
} = {}) {
  const event = (req, name, details) => {
    const log = logger.warn ? logger.warn.bind(logger) : console.warn;
    log({
      security_event: name,
      user_id: req.auth?.userId,
      zodu_id: req.auth?.zoduId,
      method: req.method,
      path: req.path,
      ip: req.ip,
      ...details,
    }, `security: ${name}`);
  };

  const v = verifier ?? createAccessTokenVerifier({
    jwksUrl: jwksUrlFromEnv({ ...process.env, AUTH_SERVICE_URL: authServiceUrl }),
    redis,
    onError: (err) => event({}, 'auth_keys_unavailable', { error: err.message }),
  });
  const { authenticate } = createAuthenticate({ verifier: v, respond });
  const access = accessClient ?? createAccessClient({ baseUrl: authServiceUrl });
  const tenant = createTenantGuard({ accessClient: access, respond, onEvent: event });
  const policy = createRoutePolicy(rules, {
    authenticate,
    tenantGuard: tenant.tenantGuard,
    respond,
    onDenied: (req, details) => event(req, 'permission_denied', details),
  });
  const limits = listQueryLimits({ maxLimit, respond });

  return {
    middleware: [limits, policy.middleware],
    authenticate,
    tenantBody: tenant.tenantBody,
    tenantParam: tenant.tenantParam,
    protectParams: tenant.protectParams,
    policy,
    verifier: v,
  };
}

module.exports = { createServiceSecurity, listQueryLimits };
