const crypto = require('crypto');
const request = require('supertest');
const bcrypt = require('bcrypt');
const argon2 = require('argon2');
const conn = require('../src/database/connection');
const { initAuth, getRedis } = require('../src/auth');
const app = require('../src/express-app');

const MODULES = ['Dashboard', 'Billing', 'Menu Items', 'Expense', 'Staff / User Management', 'Settings'];
let ready;

// Once per test file: modules, keys, an empty Redis database.
function setup() {
  ready ??= (async () => {
    await getRedis().flushdb();
    await conn.query(`INSERT INTO tbl_modules (module_name, sort_order)
      SELECT name, ord FROM unnest($1::text[]) WITH ORDINALITY AS t(name, ord)
      WHERE NOT EXISTS (SELECT 1 FROM tbl_modules m WHERE m.module_name = t.name)`, [MODULES]);
    await initAuth();
  })();
  return ready;
}

async function teardown() {
  await getRedis().quit();
  await conn.end();
}

let seq = 0;
const unique = () => `${process.pid}${Date.now() % 1e6}${seq++}`;

async function company({ branches = ['B1'] } = {}) {
  const zodu_id = `T${unique()}`.slice(0, 20);
  await conn.query('INSERT INTO tbl_business (zodu_id, business_name) VALUES ($1, $2)', [zodu_id, `Shop ${zodu_id}`]);
  for (const b of branches) {
    await conn.query('INSERT INTO tbl_branch (zodu_id, branch_id, branch_name) VALUES ($1, $2, $3)', [zodu_id, b, `Branch ${b}`]);
  }
  return zodu_id;
}

// role: { name, branch_id (null = company-wide), grants: { 'Expense': 'r' | 'rcud', ... } }
async function role(zodu_id, { name, branch_id = null, grants = {} }) {
  const { rows: [r] } = await conn.query(
    'INSERT INTO tbl_roles (zodu_id, branch_id, role_name) VALUES ($1, $2, $3) RETURNING role_id',
    [zodu_id, branch_id, name],
  );
  const all = name === 'Admin' ? Object.fromEntries(MODULES.map((m) => [m, 'rcud'])) : grants;
  for (const [module, flags] of Object.entries(all)) {
    await conn.query(
      `INSERT INTO tbl_access_control (role_id, zodu_id, module_id, can_read, can_create, can_edit, can_delete)
       SELECT $1, $2, module_id, $4, $5, $6, $7 FROM tbl_modules WHERE module_name = $3`,
      [r.role_id, zodu_id, module, flags.includes('r'), flags.includes('c'), flags.includes('u'), flags.includes('d')],
    );
  }
  return r.role_id;
}

// A user who can sign in. memberships: [{ zodu_id, primary, roles: [{ role_id, branch_id }] }]
async function user({
  password = 'correct horse battery staple', hash = 'argon2', user_type = 'super_admin',
  is_active = true, is_deleted = false, login_user = true, memberships = [],
} = {}) {
  const id = unique();
  const email = `u${id}@example.com`;
  const phone = `9${String(crypto.randomInt(0, 1e9)).padStart(9, '0')}`;
  const password_hash = hash === 'bcrypt' ? await bcrypt.hash(password, 10) : await argon2.hash(password, { type: argon2.argon2id });
  const { rows: [u] } = await conn.query(
    `INSERT INTO tbl_users (email, phone, password_hash, user_type, is_active, is_deleted, login_user)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING user_id`,
    [email, phone, password_hash, user_type, is_active, is_deleted, login_user],
  );
  for (const m of memberships) {
    await conn.query('INSERT INTO tbl_user_companies (user_id, zodu_id, is_primary) VALUES ($1, $2, $3)',
      [u.user_id, m.zodu_id, Boolean(m.primary)]);
    for (const r of m.roles || []) {
      await conn.query('INSERT INTO tbl_user_roles (user_id, role_id, zodu_id, branch_id) VALUES ($1, $2, $3, $4)',
        [u.user_id, r.role_id, m.zodu_id, r.branch_id ?? null]);
    }
  }
  return { user_id: u.user_id, email, phone, password };
}

// An owner with one company (Admin role), the usual sign-up result.
async function owner(opts = {}) {
  const zodu_id = await company({ branches: opts.branches || ['B1', 'B2'] });
  const role_id = await role(zodu_id, { name: 'Admin' });
  const u = await user({ ...opts, memberships: [{ zodu_id, primary: true, roles: [{ role_id }] }] });
  return { ...u, zodu_id, role_id };
}

const api = () => request(app);

function login(creds, { platform, password } = {}) {
  const req = api().post('/api/login');
  if (platform) req.set('X-Client-Platform', platform);
  return req.send({ email: creds.email, password: password ?? creds.password });
}

function refresh(token, { platform, cookie } = {}) {
  const req = api().post('/api/refresh-token');
  if (platform) req.set('X-Client-Platform', platform);
  if (cookie) req.set('Cookie', cookie);
  return req.send(token ? { refresh_token: token } : {});
}

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const decode = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
const sha = (s) => crypto.createHash('sha256').update(s).digest('base64url');

async function events(user_id, event) {
  const { rows } = await conn.query(
    'SELECT event, details, platform FROM tbl_security_events WHERE user_id = $1 AND ($2::text IS NULL OR event = $2) ORDER BY id',
    [user_id, event ?? null],
  );
  return rows;
}

// Security events are written without awaiting the request: give them a moment.
const settle = () => new Promise((r) => setTimeout(r, 50));

module.exports = {
  setup, teardown, company, role, user, owner, api, login, refresh, bearer, decode, sha, events, settle, conn, app,
};
