const express = require('express');
const router  = express.Router();
const service  = require('../services/attendance-service');
const RequestValidator = require('../utils/requestValidator');
const schema  = require('../schema/attendance-schema');
const security    = require('../security');
const { tenantOf, callerOf } = require('../security/request');
const employeeRepo = require('../repository/employee-repo');

security.protectParams(router);

const currentMonthYear = () => {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
};

// ── MARK ATTENDANCE  POST /api/attendance ─────────────────────────────────────
// Body: { zodu_id, branch_id, attendance_date, marked_by, marked_by_name,
//         records: [{ employee_id, status, check_in_time, check_out_time, remarks }] }
router.post('/', async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema.attendance_mark_save, { ...req.body, ...tenantOf(req) });
    if (errors) return res.status(400).json({ success: false, errors });

    // Who saved it is the signed-in user, whatever the body says.
    const own = await employeeRepo.findByUser(req.auth.userId, input);
    input.marked_by = own?.employee_id ?? req.auth.userId;
    input.marked_by_name = own?.name ?? input.marked_by_name ?? '-';

    const result = await service.markAttendance(input);
    return res.status(201).json(result);
  } catch (err) {
    return fail(res, err);
  }
});

// ── EMPLOYEES FOR MARK ATTENDANCE MODAL  GET /api/attendance/mark?zodu_id=&branch_id=&attendance_date=&page=&limit= ─
// Active employees for the branch, left-joined to that date's attendance row (if
// already marked) so the modal can prefill check-in/check-out/status.
router.get('/mark', async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema.attendance_mark_list, { ...req.query, ...tenantOf(req) });
    if (errors) return res.status(400).json({ success: false, errors });

    const result = await service.getEmployeesForMarking(input);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// The caller's own employee_id (left out of the team lists): the one passed, else looked up
// from the token. Null when the caller has no employee record, which excludes nobody.
const callerEmployeeId = async (req, input) =>
  input.employee_id || (await employeeRepo.findByUser(req.auth.userId, input))?.employee_id || null;

// ── TEAM ATTENDANCE · MONTH  GET /api/attendance/team?zodu_id=&branch_id=&month=&year=&search=&page=&limit= ─
// "Attendance – Month View": one page of the team with each person's day map and
// present / absent / leave / weekly-off / working-day counts, plus branch-wide
// summary (totals and per-employee averages). month/year default to current.
router.get('/team', async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema.attendance_team, { ...req.query, ...tenantOf(req) });
    if (errors) return res.status(400).json({ success: false, errors });

    const { month: defMonth, year: defYear } = currentMonthYear();
    const month = input.month || defMonth;
    const year  = input.year  || defYear;

    const result = await service.getTeamAttendance({ ...input, employee_id: await callerEmployeeId(req, input), month, year });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── TEAM ATTENDANCE · DAY  GET /api/attendance/team/daily?zodu_id=&branch_id=&attendance_date=&search=&status=&page=&limit= ─
// "Mark Attendance" daily list: one page of the team with that day's status and
// punches, plus the day's summary (total / present / absent / on leave / weekly off).
router.get('/team/daily', async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema.attendance_team_day, { ...req.query, ...tenantOf(req) });
    if (errors) return res.status(400).json({ success: false, errors });

    const result = await service.getTeamDay({ ...input, employee_id: await callerEmployeeId(req, input) });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── MY ATTENDANCE  GET /api/attendance/my?zodu_id=&branch_id=&employee_id=&month=&year= ─
// "My Attendance" personal daily view + summary cards. employee_id defaults to
// the signed-in user's own employee record.
router.get('/my', async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema.attendance_my, { ...req.query, ...tenantOf(req) });
    if (errors) return res.status(400).json({ success: false, errors });

    let employee_id = input.employee_id;
    // Someone else's attendance needs attendance:read.
    if (!employee_id || !callerOf(req).can('attendance:read')) {
      const own = await employeeRepo.findByUser(req.auth.userId, input);
      if (!employee_id) {
        if (!own) return res.status(404).json({ success: false, error: 'No employee record for this user' });
        employee_id = own.employee_id;
      } else if (!own || own.employee_id !== employee_id) {
        return res.status(403).json({ success: false, error: 'Permission denied' });
      }
    }

    const { month: defMonth, year: defYear } = currentMonthYear();
    const month = input.month || defMonth;
    const year  = input.year  || defYear;

    const result = await service.getMyAttendance({ ...input, employee_id, month, year });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── CHECK-IN / CHECK-OUT  POST /api/attendance/check-in | /check-out ──────────
// The signed-in employee punches for themselves, at the server's time.
const punch = (action) => async (req, res) => {
  try {
    // The employee always comes from the token: an employee_id in the body (older
    // app builds send one) is dropped, never used to punch for someone else.
    // eslint-disable-next-line no-unused-vars
    const { employee_id: _ignored, ...body } = req.body || {};
    const { errors, input } = await RequestValidator(schema.attendance_punch, { ...body, ...tenantOf(req) });
    if (errors) return res.status(400).json({ success: false, errors });

    const employee = await employeeRepo.findByUser(req.auth.userId, input);
    if (!employee) return res.status(404).json({ success: false, error: 'No employee record for this user' });
    if (employee.status && employee.status !== 'active') {
      return res.status(403).json({ success: false, error: 'Your employee record is inactive' });
    }

    const result = await service[action]({ ...input, employee });
    return res.status(200).json(result);
  } catch (err) {
    if (err instanceof service.PunchError) return res.status(err.status).json({ success: false, error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
};
router.post('/check-in', punch('checkIn'));
router.post('/check-out', punch('checkOut'));

// ── ONE EMPLOYEE'S DAY  PUT /api/attendance/employee/:employee_id ─────────────
// Saves the "Edit Attendance" dialog: { attendance_date, status, check_in_time, check_out_time, remarks },
// times "HH:mm" (IST). The dialog opens from the list row it already has, so there is no read route.
// Scoped to the token's company and branch; anyone else's employee is a 404. Needs attendance:edit.
const fail = (res, err) =>
  err instanceof service.AttendanceError
    ? res.status(err.status).json({ success: false, error: err.message })
    : res.status(500).json({ success: false, error: err.message });

router.put('/employee/:employee_id', async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema.attendance_employee_day_save,
      { ...req.body, ...tenantOf(req), employee_id: req.params.employee_id });
    if (errors) return res.status(400).json({ success: false, errors });

    // Who saved it is the signed-in user, whatever the body says.
    const own = await employeeRepo.findByUser(req.auth.userId, input);
    input.marked_by = own?.employee_id ?? req.auth.userId;
    input.marked_by_name = own?.name ?? '-';

    return res.status(200).json(await service.saveEmployeeDay(input));
  } catch (err) {
    return fail(res, err);
  }
});

module.exports = router;
