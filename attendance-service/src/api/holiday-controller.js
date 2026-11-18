const express = require('express');
const router = express.Router();
const service = require('../services/holiday-service');
const schema = require('../schema/holiday-schema');
const RequestValidator = require('../utils/requestValidator');
const employeeRepo = require('../repository/employee-repo');
const security = require('../security');
const { tenantOf } = require('../security/request');
const { isHttpError } = require('../utils/http-error');
const { logger } = require('../utils/logger');

security.protectParams(router);

// Leave → Holidays. Reading and exporting are for any signed-in user (the Leave screen shows the holidays);
// adding, editing and deleting need the Attendance module (security/rules.js), like the Excel import.

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Answers an expected failure with its own status and message; anything else is logged and is a plain 500. */
const fail = (res, err, what) => {
  if (isHttpError(err)) return res.status(err.status).json({ success: false, error: err.message });
  logger.error({ err }, `[holidays] ${what} failed`);
  return res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
};

/**
 * Who is adding the holiday, for created_by: the signed-in user's employee record, else the user id (what the
 * Excel import does too). The column is a UUID, so anything else is left empty rather than failing the save.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const createdBy = async (req, tenant) => {
  const own = await employeeRepo.findByUser(req.auth.userId, tenant);
  const id = own?.employee_id ?? req.auth.userId;
  return UUID.test(String(id)) ? id : null;
};

/** A route: validate the input (query or body, the :holiday_id, and the token's company and branch), then run the service. */
const route = ({ schemaName, source = 'query', what, status = 200, run, send, creator = false }) => async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema[schemaName], { ...req[source], ...tenantOf(req), ...req.params });
    if (errors) return res.status(400).json({ success: false, errors });
    const result = await run(creator ? { ...input, created_by: await createdBy(req, input) } : input);
    return send ? send(res, result) : res.status(status).json(result);
  } catch (err) {
    return fail(res, err, what);
  }
};

// GET /api/holidays?year=&type=&search=     the table, plus the counts beside the left-hand list
router.get('/', route({ schemaName: 'holiday_list', what: 'list', run: (i) => service.list(i) }));

// GET /api/holidays/export?year=      the year's holidays as an Excel file (the same columns the import reads)
router.get('/export', route({
  schemaName: 'holiday_export', what: 'export', run: (i) => service.exportSheet(i),
  send: (res, { year, buffer }) => {
    res.set({ 'Content-Type': XLSX, 'Content-Disposition': `attachment; filename="holidays-${year}.xlsx"`, 'Content-Length': buffer.length });
    return res.end(buffer);
  },
}));

// GET /api/holidays/:holiday_id
router.get('/:holiday_id', route({ schemaName: 'holiday_id', what: 'get', run: (i) => service.get(i) }));

// POST /api/holidays      { name, holiday_date, type?, applicable_to?, department_ids? }
router.post('/', route({ schemaName: 'holiday_create', source: 'body', what: 'create', status: 201, creator: true, run: (i) => service.create(i) }));

// PUT /api/holidays/:holiday_id      any of the fields above; the rest stay as they are
router.put('/:holiday_id', route({ schemaName: 'holiday_update', source: 'body', what: 'update', run: (i) => service.update(i) }));

// DELETE /api/holidays/:holiday_id      removes the holiday
router.delete('/:holiday_id', route({ schemaName: 'holiday_id', source: 'body', what: 'delete', run: (i) => service.remove(i) }));

module.exports = router;
