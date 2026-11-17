// Who may call each customer route (@zodu/security createRoutePolicy). The
// first matching rule wins; a route with no rule is refused.
// Permissions: docs/security/permissions-matrix.md.

const { crud } = require('@zodu/security');

module.exports = [
  // Own attendance: any signed-in user; another employee's needs attendance:read (handler).
  { method: 'GET', path: '/api/attendance/my', authenticated: true },
  // Self check-in / check-out: any signed-in employee, for themselves only (the handler
  // resolves the employee from the token).
  { method: 'POST', path: /^\/api\/attendance\/check-(in|out)$/, authenticated: true },
  ...crud('/api/attendance', 'attendance'),

  // Leave. Loading the holiday list needs attendance:edit; everything else is for any signed-in
  // employee, and the handlers scope it: your own leave, your reports' requests (decided by their
  // reporting manager, or the company Admin), and nobody decides their own.
  { method: 'POST', path: '/api/leave/holidays/upload', perm: 'attendance:edit' },
  { method: ['GET', 'POST', 'PUT'], path: '/api/leave', authenticated: true },

  // Documents belong to the employee record: editing it.
  { method: ['POST', 'DELETE'], path: /^\/api\/employees\/[^/]+\/documents(\/[^/]+)?$/, perm: 'employee:edit' },
  // Assigning a role is also checked in the handler (role:edit).
  { method: 'PUT', path: /^\/api\/employees\/[^/]+\/login-details$/, perm: 'employee:edit' },
  ...crud('/api/employees', 'employee'),
];
