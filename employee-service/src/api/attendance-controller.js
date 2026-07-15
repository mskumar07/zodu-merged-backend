const express = require('express');
const router  = express.Router();
const service  = require('../services/attendance-service');
const RequestValidator = require('../utils/requestValidator');
const schema  = require('../schema/attendance-schema');

const currentMonthYear = () => {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
};

// ── MARK ATTENDANCE  POST /api/attendance ─────────────────────────────────────
// Body: { zodu_id, branch_id, attendance_date, marked_by, marked_by_name,
//         records: [{ employee_id, status, check_in_time, check_out_time, remarks }] }
router.post('/', async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema.attendance_mark_save, req.body);
    if (errors) return res.status(400).json({ success: false, errors });

    const result = await service.markAttendance(input);
    return res.status(201).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── EMPLOYEES FOR MARK ATTENDANCE MODAL  GET /api/attendance/mark?zodu_id=&branch_id=&attendance_date=&page=&limit= ─
// Active employees for the branch, left-joined to that date's attendance row (if
// already marked) so the modal can prefill check-in/check-out/status.
router.get('/mark', async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema.attendance_mark_list, req.query);
    if (errors) return res.status(400).json({ success: false, errors });

    const result = await service.getEmployeesForMarking(input);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── TEAM ATTENDANCE  GET /api/attendance/team?zodu_id=&branch_id=&employee_id=&month=&year= ─
// "My Team Attendance" grid + summary cards — employee_id is the logged-in
// manager, excluded from the results (their own data comes from /my).
// month/year default to current.
router.get('/team', async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema.attendance_team, req.query);
    if (errors) return res.status(400).json({ success: false, errors });

    const { month: defMonth, year: defYear } = currentMonthYear();
    const month = input.month || defMonth;
    const year  = input.year  || defYear;

    const result = await service.getTeamAttendance({ ...input, month, year });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── MY ATTENDANCE  GET /api/attendance/my?zodu_id=&branch_id=&employee_id=&month=&year= ─
// "My Attendance" personal daily view + summary cards.
router.get('/my', async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema.attendance_my, req.query);
    if (errors) return res.status(400).json({ success: false, errors });

    const { month: defMonth, year: defYear } = currentMonthYear();
    const month = input.month || defMonth;
    const year  = input.year  || defYear;

    const result = await service.getMyAttendance({ ...input, month, year });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
