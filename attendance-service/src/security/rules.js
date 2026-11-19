// Who may call each customer route (@zodu/security createRoutePolicy). The
// first matching rule wins; a route with no rule is refused.
// Permissions: docs/security/permissions-matrix.md.

const { crud } = require('@zodu/security');

module.exports = [
  // Own attendance: any signed-in user; another employee's needs attendance:read (handler).
  { method: 'GET', path: '/api/attendance/my', authenticated: true },
  // Team dashboard (manager / Admin): the Attendance module. Listed before the own-dashboard rule below.
  { method: 'GET', path: '/api/attendance/dashboard/team', perm: 'attendance:read' },
  // Own dashboard: any signed-in user; the handler only ever reads the caller's own employee record.
  // Exact path: a prefix would also open everything under it.
  { method: 'GET', path: /^\/api\/attendance\/dashboard$/, authenticated: true },
  // Self check-in / check-out: any signed-in employee, for themselves only (the handler
  // resolves the employee from the token).
  { method: 'POST', path: /^\/api\/attendance\/check-(in|out)$/, authenticated: true },
  ...crud('/api/attendance', 'attendance'),

  // Leave. Loading the holiday list needs attendance:edit; everything else is for any signed-in
  // employee, and the handlers scope it: your own leave, your reports' requests (decided by their
  // reporting manager, or the company Admin), and nobody decides their own.
  { method: 'POST', path: '/api/leave/holidays/upload', perm: 'attendance:edit' },
  { method: ['GET', 'POST', 'PUT'], path: '/api/leave', authenticated: true },

  // Leave Settings → Leave Types. Anyone signed in may read them (the Apply Leave screen lists them); adding,
  // editing and deleting (which switches a type off) need the Settings module. The company Admin always passes.
  { method: 'GET', path: '/api/leave-types', authenticated: true },
  ...crud('/api/leave-types', 'settings'),

  // Leave → Leave Policy. Anyone signed in may read them; adding, editing and deleting need the Settings module,
  // like leave types. The company Admin always passes.
  { method: 'GET', path: '/api/leave-policies', authenticated: true },
  ...crud('/api/leave-policies', 'settings'),

  // Shift Allocation → Shift Templates. Anyone signed in may read them; adding, editing and deleting (which switches
  // a template off) need the Attendance module. The company Admin always passes.
  { method: 'GET', path: '/api/shift-templates', authenticated: true },
  ...crud('/api/shift-templates', 'attendance'),

  // Leave → Holidays (list, export, add, edit, delete). Anyone signed in may read and export; changes need the
  // Attendance module, like the Excel import above. The company Admin always passes.
  { method: 'GET', path: '/api/holidays', authenticated: true },
  ...crud('/api/holidays', 'attendance'),

  // Documents belong to the employee record: editing it.
  { method: ['POST', 'DELETE'], path: /^\/api\/employees\/[^/]+\/documents(\/[^/]+)?$/, perm: 'employee:edit' },
  // Assigning a role is also checked in the handler (role:edit).
  { method: 'PUT', path: /^\/api\/employees\/[^/]+\/login-details$/, perm: 'employee:edit' },
  ...crud('/api/employees', 'employee'),
];
