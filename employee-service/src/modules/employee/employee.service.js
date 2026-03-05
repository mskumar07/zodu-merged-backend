const { v4: uuidv4 } = require('uuid');
const db = require('../../database/connection');
const employeeRepo = require('./employee.repository');
const faceService = require('../face/face.service');

class EmployeeService {
    async createEmployee(data) {
        try {
            await db.query('BEGIN');
            const empId = uuidv4();
            
            // Generate unique employee code with format: EMP-{branch_id}-{YYYY}-{sequence}
            const year = new Date().getFullYear();
            const empCode = await this.generateUniqueEmployeeCode(db, data.branch_id, year);
            console.log(empCode)
            
            await employeeRepo.create(db, { ...data, id: empId, code: empCode });

            // if (data.department_ids && data.department_ids.length > 0) {
            //     for (let deptId of data.department_ids) {
            //         await employeeRepo.mapDepartment(db, empId, deptId);
            //     }
            // }

                  if (data.faceImage) {
        const embedding = await faceService.generateEmbedding(data.faceImage);

        await employeeRepo.saveFace(db, {
          employee_id: empId,
          zodu_id: data.zodu_id,
          branch_id: data.branch_id,
          embedding
        });
      }
            await db.query('COMMIT');
            return { employee_id: empId, message: "Employee Created Successfully" };
        } catch (error) {
            await db.query('ROLLBACK');
            throw error;
        } 
    }

  async generateUniqueEmployeeCode(client, zoduId, branchId) {

  const year = new Date().getFullYear();

  const result = await client.query(`
    INSERT INTO tbl_employee_code_sequence 
      (zodu_id, branch_id, year, current_value)
    VALUES ($1, $2, $3, 1)
    ON CONFLICT (zodu_id, branch_id, year)
    DO UPDATE SET
      current_value = tbl_employee_code_sequence.current_value + 1,
      updated_at = NOW()
    RETURNING current_value
  `, [zoduId, branchId, year]);

  const sequence = result.rows[0].current_value
    .toString()
    .padStart(6, '0');   // 👈 6 digits for 100k+ scale

  return `EMP-${zoduId}-${branchId}-${year}-${sequence}`;
}

    async createEmployeeWithRetry(data, retries = 3) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                return await this.createEmployee(data);
            } catch (error) {
                // If unique constraint violation and retries left, try again with wait
                if (error.code === '23505' && attempt < retries) {
                    await new Promise(resolve => setTimeout(resolve, 100 * attempt)); // exponential backoff
                    continue;
                }
                throw error;
            }
        }
    }

    async getEmployees(query) { return await employeeRepo.findAll(query); }
    async getEmployeeById(id) { return await employeeRepo.findById(id); }
 async updateEmployee(id, data) {
    try {
      await db.query("BEGIN");

      const updated = await employeeRepo.update(id, data);

      // 🔥 If new face provided → replace old embeddings
      if (data.faceImage) {
        const embedding = await faceService.generateEmbedding(data.faceImage);

        await employeeRepo.deleteFaces(id);

        await employeeRepo.saveFace(db, {
          employee_id: id,
          zodu_id: updated.zodu_id,
          branch_id: updated.branch_id,
          embedding
        });
      }

      await db.query("COMMIT");

      return {
        message: "Employee Updated",
        data: updated
      };

    } catch (err) {
      await db.query("ROLLBACK");
      throw err;
    }
  }
  
  async deleteEmployee(id) { return await employeeRepo.softDelete(id); }
}
module.exports = new EmployeeService();