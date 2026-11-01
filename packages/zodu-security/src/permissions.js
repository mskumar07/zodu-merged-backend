// Permission names carried in the access token (perms[]) and checked by
// requirePermission(): '<module_slug>:<read|create|edit|delete>'.
//
// They come from the existing model: tbl_access_control (can_read / can_create /
// can_edit / can_delete per module_id) joined with tbl_modules. MODULE_SLUGS maps
// the tbl_modules.module_name values (UAT, Oct 2026) to stable slugs, so renaming
// a module in the UI doesn't change a permission name. A module that isn't listed
// gets a generated slug (lowercase, non-alphanumerics → '_') until it is added here.

const MODULE_SLUGS = {
  'Dashboard': 'dashboard',
  'Billing': 'billing',
  'Menu Items': 'menu',
  'Purchase': 'purchase',
  'Sales History': 'sales',
  'Expense': 'expense',
  'Inventory': 'inventory',
  'Customer Management': 'customer',
  'Staff / User Management': 'employee',
  'Attendance': 'attendance',
  'Reports': 'report',
  'Checklist / Tasklist': 'checklist',
  'Settings': 'settings',
};

const ACTIONS = ['read', 'create', 'edit', 'delete'];

// Actions no tbl_modules row covers yet. Until they are added to tbl_modules
// (docs/security/permissions.md) only the owner (Admin role) has them.
const EXTRA_PERMISSIONS = [
  'company:edit',
  'company:delete',
  'branch:create',
  'branch:edit',
  'branch:delete',
  'role:read',
  'role:edit',
  'gst:export',
];

// The account created at sign-up gets the company's 'Admin' role (with every
// module granted). Only that role bypasses permission checks, and only inside
// the token's own company (zid): a token is issued for one company at a time.
const OWNER_ROLE = 'Admin';

function slugForModule(name) {
  if (MODULE_SLUGS[name]) return MODULE_SLUGS[name];
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'module';
}

// Rows of { module_name, can_read, can_create, can_edit, can_delete }, possibly
// several per module (several roles): any grant wins.
function permsFromAccessRows(rows = []) {
  const perms = new Set();
  for (const row of rows) {
    const slug = slugForModule(row.module_name);
    for (const action of ACTIONS) {
      if (row[`can_${action}`]) perms.add(`${slug}:${action}`);
    }
  }
  return [...perms].sort();
}

module.exports = { MODULE_SLUGS, ACTIONS, EXTRA_PERMISSIONS, OWNER_ROLE, slugForModule, permsFromAccessRows };
