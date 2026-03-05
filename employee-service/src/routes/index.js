const router = require('express').Router();
const employeeRoutes = require('../modules/employee/employee.routes');
const attendanceRoutes = require('../modules/attendance/attendance.routes');

// Mount Modules
router.use('/employees', employeeRoutes);
router.use('/attendance', attendanceRoutes);

module.exports = router;