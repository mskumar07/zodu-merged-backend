// Who may call each customer route (@zodu/security createRoutePolicy). The
// first matching rule wins; a route with no rule is refused.
// Permissions: docs/security/permissions-matrix.md.

const { crud } = require('@zodu/security');

module.exports = [
  // Own attendance: any signed-in user; another employee's needs attendance:read (handler).
  { method: 'GET', path: '/api/attendance/my', authenticated: true },
  { method: 'POST', path: '/api/attendance/face', perm: 'attendance:create' },
  ...crud('/api/attendance', 'attendance'),

  // Documents and the attendance face belong to the employee record: editing it.
  { method: ['POST', 'DELETE'], path: /^\/api\/employees\/[^/]+\/(documents|face)(\/[^/]+)?$/, perm: 'employee:edit' },
  // Assigning a role is also checked in the handler (role:edit).
  { method: 'PUT', path: /^\/api\/employees\/[^/]+\/login-details$/, perm: 'employee:edit' },
  ...crud('/api/employees', 'employee'),
];
