const router = require('express').Router();
const { ctrl, validate } = require('./attendance.controller');
const validator = require('./attendance.validator');
const multer = require("multer");
const upload = multer();

router.post('/mark', validate(validator.markAttendance), ctrl.mark);
router.post('/leave', validate(validator.leaveRequest), ctrl.requestLeave);
router.put('/leave/action', ctrl.approveLeave); // Approve/Reject
router.get('/history/:id', ctrl.getAttendanceHistory); // Attendance Log
router.get('/leave/history/:id', ctrl.getLeaveHistory); // Leave Log
router.get('/dashboard/team', ctrl.getTeamDashboard); // Admin Dashboard
router.get('/leave/requests', ctrl.getLeaveRequests);
router.get('/today/attendance/:id',ctrl.checkTodayStatus);
router.get('/team/employees', ctrl.getTeamEmployeeList);
router.post(
  "/face-mark",
  require("multer")().single("image"),
  ctrl.faceMark
);

module.exports = router;