const { v4: uuidv4 } = require('uuid');
const departmentRepo = require('./department.repository');

class DepartmentService {
    async createDepartment(data) {
        const departmentId = uuidv4();
        await departmentRepo.create({ ...data, department_id: departmentId });
        return { message: "Department Created Successfully", department_id: departmentId };
    }

    async getDepartments(query) {
        const { page = 1, limit = 10, branch_id } = query;
        const offset = (page - 1) * limit;
        return await departmentRepo.findAll({ limit, offset, branch_id });
    }

    async getDepartmentById(id) {
        return await departmentRepo.findById(id);
    }

    async updateDepartment(id, data) {
        return await departmentRepo.update(id, data);
    }

    async deleteDepartment(id) {
        return await departmentRepo.softDelete(id);
    }
}

module.exports = new DepartmentService();