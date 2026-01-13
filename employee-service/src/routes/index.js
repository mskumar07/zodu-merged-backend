const router = require('express').Router();
const employeeRoutes = require('../modules/employee/employee.routes');
const departmentRoutes = require('../modules/department/department.routes');
const attendanceRoutes = require('../modules/attendance/attendance.routes');

// Mount Modules
router.use('/employees', employeeRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/departments', departmentRoutes);

module.exports = router;