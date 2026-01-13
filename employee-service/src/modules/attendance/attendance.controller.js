const service = require('./attendance.service');

// Joi Wrapper
const validate = (schema) => (req, res, next) => {
    const { error } = schema.validate(req.body, { abortEarly: false });
    if (error) return res.status(400).json({ error: error.details.map(d => d.message) });
    next();
};

class AttendanceController {
    async mark(req, res, next) {
        try {
            const result = await service.markAttendance(req.body);
            res.json(result);
        } catch (err) { next(err); }
    }

    async requestLeave(req, res, next) {
        try {
            const result = await service.requestLeave(req.body);
            res.json(result);
        } catch (err) { next(err); }
    }
    
    async approveLeave(req, res, next) {
        try {
            // Assuming middleware injects req.user for manager ID
            const result = await service.approveLeave(req.body.leave_id, req.headers['user-id'], req.body.status);
            res.json(result);
        } catch (err) { next(err); }
    }

  async getAttendanceHistory(req, res, next) {
    try {
        const result = await service.getHistory(req.params.id, req.query);
        res.json(result);
    } catch (err) { next(err); }
}

    async getLeaveHistory(req, res, next) {
        try {
            const data = await service.getLeaveHistory(req.params.id, req.query);
            res.json(data);
        } catch (err) { next(err); }
    }

    async getTeamDashboard(req, res, next) {
        try {
            const data = await service.getTeamDashboard(req.query.branch_id);
            res.json(data);
        } catch (err) { next(err); }
    }

    async getTeamEmployeeList(req, res, next) {
        try {
            const data = await service.getTeamList(req.query.branch_id, req.query.date);
            res.json(data);
        } catch (err) { next(err); }
    }

    
async getLeaveRequests(req, res, next) {
        try {
            // Manager/Admin must provide branch_id in query
            if (!req.query.branch_id) {
                return res.status(400).json({ message: "Branch ID is required" });
            }

            const data = await service.getManagerLeaveRequests(req.query);
            res.json(data);
        } catch (err) {
            next(err);
        }
    }
// In your controller file
async checkTodayStatus(req, res) {
  try {
    // 1. Get the ID from params (matches :id in the route)
    const employeeId = req.params.id;

    if (!employeeId) {
      return res.status(400).json({ success: false, message: "ID is required" });
    }

    const status = await service.getTodayAttendance(employeeId);

    res.status(200).json({
      success: true,
      data: status
    });
  } catch (error) {
    console.error("Controller Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
}

}

module.exports = { ctrl: new AttendanceController(), validate };