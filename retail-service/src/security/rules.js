// Who may call each customer route (@zodu/security createRoutePolicy). The
// first matching rule wins; a route with no rule is refused.
// Permissions: docs/security/permissions-matrix.md.
//
// perm: every one of them · any: one of them is enough. The POS (Billing) reads
// menu items, categories, units and customers without the modules that manage them.

const { crud } = require('@zodu/security');

const POS_LOOKUP = ['billing:read', 'billing:create', 'menu:read', 'inventory:read', 'purchase:read', 'expense:read'];
const CATEGORY_WRITE = (action) => ['menu', 'inventory', 'expense', 'purchase'].map((m) => `${m}:${action}`);

module.exports = [
  // ── Signed-in user, no module: own companies, the branch switcher, uploads ──
  { method: 'GET', path: '/get/my-companies', authenticated: true },
  { method: 'GET', path: '/get/branches', authenticated: true },
  { method: 'GET', path: '/api/branch', authenticated: true },
  { method: 'PUT', path: '/api/branch', perm: 'branch:edit' },
  // Staged uploads: a record claims them when it is saved (utils/attachments.js).
  { method: 'POST', path: /^\/upload(\/multiple)?$/, authenticated: true },
  { method: 'DELETE', path: '/delete/file', authenticated: true },
  // Reference data
  { method: 'GET', path: '/api/gst-state-code', authenticated: true },
  { method: 'GET', path: '/get/gst', authenticated: true },

  // ── Billing / sales ──
  { method: 'POST', path: '/api/add/orders', perm: 'billing:create' },
  { method: 'PUT', path: '/api/update/orders', any: ['billing:edit', 'sales:edit'] },
  { method: 'GET', path: '/api/sales', any: ['sales:read', 'billing:read'] },
  { method: 'POST', path: /^\/api\/sales\/[^/]+\/payment$/, any: ['billing:create', 'sales:edit'] },
  { method: 'DELETE', path: '/api/sales', any: ['sales:delete', 'billing:delete'] },
  { method: 'GET', path: '/api/doc-sequence', any: ['billing:read', 'billing:create', 'settings:read'] },
  { method: 'PUT', path: '/api/doc-sequence', perm: 'settings:edit' },
  { method: 'POST', path: '/add/hold_menu', perm: 'billing:create' },
  { method: 'DELETE', path: '/delete/hold-menu', perm: 'billing:create' },   // resuming a held bill removes it
  { method: 'GET', path: '/get/hold_menu', any: ['billing:read', 'billing:create'] },
  { method: 'GET', path: '/get/pos_data', any: POS_LOOKUP },
  { method: 'POST', path: /^\/api\/sale-returns\/[^/]+\/refund$/, any: ['sales:edit', 'billing:create'] },
  { method: 'GET', path: '/api/sale-returns', any: ['sales:read', 'billing:read'] },
  { method: 'POST', path: '/api/sale-returns', any: ['sales:edit', 'billing:create'] },
  { method: 'PUT', path: '/api/sale-returns', perm: 'sales:edit' },
  { method: 'DELETE', path: '/api/sale-returns', perm: 'sales:delete' },

  // ── Customers ──
  { method: 'GET', path: '/api/customers', any: ['customer:read', 'billing:read', 'billing:create'] },
  { method: 'POST', path: /^\/api\/customers\/[^/]+\/mark-payment$/, any: ['customer:edit', 'billing:create'] },
  { method: 'POST', path: '/api/customers', any: ['customer:create', 'billing:create'] },
  ...crud('/api/customers', 'customer'),

  // ── Menu items, categories, units, stock ──
  { method: 'GET', path: '/api/menu/menu_items', any: POS_LOOKUP },
  { method: 'GET', path: '/api/menu/check/item_id', any: ['menu:create', 'menu:edit'] },
  { method: 'GET', path: /^\/api\/menu\/(inventory|stock)(\/|$)/, perm: 'inventory:read' },
  { method: 'POST', path: '/api/menu/inventory/adjust', perm: 'inventory:edit' },
  { method: 'POST', path: '/api/menu/add/menu_item', perm: 'menu:create' },
  { method: 'PUT', path: '/api/menu/edit/menu_item', perm: 'menu:edit' },
  { method: 'PUT', path: '/api/menu/status', perm: 'menu:edit' },
  { method: 'DELETE', path: '/api/menu/remove/menu_item', perm: 'menu:delete' },
  { method: 'GET', path: '/api/menu/menu_item', any: POS_LOOKUP },
  { method: 'GET', path: '/get/category', any: POS_LOOKUP },
  { method: 'POST', path: '/check/category-name', any: CATEGORY_WRITE('create') },
  { method: 'POST', path: '/add/category', any: CATEGORY_WRITE('create') },
  { method: 'PUT', path: /^\/(update|inactivate)\/category\//, any: CATEGORY_WRITE('edit') },
  { method: 'DELETE', path: '/delete/category', any: CATEGORY_WRITE('delete') },
  { method: 'GET', path: '/get/units', any: POS_LOOKUP },

  // ── Purchase, vendors, purchase returns ──
  { method: 'POST', path: /^\/api\/purchase\/payment\//, any: ['purchase:create', 'purchase:edit'] },
  ...crud('/api/purchase', 'purchase'),
  { method: 'POST', path: /^\/api\/purchase-returns\/[^/]+\/refund$/, perm: 'purchase:edit' },
  ...crud('/api/purchase-returns', 'purchase'),
  // Vendors serve purchases and expenses.
  { method: 'GET', path: '/api/vendor', any: ['purchase:read', 'expense:read'] },
  { method: 'POST', path: '/api/vendor', any: ['purchase:create', 'expense:create'] },
  { method: 'PUT', path: '/api/vendor', any: ['purchase:edit', 'expense:edit'] },
  { method: 'DELETE', path: '/api/vendor', any: ['purchase:delete', 'expense:delete'] },

  // ── Expense ──
  { method: 'POST', path: /^\/api\/expense\/payment\//, any: ['expense:create', 'expense:edit'] },
  ...crud('/api/expense', 'expense'),

  // ── Dashboard, reports ──
  { method: 'GET', path: '/api/dashboard', perm: 'dashboard:read' },
  { method: 'GET', path: '/api/report', perm: 'report:read' },
  { method: 'GET', path: '/api/accounting', perm: 'report:read' },
];
