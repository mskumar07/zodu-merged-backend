// Who may call each customer route (@zodu/security createRoutePolicy). The
// first matching rule wins; a route with no rule is refused.
// Permissions: docs/security/permissions-matrix.md.

const { crud } = require('@zodu/security');

const BASE = '/api/checklists';

module.exports = [
  // An employee's own tasks and progress: any signed-in user; someone else's
  // need checklist:read / checklist:edit (checked in the handlers).
  { method: 'GET', path: `${BASE}/my-summary`, authenticated: true },
  { method: 'GET', path: `${BASE}/my-tasks`, authenticated: true },
  { method: ['GET', 'POST'], path: `${BASE}/progress`, authenticated: true },

  { method: 'GET', path: /^\/api\/checklists\/(assigned-employees|assigned-employees-summary|instances\/list)$/, perm: 'checklist:read' },
  { method: 'POST', path: /^\/api\/checklists\/[^/]+\/attachments$/, perm: 'checklist:create' },
  { method: 'DELETE', path: /^\/api\/checklists\/[^/]+\/attachments\/[^/]+$/, perm: 'checklist:edit' },
  ...crud(BASE, 'checklist'),
];
