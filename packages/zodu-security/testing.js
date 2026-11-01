// Test kit for the services: a stand-in auth-service (JWKS + the branch-access
// check) and real ES256 access tokens, so tests run the real middleware.
//
//   // jest globalSetup
//   module.exports = () => require('@zodu/security/testing').startFakeAuth();
//   // tests
//   const { token, USERS } = require('@zodu/security/testing');
//   request(app).get('/api/x').set('Authorization', `Bearer ${token(USERS.cashier)}`)
//
// The fake world (USERS / COMPANIES):
//   Z001 branches B1, B2, B3 · Z002 branch B1
//   owner     Admin of Z001 (every branch)
//   manager   Manager of Z001, company-wide, every module read/create/edit (no delete)
//   cashier   Cashier of Z001 B1 only: billing + expense read/create, attendance read own
//   b2staff   Staff of Z001 B2 only: same as cashier, in B2
//   other     Admin of Z002
// startFakeAuth() sets AUTH_SERVICE_URL (and AUTH_JWKS_URL) and the signing key in
// process.env; run jest --runInBand so the tests see them.

const crypto = require('crypto');
const http = require('http');

const MODULES = ['Dashboard', 'Billing', 'Menu Items', 'Purchase', 'Sales History', 'Expense', 'Inventory',
  'Customer Management', 'Staff / User Management', 'Attendance', 'Reports', 'Checklist / Tasklist', 'Settings'];
const all = (flags) => Object.fromEntries(MODULES.map((m) => [m, flags]));
const RCU = { read: true, create: true, edit: true, delete: false };
const RC = { read: true, create: true, edit: false, delete: false };

const USERS = {
  owner:   { userId: '11111111-1111-4111-8111-111111111111', zoduId: 'Z001', branchId: 'B1', role: 'Admin', branches: null, permissions: all({ read: true, create: true, edit: true, delete: true }) },
  manager: { userId: '22222222-2222-4222-8222-222222222222', zoduId: 'Z001', branchId: 'B1', role: 'Manager', branches: null, permissions: all(RCU) },
  cashier: { userId: '33333333-3333-4333-8333-333333333333', zoduId: 'Z001', branchId: 'B1', role: 'Cashier', branches: ['B1'], permissions: { Billing: RC, Expense: RC } },
  b2staff: { userId: '44444444-4444-4444-8444-444444444444', zoduId: 'Z001', branchId: 'B2', role: 'Staff', branches: ['B2'], permissions: { Billing: RC, Expense: RC } },
  other:   { userId: '55555555-5555-4555-8555-555555555555', zoduId: 'Z002', branchId: 'B1', role: 'Admin', branches: null, permissions: all({ read: true, create: true, edit: true, delete: true }) },
};
const COMPANIES = { Z001: ['B1', 'B2', 'B3'], Z002: ['B1'] };

const SLUG = {
  'Dashboard': 'dashboard', 'Billing': 'billing', 'Menu Items': 'menu', 'Purchase': 'purchase', 'Sales History': 'sales',
  'Expense': 'expense', 'Inventory': 'inventory', 'Customer Management': 'customer', 'Staff / User Management': 'employee',
  'Attendance': 'attendance', 'Reports': 'report', 'Checklist / Tasklist': 'checklist', 'Settings': 'settings',
};
const permsOf = (u) => Object.entries(u.permissions).flatMap(([m, p]) =>
  ['read', 'create', 'edit', 'delete'].filter((a) => p[a]).map((a) => `${SLUG[m]}:${a}`)).sort();

function access({ user_id, zodu_id, branch_id }) {
  const u = Object.values(USERS).find((x) => x.userId === user_id);
  const member = Boolean(u && u.zoduId === zodu_id);
  const exists = !branch_id || (COMPANIES[zodu_id] || []).includes(branch_id);
  const hasBranch = member && (!branch_id || u.branches === null || u.branches.includes(branch_id));
  return {
    is_member: member, branch_exists: exists, has_branch_access: hasBranch,
    is_admin: member && u.role === 'Admin', permissions: member ? u.permissions : {},
  };
}

async function startFakeAuth() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'ES256', use: 'sig' };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/.well-known/jwks.json') return res.end(JSON.stringify({ keys: [jwk] }));
    if (url.pathname === '/internal/user-branch-access') {
      if (!req.headers['x-internal-token']) { res.statusCode = 401; return res.end('{}'); }
      return res.end(JSON.stringify({ success: true, data: access(Object.fromEntries(url.searchParams)) }));
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  server.unref();
  const url = `http://127.0.0.1:${server.address().port}`;
  process.env.AUTH_SERVICE_URL = url;
  process.env.AUTH_JWKS_URL = `${url}/.well-known/jwks.json`;
  process.env.ZODU_TEST_SIGNING_KEY = privateKey.export({ format: 'pem', type: 'pkcs8' });
  process.env.INTERNAL_TOKEN ||= 't'.repeat(40);
  return server;
}

// A token like auth-service issues. overrides: claims to change (bid, zid, perms, exp, ...).
function token(user = USERS.owner, overrides = {}) {
  const key = process.env.ZODU_TEST_SIGNING_KEY;
  if (!key) throw new Error('startFakeAuth() has not run (jest globalSetup, --runInBand)');
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'ES256', typ: 'at+jwt', kid: 'test-key' });
  const body = b64({
    sub: user.userId, zid: user.zoduId, bid: user.branchId, role: user.role, perms: permsOf(user),
    utype: user.role === 'Admin' ? 'super_admin' : 'employee', plt: 'web',
    sid: crypto.randomUUID(), jti: crypto.randomUUID(),
    iss: 'zodu-auth', aud: 'zodu-api', iat: now, nbf: now, exp: now + 900, ...overrides,
  });
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${sig.toString('base64url')}`;
}

const bearer = (user, overrides) => ({ Authorization: `Bearer ${token(user, overrides)}` });

module.exports = { startFakeAuth, token, bearer, USERS, COMPANIES, permsOf };
