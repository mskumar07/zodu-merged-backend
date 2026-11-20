// The signed-in user's employee record. Employees live in employee-service, so this reads them
// through its roster (clients/employee-directory.js) instead of a local table.
const directory = require('../clients/employee-directory');

// { employee_id, employee_code, name, status, ... } or null.
exports.findByUser = (user_id, { zodu_id, branch_id }) => directory.findByUser(user_id, { zodu_id, branch_id });
