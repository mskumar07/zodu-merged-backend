// Who may call each customer route (@zodu/security createRoutePolicy). The
// first matching rule wins; a route with no rule is refused.
// Permissions: docs/security/permissions-matrix.md.
//
// perm: every one of them · any: one of them is enough. The POS (Billing) reads
// menu items, categories, units and customers without the modules that manage
// them; the kitchen screen and ticket printing are part of Billing. KOT setup
// (counters, printers, item routing) is a setting.

const { crud } = require('@zodu/security');

const POS_LOOKUP = ['billing:read', 'billing:create', 'menu:read', 'inventory:read', 'purchase:read', 'expense:read'];
const CATEGORY_WRITE = (action) => ['menu', 'inventory', 'expense', 'purchase'].map((m) => `${m}:${action}`);
const BILLING = ['billing:read', 'billing:create'];
const KOT_READ = ['billing:read', 'billing:create', 'settings:read'];

module.exports = [
  // ── Signed-in user, no module: the branch switcher, uploads, reference data ──
  { method: 'GET', path: '/get/branches', authenticated: true },
  { method: 'GET', path: '/api/branch', authenticated: true },
  { method: 'PUT', path: '/api/branch', perm: 'branch:edit' },
  // Staged uploads: a record claims them when it is saved (utils/attachments.js).
  { method: 'POST', path: /^\/upload(\/multiple)?$/, authenticated: true },
  { method: 'DELETE', path: '/delete/file', authenticated: true },
  { method: 'GET', path: '/api/gst-state-code', authenticated: true },
  { method: 'GET', path: '/get/gst', authenticated: true },

  // ── Billing: orders, holds, completing a bill ──
  { method: 'POST', path: '/api/orders/add/orders', perm: 'billing:create' },
  { method: 'PUT', path: '/api/orders/update/orders', any: ['billing:create', 'billing:edit'] },   // adding to an open table
  { method: 'GET', path: '/api/orders/get/orders', any: BILLING },
  { method: 'GET', path: '/api/orders/api/order', any: [...BILLING, 'sales:read'] },
  { method: 'GET', path: '/api/orders/get/kot-list', any: BILLING },
  { method: 'PUT', path: /^\/api\/orders\/api\/kot\/(order|item)-ready$/, perm: 'billing:create' },
  { method: 'GET', path: /^\/api\/orders\/(api\/report\/orders|get\/report\/order-category)$/, perm: 'report:read' },
  { method: 'POST', path: '/api/completeorder', perm: 'billing:create' },
  { method: 'POST', path: '/api/hold/add/hold_menu', perm: 'billing:create' },
  { method: 'PUT', path: '/api/hold/update/hold-menu', perm: 'billing:create' },
  { method: 'DELETE', path: '/api/hold/delete/hold-menu', perm: 'billing:create' },   // resuming a held bill removes it
  { method: 'GET', path: '/api/hold/get/hold-orders', any: BILLING },
  { method: 'GET', path: '/get/pos_data', any: POS_LOOKUP },

  // ── Sales history ──
  { method: 'GET', path: '/api/sales', any: ['sales:read', 'billing:read'] },
  { method: 'DELETE', path: '/api/sales', any: ['sales:delete', 'billing:delete'] },

  // ── KOT: tickets with the bill; counters, printers, routing are settings ──
  { method: 'GET', path: '/get/kot-tickets', any: BILLING },
  { method: 'POST', path: '/add/kot-print-log', any: BILLING },
  { method: 'GET', path: /^\/get\/kot-(counters|assignment|item-routing|printers|settings|config)\//, any: KOT_READ },
  { method: 'POST', path: /^\/(add\/kot-(counter|printer)|assign\/kot-counter-items)$/, perm: 'settings:edit' },
  { method: 'PUT', path: /^\/update\/kot-(counter|printer|item-routing|settings)(\/|$)/, perm: 'settings:edit' },
  { method: 'DELETE', path: /^\/delete\/kot-(counter|printer)\//, perm: 'settings:edit' },

  // ── Customers ──
  { method: 'GET', path: '/api/customers', any: ['customer:read', 'billing:read', 'billing:create'] },
  { method: 'POST', path: '/api/customers', any: ['customer:create', 'billing:create'] },
  ...crud('/api/customers', 'customer'),

  // ── Menu items, categories, units, stock ──
  { method: 'GET', path: '/api/menu/get/menu_item', any: POS_LOOKUP },
  { method: 'GET', path: '/api/menu/check/item_id', any: ['menu:create', 'menu:edit'] },
  { method: 'POST', path: '/api/menu/api/add/menu_item', perm: 'menu:create' },
  { method: 'PUT', path: /^\/api\/menu\/(api\/edit\/menu_item|update\/menu_item|update\/menustatus|update\/menusfav)\//, perm: 'menu:edit' },
  { method: 'PUT', path: /^\/update\/(favorite|menustatus)\//, perm: 'menu:edit' },
  { method: 'DELETE', path: '/api/menu/delete/menu_item', perm: 'menu:delete' },
  { method: 'GET', path: /^\/get\/category\//, any: POS_LOOKUP },
  { method: 'GET', path: '/category-name', any: CATEGORY_WRITE('create') },
  { method: 'POST', path: '/add/category', any: CATEGORY_WRITE('create') },
  { method: 'PUT', path: /^\/(update|inactivate)\/category\//, any: CATEGORY_WRITE('edit') },
  { method: 'DELETE', path: '/delete/category', any: CATEGORY_WRITE('delete') },
  { method: 'GET', path: '/get/units', any: POS_LOOKUP },
  { method: 'POST', path: '/add/unit', any: ['menu:create', 'inventory:create'] },
  { method: 'PUT', path: '/update/unit', any: ['menu:edit', 'inventory:edit'] },
  { method: 'POST', path: '/replace/unit', any: ['menu:edit', 'inventory:edit'] },
  { method: 'DELETE', path: '/delete/unit', any: ['menu:delete', 'inventory:delete'] },
  { method: 'GET', path: '/api/inventory', perm: 'inventory:read' },
  { method: 'POST', path: '/api/inventory/api/add/inventory', perm: 'inventory:create' },
  { method: 'PUT', path: '/api/inventory/api/update/inventory', perm: 'inventory:edit' },
  { method: 'POST', path: '/api/inventory/adjust', perm: 'inventory:edit' },

  // ── Purchase, vendors, purchase returns ──
  { method: 'POST', path: /^\/api\/purchase\/payment\//, any: ['purchase:create', 'purchase:edit'] },
  ...crud('/api/purchase', 'purchase'),
  { method: 'POST', path: /^\/api\/purchase-returns\/[^/]+\/refund$/, perm: 'purchase:edit' },
  ...crud('/api/purchase-returns', 'purchase'),
  // Vendors serve purchases and expenses.
  { method: 'GET', path: /^\/(api\/vendor|get\/vendor\/)/, any: ['purchase:read', 'expense:read'] },
  { method: 'POST', path: /^\/api\/(vendor|add\/vendor)(\/|$)/, any: ['purchase:create', 'expense:create'] },
  { method: 'PUT', path: '/api/vendor', any: ['purchase:edit', 'expense:edit'] },
  { method: 'DELETE', path: '/api/vendor', any: ['purchase:delete', 'expense:delete'] },

  // ── Expense ──
  { method: 'POST', path: /^\/api\/expense\/payment\//, any: ['expense:create', 'expense:edit'] },
  ...crud('/api/expense', 'expense'),

  // ── Dashboard, reports ──
  { method: 'GET', path: '/api/dashboard', perm: 'dashboard:read' },
  { method: 'GET', path: '/api/report', perm: 'report:read' },
];
