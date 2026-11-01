// Who may call each customer route (@zodu/security createRoutePolicy). The
// first matching rule wins; a route with no rule is refused.
// Permissions: docs/security/permissions-matrix.md.
//
// company:* and branch:* (and role:edit) are in no tbl_modules row yet, so only
// the company's Admin role has them (packages/zodu-security permissions.js).

module.exports = [
  // ── Service-to-service: requireInternal() in express-app.js checks the service token ──
  { path: '/internal', public: true },

  // ── Token endpoints ──
  { method: 'POST', path: /^\/api\/(create-account|login|refresh-token|logout)$/, public: true },
  // Its own authenticate: the body names the company to switch to, which the
  // session service checks against the user's memberships.
  { method: 'POST', path: '/api/switch-context', public: true },
  { method: 'POST', path: '/api/logout-all', authenticated: true },
  { path: '/api/sessions', authenticated: true },
  { method: 'GET', path: '/api/auth-check', authenticated: true },

  // ── The signed-in user's own companies and access ──
  { method: 'GET', path: '/api/my-companies', authenticated: true },
  // Its own authenticate: the caller's own role rows in any of their companies
  // (older app builds ask for the company they show, not the token's).
  { method: 'GET', path: '/api/role-access', public: true },
  // A new company: the user becomes its Admin.
  { method: 'POST', path: /^\/api\/(company\/add|create-company)$/, authenticated: true },

  // ── Company and branches ──
  { method: ['PUT', 'POST'], path: /^\/api\/company\/(edit\/[^/]+|[^/]+\/logo)$/, perm: 'company:edit' },
  { method: 'DELETE', path: /^\/api\/company\/[^/]+\/logo$/, perm: 'company:edit' },
  { method: 'DELETE', path: '/api/company', perm: 'company:delete' },
  { method: 'POST', path: '/api/branch/add', perm: 'branch:create' },
  { method: 'PUT', path: '/api/branch/edit', perm: 'branch:edit' },
  { method: 'DELETE', path: '/api/branch', perm: 'branch:delete' },

  // ── Settings: every member reads them (bills print with them) ──
  { method: 'GET', path: /^\/api\/(settings|invoice-settings|pos-settings)\//, authenticated: true },
  { method: ['PUT', 'POST', 'DELETE'], path: /^\/api\/(invoice-settings|pos-settings)\//, perm: 'settings:edit' },

  // ── Roles: staff managers pick a role when they add someone ──
  { method: 'GET', path: '/api/modules', authenticated: true },
  { method: 'GET', path: '/api/roles', any: ['role:read', 'employee:read', 'employee:create', 'employee:edit'] },
  { method: ['POST', 'PUT', 'DELETE'], path: '/api/roles', perm: 'role:edit' },
];
