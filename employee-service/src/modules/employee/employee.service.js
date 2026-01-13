const { v4: uuidv4 } = require('uuid');
const db = require('../../database/connection');
const employeeRepo = require('./employee.repository');

class EmployeeService {
    async createEmployee(data) {
        try {
            await db.query('BEGIN');
            const empId = uuidv4();
            const empCode = "EMP" + Math.floor(1000 + Math.random() * 9000);
            
            await employeeRepo.create(db, { ...data, id: empId, code: empCode });

            if (data.department_ids && data.department_ids.length > 0) {
                for (let deptId of data.department_ids) {
                    await employeeRepo.mapDepartment(db, empId, deptId);
                }
            }

            await db.query('COMMIT');
            return { employee_id: empId, message: "Employee Created Successfully" };
        } catch (error) {
            await db.query('ROLLBACK');
            throw error;
        } 
    }

    async getEmployees(query) { return await employeeRepo.findAll(query); }
    async getEmployeeById(id) { return await employeeRepo.findById(id); }
    async updateEmployee(id, data) { return await employeeRepo.update(id, data); }
    async deleteEmployee(id) { return await employeeRepo.softDelete(id); }
}
module.exports = new EmployeeService();