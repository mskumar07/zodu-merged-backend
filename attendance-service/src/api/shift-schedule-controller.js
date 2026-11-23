const express = require('express');
const router = express.Router();
const service = require('../services/shift-schedule-service');
const schema = require('../schema/shift-schedule-schema');
const RequestValidator = require('../utils/requestValidator');
const security = require('../security');
const { tenantOf } = require('../security/request');
const { isHttpError } = require('../utils/http-error');
const { logger } = require('../utils/logger');

security.protectParams(router);

// Shift Allocation Engine → Schedule Shifts. Reading and assigning need the Attendance module (security/rules.js).

/** Answers an expected failure with its own status and message (and its details, e.g. the conflicting cells); anything else is a plain 500. */
const fail = (res, err, what) => {
  if (isHttpError(err)) {
    return res.status(err.status).json({ success: false, error: err.message, ...(err.details && { details: err.details }) });
  }
  logger.error({ err }, `[shift-schedule] ${what} failed`);
  return res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
};

/** A route: validate the input (query or body, and the token's company and branch), then run the service. */
const route = ({ schemaName, source = 'query', what, run }) => async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema[schemaName], { ...req[source], ...tenantOf(req) });
    if (errors) return res.status(400).json({ success: false, errors });
    return res.status(200).json(await run(input, req));
  } catch (err) {
    return fail(res, err, what);
  }
};

// GET /api/shift-schedule?from=2026-11-23&to=2026-11-29&search=&page=1&limit=50     the grid: employees x dates
router.get('/', route({ schemaName: 'shift_schedule_list', what: 'list', run: (i) => service.list(i) }));

// PUT /api/shift-schedule   { changes: [{ employee_id, work_date, shift_template_id | null, version }] }     Assign Shifts
router.put('/', route({
  schemaName: 'shift_schedule_assign', source: 'body', what: 'assign',
  run: (i, req) => service.assign({ ...i, updated_by: req.auth.userId }),
}));

module.exports = router;
