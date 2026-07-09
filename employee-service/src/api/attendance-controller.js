const express = require('express');
const router  = express.Router();
const service = require('../services/attendance-service');

const currentMonthYear = () => {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
};

// ── MARK ATTENDANCE  POST /api/attendance ─────────────────────────────────────
// Body: { zodu_id, branch_id, attendance_date, marked_by, marked_by_name,
//         records: [{ employee_id, status, check_in_time, check_out_time, remarks }] }
router.post('/', async (req, res) => {
  try {
    const { zodu_id, branch_id, attendance_date, marked_by, marked_by_name, records } = req.body;
    if (!zodu_id)         return res.status(400).json({ success: false, error: 'zodu_id is required' });
    if (!branch_id)       return res.status(400).json({ success: false, error: 'branch_id is required' });
    if (!attendance_date) return res.status(400).json({ success: false, error: 'attendance_date is required' });
    if (!marked_by)       return res.status(400).json({ success: false, error: 'marked_by is required' });
    if (!Array.isArray(records) || !records.length)
      return res.status(400).json({ success: false, error: 'records must be a non-empty array' });

    const result = await service.markAttendance({
      zodu_id, branch_id, attendance_date, marked_by, marked_by_name, records,
    });
    return res.status(201).json(result);
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
    const { zodu_id, branch_id, employee_id } = req.query;
    if (!zodu_id)     return res.status(400).json({ success: false, error: 'zodu_id is required' });
    if (!branch_id)   return res.status(400).json({ success: false, error: 'branch_id is required' });
    if (!employee_id) return res.status(400).json({ success: false, error: 'employee_id is required' });

    const { month: defMonth, year: defYear } = currentMonthYear();
    const month = parseInt(req.query.month, 10) || defMonth;
    const year  = parseInt(req.query.year, 10)  || defYear;

    const result = await service.getTeamAttendance({ zodu_id, branch_id, employee_id, month, year });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── MY ATTENDANCE  GET /api/attendance/my?zodu_id=&branch_id=&employee_id=&month=&year= ─
// "My Attendance" personal daily view + summary cards.
router.get('/my', async (req, res) => {
  try {
    const { zodu_id, branch_id, employee_id } = req.query;
    if (!zodu_id)     return res.status(400).json({ success: false, error: 'zodu_id is required' });
    if (!branch_id)   return res.status(400).json({ success: false, error: 'branch_id is required' });
    if (!employee_id) return res.status(400).json({ success: false, error: 'employee_id is required' });

    const { month: defMonth, year: defYear } = currentMonthYear();
    const month = parseInt(req.query.month, 10) || defMonth;
    const year  = parseInt(req.query.year, 10)  || defYear;

    const result = await service.getMyAttendance({ employee_id, zodu_id, branch_id, month, year });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
