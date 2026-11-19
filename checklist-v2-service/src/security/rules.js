// Who may call each customer route (@zodu/security createRoutePolicy).
// First match wins; a route with no rule is refused. Ownership (own runs, own
// notifications, reviewer) is checked in the handlers. Design: §10.1.
// Permissions matrix: docs/security/permissions-matrix.md.
const { crud } = require('@zodu/security');

module.exports = [
  // anyone signed in: their own work and their own notifications
  { method: 'GET', path: '/api/categories', authenticated: true },
  { method: 'GET', path: '/api/settings', authenticated: true },
  { method: 'GET', path: '/api/task-statuses', authenticated: true },
  { method: 'GET', path: /^\/api\/runs(\/summary|\/review-queue)?$/, authenticated: true },
  { method: 'GET', path: /^\/api\/runs\/[^/]+$/, authenticated: true },
  { method: ['PUT', 'POST', 'DELETE'], path: /^\/api\/runs\/[^/]+\/items\/[^/]+(\/photos(\/[^/]+)?)?$/, authenticated: true },
  { method: 'POST', path: /^\/api\/runs\/[^/]+\/(complete-all|submit|review)$/, authenticated: true },
  { method: 'POST', path: /^\/api\/runs\/[^/]+\/reassign$/, perm: 'checklist:edit' },
  { method: 'GET', path: '/api/dashboard/my', authenticated: true },
  { method: 'GET', path: '/api/dashboard/team', perm: 'checklist:read' },
  { method: ['GET', 'POST', 'PUT', 'DELETE'], path: /^\/api\/(notifications|notification-preferences)(\/|$)/, authenticated: true },

  // managing checklists
  { method: 'PUT', path: '/api/settings', perm: 'checklist:edit' },
  { method: 'POST', path: '/api/task-statuses', perm: 'checklist:create' },
  { method: 'PUT', path: /^\/api\/task-statuses\/[^/]+$/, perm: 'checklist:edit' },
  { method: 'DELETE', path: /^\/api\/task-statuses\/[^/]+$/, perm: 'checklist:delete' },
  { method: 'POST', path: '/api/categories', perm: 'checklist:create' },
  { method: 'PUT', path: /^\/api\/categories\/[^/]+$/, perm: 'checklist:edit' },
  { method: 'DELETE', path: /^\/api\/categories\/[^/]+$/, perm: 'checklist:delete' },
  { method: 'POST', path: '/api/checklists/schedule-preview', perm: 'checklist:create' },
  { method: 'PATCH', path: /^\/api\/checklists\/[^/]+\/status$/, perm: 'checklist:edit' },
  { method: 'POST', path: /^\/api\/checklists\/[^/]+\/(duplicate|images)$/, perm: 'checklist:create' },
  { method: 'DELETE', path: /^\/api\/checklists\/[^/]+\/images\/[^/]+$/, perm: 'checklist:edit' },
  ...crud('/api/checklists', 'checklist'),
];
