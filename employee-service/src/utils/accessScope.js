const db = require("../database/connection");

exports.resolveEmployeeScope = async ({ role, employee_id, branch_id }) => {

  // ADMIN → all employees (all branches)
  if (role === "admin") {
    const r = await db.query(
      `SELECT employee_id FROM tbl_employees`
    );
    return r.rows.map(x => x.employee_id);
  }

  // MANAGER → all employees in branch
  if (role === "manager") {
    const r = await db.query(
      `SELECT employee_id FROM tbl_employees WHERE branch_id=$1`,
      [branch_id]
    );
    return r.rows.map(x => x.employee_id);
  }

  // SUPERVISOR → employees in same departments
  if (role === "supervisor") {
    const r = await db.query(`
      SELECT DISTINCT edm2.employee_id
      FROM tbl_employee_department_map edm1
      JOIN tbl_employee_department_map edm2
        ON edm1.department_id = edm2.department_id
      WHERE edm1.employee_id = $1
    `, [employee_id]);

    return r.rows.map(x => x.employee_id);
  }

  // STAFF → self
  return [employee_id];
};
