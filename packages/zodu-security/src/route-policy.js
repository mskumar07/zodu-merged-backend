// One table per service saying who may call each route. Anything the table
// doesn't cover is refused (403), so a new route is closed until someone
// decides its permission.
//
//   const policy = createRoutePolicy([
//     { path: '/api/health', public: true },
//     { path: '/api/attendance/my', authenticated: true },     // checked in the handler
//     ...crud('/api/employees', 'employee'),                    // GET read, POST create, PUT/PATCH edit, DELETE delete
//     { method: 'GET', path: /^\/api\/reports\/gst/, perm: ['report:read', 'gst:export'] },
//   ], { authenticate, tenantGuard, respond });
//   app.use(policy.middleware);
//
// The first matching rule wins. path: a string prefix (whole segments) or a RegExp,
// matched against req.path. Rules double as the permissions matrix (policy.rules).

const { OWNER_ROLE } = require('./permissions');

const ACTION_BY_METHOD = { GET: 'read', HEAD: 'read', POST: 'create', PUT: 'edit', PATCH: 'edit', DELETE: 'delete' };

const defaultRespond = (req, res, status, message) => res.status(status).json({ success: false, message });

function matchesPath(rule, path) {
  if (rule.path instanceof RegExp) return rule.path.test(path);
  const p = rule.path.replace(/\/+$/, '');
  return path === p || path.startsWith(`${p}/`);
}

function matchesMethod(rule, method) {
  if (!rule.method) return true;
  const list = Array.isArray(rule.method) ? rule.method : [rule.method];
  return list.includes(method) || (method === 'HEAD' && list.includes('GET'));
}

// The usual mapping for a resource: method → <slug>:<action>.
function crud(path, slug, extra = {}) {
  return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => ({
    method, path, perm: `${slug}:${ACTION_BY_METHOD[method]}`, ...extra,
  }));
}

function createRoutePolicy(rules, {
  authenticate, tenantGuard, respond = defaultRespond, onDenied = () => {}, sampleDenied = 0.1,
} = {}) {
  const find = (req) => rules.find((r) => matchesMethod(r, req.method) && matchesPath(r, req.path));

  const allowed = (rule, auth) => {
    if (rule.authenticated) return true;
    if (auth.role === OWNER_ROLE) return true;   // inside the token's company only (tenantGuard)
    const perms = Array.isArray(rule.perm) ? rule.perm : [rule.perm];
    return perms.every((p) => auth.perms.includes(p));
  };

  function middleware(req, res, next) {
    if (req.method === 'OPTIONS') return next();
    const rule = find(req);
    if (!rule) {
      onDenied(req, { reason: 'no_rule' });
      return respond(req, res, 403, 'Permission denied');
    }
    if (rule.public) return next();
    authenticate(req, res, () => tenantGuard(req, res, () => {
      if (!allowed(rule, req.auth)) {
        if (Math.random() < sampleDenied) onDenied(req, { reason: 'permission', required: rule.perm });
        return respond(req, res, 403, 'Permission denied');
      }
      req.routeRule = rule;
      next();
    }));
  }

  return { middleware, rules, find };
}

module.exports = { createRoutePolicy, crud, ACTION_BY_METHOD };
