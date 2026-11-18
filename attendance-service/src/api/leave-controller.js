const express = require('express');
const multer = require('multer');
const router = express.Router();
const service = require('../services/leave-service');
const schema = require('../schema/leave-schema');
const RequestValidator = require('../utils/requestValidator');
const employeeRepo = require('../repository/employee-repo');
const security = require('../security');
const { tenantOf, callerOf } = require('../security/request');
const { isHttpError } = require('../utils/http-error');
const { logger } = require('../utils/logger');

security.protectParams(router);

// Holiday sheets are small; the file is read from memory and never stored.
const SHEET_MAX_BYTES = 2 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: SHEET_MAX_BYTES, files: 1 },
});

// ── helpers ──────────────────────────────────────────────────────────────────

/** Answers an expected failure with its own status and message; anything else is logged and is a plain 500. */
const fail = (res, err, what) => {
  if (isHttpError(err)) {
    return res.status(err.status).json({ success: false, error: err.message, ...(err.details && { errors: err.details }) });
  }
  logger.error({ err }, `[leave] ${what} failed`);
  return res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
};

/**
 * A route: validate the input (query / body / params, plus the token's company and branch), look up the
 * signed-in user's employee record, then run the service. `who` says what the service needs about the caller.
 */
const route = ({ schemaName, source = 'query', what, run }) => async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema[schemaName], { ...req[source], ...tenantOf(req), ...req.params });
    if (errors) return res.status(400).json({ success: false, errors });

    // Everything here is about the caller, so their employee record comes with the request.
    const employee = await employeeRepo.findByUser(req.auth.userId, input);
    const result = await run({ ...input, employee, isOwner: callerOf(req).isOwner, userId: req.auth.userId, req });
    return res.status(result.status ?? 200).json(result.body ?? result);
  } catch (err) {
    return fail(res, err, what);
  }
};

// ── OWN LEAVE ────────────────────────────────────────────────────────────────

// GET /api/leave/summary?year=      balances + upcoming holidays + latest requests (the Leave screen, one call)
router.get('/summary', route({ schemaName: 'leave_year', what: 'summary', run: (i) => service.getSummary(i) }));

// GET /api/leave/balance?year=      the balance of each leave type (for the Apply Leave dialog)
router.get('/balance', route({ schemaName: 'leave_year', what: 'balance', run: (i) => service.getBalances(i) }));

// GET /api/leave/my?year=&page=&limit=      my requests, latest first (View All)
router.get('/my', route({ schemaName: 'leave_my_list', what: 'my leaves', run: (i) => service.listMyLeaves(i) }));

// GET /api/leave/holidays?year=&upcoming=
router.get('/holidays', route({ schemaName: 'leave_holidays', what: 'holidays', run: (i) => service.listHolidays(i) }));

// GET /api/leave/preview?from_date=&to_date=      the days a range would count, and whether it overlaps my leave
router.get('/preview', route({ schemaName: 'leave_preview', what: 'preview', run: (i) => service.previewLeave(i) }));

// POST /api/leave      { leave_type_id, from_date, to_date, reason }
router.post('/', route({
  schemaName: 'leave_apply', source: 'body', what: 'apply',
  run: async (i) => ({ status: 201, body: await service.applyLeave(i) }),
}));

// PUT /api/leave/:leave_request_id/cancel      my own Pending request
router.put('/:leave_request_id/cancel', route({ schemaName: 'leave_cancel', source: 'body', what: 'cancel', run: (i) => service.cancelLeave(i) }));

// ── TEAM ─────────────────────────────────────────────────────────────────────
// The employee's reporting manager decides (the company Admin can too); nobody decides their own.

// GET /api/leave/requests?search=&page=&limit=      Pending requests waiting for me
router.get('/requests', route({ schemaName: 'leave_pending_list', what: 'pending requests', run: (i) => service.listPending(i) }));

// GET /api/leave/team?year=&search=&leave_type=&status=&page=&limit=      "All Leaves"
router.get('/team', route({ schemaName: 'leave_team_list', what: 'team leaves', run: (i) => service.listTeamLeaves(i) }));

// PUT /api/leave/decision      { ids: [...], decision: 'Approved' | 'Rejected', note? }
router.put('/decision', route({ schemaName: 'leave_decision', source: 'body', what: 'decision', run: (i) => service.decide(i) }));

// ── HOLIDAYS ─────────────────────────────────────────────────────────────────

// POST /api/leave/holidays/upload      multipart: file (.xlsx) with the columns Date | Holiday Name | Type
// Needs attendance:edit (security/rules.js). All or nothing: any bad row rejects the whole sheet, and the
// answer lists every problem with its row number.
router.post('/holidays/upload', upload.single('file'), security.tenantBody, async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema.leave_holidays_upload, { ...tenantOf(req) });
    if (errors) return res.status(400).json({ success: false, errors });
    if (!req.file) return res.status(400).json({ success: false, error: 'file is required' });

    const own = await employeeRepo.findByUser(req.auth.userId, input);
    const result = await service.importHolidays({ ...input, created_by: own?.employee_id ?? req.auth.userId, buffer: req.file.buffer });
    return res.status(201).json(result);
  } catch (err) {
    if (err instanceof multer.MulterError) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400).json({ success: false, error: tooBig ? 'The file is larger than 2 MB' : err.message });
    }
    return fail(res, err, 'holiday upload');
  }
});

module.exports = router;
