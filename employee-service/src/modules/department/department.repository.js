const db = require('../../database/connection');

class DepartmentRepository {
    async create(data) {
        const sql = `
            INSERT INTO tbl_departments (department_id, department_code, department_name, zodu_id, branch_id)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING department_id
        `;
        return db.query(sql, [
            data.department_id, 
            data.department_code, 
            data.department_name, 
            data.zodu_id, 
            data.branch_id
        ]);
    }

    async findAll({ limit, offset, branch_id }) {
        const sql = `
            SELECT * FROM tbl_departments 
            WHERE branch_id = $1 AND status = 'active'
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
        `;
        const result = await db.query(sql, [branch_id, limit, offset]);
        return result.rows;
    }

    async findById(id) {
        const sql = `SELECT * FROM tbl_departments WHERE department_id = $1 AND status = 'active'`;
        const result = await db.query(sql, [id]);
        return result.rows[0];
    }

    async update(id, data) {
        const { department_code, department_name } = data;
        const sql = `
            UPDATE tbl_departments 
            SET department_code = COALESCE($1, department_code), 
                department_name = COALESCE($2, department_name), 
                updated_at = NOW()
            WHERE department_id = $3 
            RETURNING *
        `;
        const result = await db.query(sql, [department_code, department_name, id]);
        return result.rows[0];
    }

    async softDelete(id) {
        const sql = `UPDATE tbl_departments SET status = 'inactive', updated_at = NOW() WHERE department_id = $1`;
        const result = await db.query(sql, [id]);
        return result.rowCount > 0;
    }
}

module.exports = new DepartmentRepository();