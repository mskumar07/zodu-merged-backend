// Which company and branch a request acts on. The company is always the
// token's (zid); nothing in the request can change it. Runs after authenticate().
//
//   app.use('/api', authenticate, tenantGuard);       query + JSON body
//   router.param('zodu_id', tenantParam);             path params (one line per router)
//   router.param('branch_id', tenantParam);
//   router.post('/x', upload.single('file'), tenantBody, handler)   multipart bodies
//
// Handlers read req.tenant = { zoduId, branchId } (or the zodu_id / branch_id
// they always read: those now hold the checked values).
//
//   zodu_id    any value other than the token's → 404 (cross_tenant_attempt logged)
//   branch_id  missing: the token's branch (bid) is filled in where a branch_id
//              is read; another branch: allowed only while allowRequestedBranch
//              is on (old app builds that don't call switch-context yet) and
//              auth-service confirms the user may use it; the request then gets
//              that branch's permissions. Otherwise 404.

const { OWNER_ROLE, permsFromAccessRows } = require('./permissions');

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ZODU_KEYS = ['zodu_id', 'zoduId'];
const BRANCH_KEYS = ['branch_id', 'branchId'];

const defaultRespond = (req, res, status, message) => res.status(status).json({ success: false, message });

// Express 5 recomputes req.query on every access; replace it with a fixed object.
function setQuery(req, query) {
  Object.defineProperty(req, 'query', { value: query, writable: true, configurable: true, enumerable: true });
}

const first = (obj, keys) => {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  return undefined;
};

// accessClient  createAccessClient() (auth-service /internal/user-branch-access)
// allowRequestedBranch  default: env AUTH_ALLOW_REQUESTED_BRANCH !== 'false'
// onEvent(req, event, details)  security events (cross_tenant_attempt, branch_denied)
function createTenantGuard({
  accessClient,
  allowRequestedBranch = process.env.AUTH_ALLOW_REQUESTED_BRANCH !== 'false',
  respond = defaultRespond,
  onEvent = () => {},
} = {}) {
  class Refused extends Error {}

  // The branch this request may use, or throws Refused.
  async function resolveBranch(req, requested) {
    const auth = req.auth;
    if (requested === undefined) return req.tenant?.branchId ?? auth.branchId ?? null;
    const branch = String(requested);
    if (branch === req.tenant?.branchId || branch === auth.branchId) return branch;
    if (!SAFE_ID.test(branch) || !allowRequestedBranch || !accessClient) {
      onEvent(req, 'branch_denied', { requested_branch_id: branch.slice(0, 64), reason: 'not_token_branch' });
      throw new Refused();
    }
    const access = await accessClient.getAccess({ userId: auth.userId, zoduId: auth.zoduId, branchId: branch });
    if (!access?.is_member || !access.branch_exists || !access.has_branch_access) {
      onEvent(req, 'branch_denied', { requested_branch_id: branch });
      throw new Refused();
    }
    // That branch's permissions, not the token branch's.
    if (!(access.is_admin || auth.role === OWNER_ROLE)) {
      const rows = Object.entries(access.permissions || {}).map(([module_name, p]) => ({
        module_name, can_read: p.read, can_create: p.create, can_edit: p.edit, can_delete: p.delete,
      }));
      req.auth = { ...auth, perms: permsFromAccessRows(rows) };
    }
    return branch;
  }

  function checkCompany(req, value) {
    if (value === undefined) return;
    if (String(value) !== req.auth.zoduId) {
      onEvent(req, 'cross_tenant_attempt', { requested_zodu_id: String(value).slice(0, 64) });
      throw new Refused();
    }
  }

  // Rewrites zodu_id / branch_id in one object (query or body) to the checked values.
  async function fixObject(req, obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    checkCompany(req, first(obj, ZODU_KEYS));
    const branch = await resolveBranch(req, first(obj, BRANCH_KEYS));
    req.tenant = { zoduId: req.auth.zoduId, branchId: branch };
    // Only values the client sent: an explicit null / '' (company level) stays.
    const sent = (k) => obj[k] !== undefined && obj[k] !== null && obj[k] !== '';
    for (const k of ZODU_KEYS) if (sent(k)) obj[k] = req.auth.zoduId;
    for (const k of BRANCH_KEYS) if (sent(k)) obj[k] = branch;
    return obj;
  }

  const fail = (req, res, err, next) => {
    if (err instanceof Refused) return respond(req, res, 404, 'Not found');
    if (err.status === 503) return respond(req, res, 503, 'Access check unavailable, try again');
    return next(err);
  };

  // App-level: query and (already parsed) JSON / urlencoded body.
  async function tenantGuard(req, res, next) {
    if (!req.auth) return respond(req, res, 401, 'Authorization token missing');
    try {
      req.tenant = { zoduId: req.auth.zoduId, branchId: req.auth.branchId ?? null };
      const query = { ...req.query };
      await fixObject(req, query);
      setQuery(req, query);
      if (req.body && typeof req.body === 'object') await fixObject(req, req.body);
      next();
    } catch (err) {
      fail(req, res, err, next);
    }
  }

  // After multer: the multipart fields.
  async function tenantBody(req, res, next) {
    if (!req.auth) return respond(req, res, 401, 'Authorization token missing');
    try {
      await fixObject(req, req.body);
      next();
    } catch (err) {
      fail(req, res, err, next);
    }
  }

  // router.param('zodu_id' | 'branch_id' | 'zoduId' | 'branchId', tenantParam)
  async function tenantParam(req, res, next, value, name) {
    if (!req.auth) return respond(req, res, 401, 'Authorization token missing');
    try {
      if (ZODU_KEYS.includes(name)) {
        checkCompany(req, value);
      } else {
        const branch = await resolveBranch(req, value);
        req.tenant = { zoduId: req.auth.zoduId, branchId: branch };
      }
      next();
    } catch (err) {
      fail(req, res, err, next);
    }
  }

  // Attach tenantParam to every tenant param name of a router.
  function protectParams(router) {
    for (const name of [...ZODU_KEYS, ...BRANCH_KEYS]) router.param(name, tenantParam);
    return router;
  }

  return { tenantGuard, tenantBody, tenantParam, protectParams };
}

