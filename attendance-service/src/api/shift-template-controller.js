const express = require('express');
const router = express.Router();
const service = require('../services/shift-template-service');
const schema = require('../schema/shift-template-schema');
const RequestValidator = require('../utils/requestValidator');
const security = require('../security');
const { tenantOf } = require('../security/request');
const { isHttpError } = require('../utils/http-error');
const { logger } = require('../utils/logger');

security.protectParams(router);

// Shift Allocation Engine → Shift Templates. Reading is for any signed-in user (rosters and the employee screens
// show the templates); adding, editing and deleting need the Attendance module (security/rules.js).

/** Answers an expected failure with its own status and message; anything else is logged and is a plain 500. */
const fail = (res, err, what) => {
  if (isHttpError(err)) return res.status(err.status).json({ success: false, error: err.message });
  logger.error({ err }, `[shift-templates] ${what} failed`);
  return res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
};

/** A route: validate the input (query or body, the :shift_template_id, and the token's company and branch), then run the service. */
const route = ({ schemaName, source = 'query', what, status = 200, run }) => async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema[schemaName], { ...req[source], ...tenantOf(req), ...req.params });
    if (errors) return res.status(400).json({ success: false, errors });
    return res.status(status).json(await run(input));
  } catch (err) {
    return fail(res, err, what);
  }
};

// GET /api/shift-templates?status=active|inactive|all&search=      the list
router.get('/', route({ schemaName: 'shift_template_list', what: 'list', run: (i) => service.list(i) }));

// GET /api/shift-templates/:shift_template_id
router.get('/:shift_template_id', route({ schemaName: 'shift_template_id', what: 'get', run: (i) => service.get(i) }));

// POST /api/shift-templates   { name, code, start_time, end_time, description?, is_cross_day?, break_start?, break_minutes?,
//                               applicable_to?, department_ids?, ot_eligible?, is_active? }
router.post('/', route({ schemaName: 'shift_template_create', source: 'body', what: 'create', status: 201, run: (i) => service.create(i) }));

// PUT /api/shift-templates/:shift_template_id   any of the fields above; the rest stay as they are
router.put('/:shift_template_id', route({ schemaName: 'shift_template_update', source: 'body', what: 'update', run: (i) => service.update(i) }));

// DELETE /api/shift-templates/:shift_template_id   switches the template off (Inactive); nothing is removed
router.delete('/:shift_template_id', route({ schemaName: 'shift_template_id', source: 'body', what: 'delete', run: (i) => service.remove(i) }));

module.exports = router;
