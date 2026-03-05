const db = require('../../database/connection');

class EmployeeRepository {
    async create(client, data) {
        const sql = `INSERT INTO tbl_employees (employee_id, employee_code, zodu_id, branch_id, name, phone, role) VALUES ($1, $2, $3, $4, $5, $6, $7)`;
        return client.query(sql, [data.id, data.code, data.zodu_id, data.branch_id, data.name, data.phone, data.role]);
    }

    // async mapDepartment(client, empId, deptId) {
    //     return client.query('INSERT INTO tbl_employee_department_map (employee_id, department_id) VALUES ($1, $2)', [empId, deptId]);
    // }

    async findAll({ limit, offset, branch_id }) {
        const sql = `
            SELECT * FROM tbl_employees WHERE branch_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3
        `;
        const result = await db.query(sql, [branch_id, limit, offset]);
        return result.rows;
    }

    async findById(id) {
        const result = await db.query(`SELECT * FROM tbl_employees WHERE employee_id = $1`, [id]);
        return result.rows[0];
    }

    async update(id, data) {
        const { name, phone, role } = data;
        const sql = `
            UPDATE tbl_employees 
            SET name = COALESCE($1, name), phone = COALESCE($2, phone), role = COALESCE($3, role), updated_at = NOW()
            WHERE employee_id = $4 RETURNING *
        `;
        const result = await db.query(sql, [name, phone, role, id]);
        return result.rows[0];
    }

    async softDelete(id) {
        const result = await db.query(`UPDATE tbl_employees SET status = 'inactive', updated_at = NOW() WHERE employee_id = $1`, [id]);
        return result.rowCount > 0;
    }

    async saveFace(client, { employee_id, zodu_id, branch_id, embedding }) {
  const sql = `
    INSERT INTO tbl_employee_faces
    (face_id, employee_id, zodu_id, branch_id, face_embedding)
    VALUES (gen_random_uuid(), $1, $2, $3, $4)
  `;
  // Ensure embedding is numeric and formatted as a pgvector literal
  let embParam = embedding;
  if (Array.isArray(embedding)) {
    embParam = `[${embedding.map(v => Number(v)).join(',')}]`;
  }

  // Cast the parameter to vector in SQL to avoid text/array mismatches
  const sqlCast = sql.replace('$4)', '$4::vector)');
  return client.query(sqlCast, [
    employee_id,
    zodu_id,
    branch_id,
    embParam
  ]);
}

async deleteFaces(employee_id) {
  return db.query(
    "DELETE FROM tbl_employee_faces WHERE employee_id = $1",
    [employee_id]
  );
}
}
module.exports = new EmployeeRepository();