// Cached client for auth-service's /internal/user-branch-access (60s by default:
// a removed role takes effect within a minute).
//   → { is_member, branch_exists, has_branch_access, is_admin, permissions: { [module_name]: {read, create, edit, delete} } }
function createAccessClient({
  baseUrl = process.env.AUTH_SERVICE_URL,
  token = process.env.INTERNAL_TOKEN,
  ttlMs = Number(process.env.ACCESS_CACHE_TTL_MS) || 60_000,
  timeoutMs = 3000,
  maxEntries = 10_000,
  fetchImpl = globalThis.fetch,
} = {}) {
  const cache = new Map();

  async function fetchAccess({ userId, zoduId, branchId }) {
    const q = new URLSearchParams({ user_id: userId, zodu_id: zoduId, ...(branchId && { branch_id: branchId }) });
    const res = await fetchImpl(`${String(baseUrl).replace(/\/+$/, '')}/internal/user-branch-access?${q}`, {
      headers: { 'X-Internal-Token': token || '' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const err = new Error(`access check failed: ${res.status}`);
      err.status = 503;
      throw err;
    }
    return (await res.json()).data;
  }

  async function getAccess(q) {
    const key = `${q.userId}|${q.zoduId}|${q.branchId || ''}`;
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    let value;
    try {
      value = await fetchAccess(q);
    } catch (err) {
      const e = new Error('Access check unavailable, try again');
      e.status = 503;
      e.cause = err;
      throw e;
    }
    if (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
    cache.set(key, { value, expires: Date.now() + ttlMs });
    return value;
  }

  return { getAccess, clear: () => cache.clear() };
}

module.exports = { createTenantGuard, createAccessClient };
