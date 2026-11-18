const express = require('express');
const router = express.Router();
const service = require('../services/leave-type-service');
const schema = require('../schema/leave-type-schema');
const RequestValidator = require('../utils/requestValidator');
const security = require('../security');
const { tenantOf } = require('../security/request');
const { isHttpError } = require('../utils/http-error');
const { logger } = require('../utils/logger');

security.protectParams(router);

// Leave Settings → Leave Types. Reading is for any signed-in user (the Apply Leave screen needs the types);
// adding, editing and deleting need the Settings module (security/rules.js).

/** Answers an expected failure with its own status and message; anything else is logged and is a plain 500. */
const fail = (res, err, what) => {
  if (isHttpError(err)) return res.status(err.status).json({ success: false, error: err.message });
  logger.error({ err }, `[leave-types] ${what} failed`);
  return res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
};

/**
 * A route: validate the input (query or body, the :leave_type_id, and the token's company and branch), then
 * run the service. `status` is the answer's status when it is not 200.
 */
const route = ({ schemaName, source = 'query', what, status = 200, run }) => async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema[schemaName], { ...req[source], ...tenantOf(req), ...req.params });
    if (errors) return res.status(400).json({ success: false, errors });
    return res.status(status).json(await run(input));
  } catch (err) {
    return fail(res, err, what);
  }
};

// GET /api/leave-types?status=active|inactive|all&search=      the list (the table and the left-hand list)
router.get('/', route({ schemaName: 'leave_type_list', what: 'list', run: (i) => service.list(i) }));

// GET /api/leave-types/:leave_type_id                          Leave Type Details
router.get('/:leave_type_id', route({ schemaName: 'leave_type_id', what: 'get', run: (i) => service.get(i) }));

// POST /api/leave-types      { name, code, annual_days, is_paid?, carry_forward?, carry_forward_max_days?, encashment?,
//                              applicable_to?, department_ids?, effective_from?, is_active? }
router.post('/', route({ schemaName: 'leave_type_create', source: 'body', what: 'create', status: 201, run: (i) => service.create(i) }));

// PUT /api/leave-types/:leave_type_id      any of the fields above; the rest stay as they are
router.put('/:leave_type_id', route({ schemaName: 'leave_type_update', source: 'body', what: 'update', run: (i) => service.update(i) }));

// DELETE /api/leave-types/:leave_type_id      switches the type off (Inactive); nothing is removed
router.delete('/:leave_type_id', route({ schemaName: 'leave_type_id', source: 'body', what: 'delete', run: (i) => service.remove(i) }));

module.exports = router;
