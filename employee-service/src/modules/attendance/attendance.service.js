const { v4: uuidv4 } = require('uuid');
const moment = require('moment');
const repo = require('./attendance.repository');
const faceService = require('../face/face.service');

class AttendanceService {
    async markAttendance({ employee_id, branch_id, type }) {
        const today = moment().format('YYYY-MM-DD');
        if (type === 'in') {
            await repo.checkIn({ id: uuidv4(), employee_id, branch_id, date: today });
            return { message: "Checked In" };
        } else {
            const res = await repo.checkOut(employee_id, today);
            return { message: "Checked Out", data: res.rows[0] };
        }
    }

    async markByFace({ zodu_id, branch_id, image, employee_id }) {

  if (!employee_id) {
    throw new Error("Employee ID is required");
  }

  // 1️⃣ Generate embedding
  const embedding = await faceService.generateEmbedding(image);

  let embParam = embedding;
  if (Array.isArray(embedding)) {
    embParam = `[${embedding.map(v => Number(v)).join(',')}]`;
  }

  // 2️⃣ Match ONLY this employee
  const match = await repo.matchFaceForEmployee(
    embParam,
    employee_id
  );


  if (!match || !match.rows.length) {
    throw new Error("Face not registered for this employee");
  }

  const distance = match.rows[0].distance;

  if (distance > 0.6) {
    console.log("Face does not match this employee")
    throw new Error("Face does not match this employee");
  }
  // 3️⃣ Attendance logic
  const todayStatus = await repo.getTodayAttendance(employee_id);
  const today = moment().format("YYYY-MM-DD");


  if (!todayStatus.has_checked_in) {

    await repo.checkIn({
      id: uuidv4(),
      employee_id,
      branch_id,
      date: today
    });

    return { message: "Checked In Successfully", type: "in" };

  } else if (!todayStatus.has_checked_out) {

    const result = await repo.checkOut(employee_id, today);

    return {
      message: "Checked Out Successfully",
      type: "out",
      data: result.rows[0]
    };

  } else {
    throw new Error("Attendance already completed for today");
  }
}

    async requestLeave(data) {
        await repo.requestLeave({ leave_id: uuidv4(), ...data });
        return { message: "Leave Requested" };
    }

async getHistory(employeeId, query) {
    const { page = 1, limit = 10, month, status = "all" } = query;

    return repo.getAttendanceHistory(
        employeeId,
        limit,
        (page - 1) * limit,
        month,
        status
    );
}


    async getLeaveHistory(employeeId, query) {
        const { page = 1, limit = 10 } = query;
        return (await repo.getLeaveHistory(employeeId, limit, (page - 1) * limit)).rows;
    }

  async getTodayAttendance(employeeId) {
    const result = await repo.getTodayAttendance(employeeId);
    // repo.getTodayAttendance already returns the specific object or default values
    // so we don't need to call .rows[0] here again.
    return result;
}
    async getTeamDashboard(branchId) {
        return (await repo.getTeamStats(branchId)).rows[0];
    }
    
    async approveLeave(leaveId, managerId, status) {
        await repo.approveLeave(leaveId, managerId, status);
        return { message: "Leave Updated" };
    }
    async getTeamList(branchId, date) {
        return (await repo.getTeamEmployeeList(branchId, date)).rows;
    }

    async getManagerLeaveRequests(query) {
        const { branch_id, status, page = 1, limit = 10 } = query;
        const offset = (page - 1) * limit;

        return await repo.getBranchLeaveRequests({
            branch_id,
            status, // 'Pending', 'Approved', 'Rejected', or 'all'
            limit,
            offset
        });
    }
}
module.exports = new AttendanceService();