const express = require('express');
const router = express.Router();
const service = require('../services/shift-rotation-service');
const schema = require('../schema/shift-rotation-schema');
const RequestValidator = require('../utils/requestValidator');
const security = require('../security');
const { tenantOf } = require('../security/request');
const { isHttpError } = require('../utils/http-error');
const { logger } = require('../utils/logger');

security.protectParams(router);

// Shift Allocation Engine → Shift Rotation. Reading is for any signed-in user (rosters and the employee screens
// show the rotations); adding, editing and deleting need the Attendance module (security/rules.js).

/** Answers an expected failure with its own status and message; anything else is logged and is a plain 500. */
const fail = (res, err, what) => {
  if (isHttpError(err)) return res.status(err.status).json({ success: false, error: err.message });
  logger.error({ err }, `[shift-rotations] ${what} failed`);
  return res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
};

/**
 * A route: validate the input (query or body, the :rotation_id, and the token's company and branch), then run the
 * service. `run` also gets the request, for who is signed in.
 */
const route = ({ schemaName, source = 'query', what, status = 200, run }) => async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema[schemaName], { ...req[source], ...tenantOf(req), ...req.params });
    if (errors) return res.status(400).json({ success: false, errors });
    return res.status(status).json(await run(input, req));
  } catch (err) {
    return fail(res, err, what);
  }
};

// GET /api/shift-rotations?status=active|inactive|all&search=      the list, newest first, each with its days
router.get('/', route({ schemaName: 'shift_rotation_list', what: 'list', run: (i) => service.list(i) }));

// GET /api/shift-rotations/:rotation_id                            Rotation Details + Rotation Pattern + Shift Summary
router.get('/:rotation_id', route({ schemaName: 'shift_rotation_id', what: 'get', run: (i) => service.get(i) }));

// POST /api/shift-rotations   { name, description?, rotation_type: FIXED_CYCLE|CUSTOM, cycle_length, applicable_to?,
//                               effective_from (YYYY-MM-DD or DD-MM-YYYY), is_active?,
//                               days: [{ day_no, shift_template_id | null }] }
router.post('/', route({
  schemaName: 'shift_rotation_create', source: 'body', what: 'create', status: 201,
  // Who added it is the signed-in user, whatever the body says.
  run: (i, req) => service.create({ ...i, created_by: req.auth.userId }),
}));

// PUT /api/shift-rotations/:rotation_id   { version, ...any of the fields above }; the rest stay as they are.
// `version` is the one the screen loaded: a rotation saved by someone else since is a 409.
router.put('/:rotation_id', route({
  schemaName: 'shift_rotation_update', source: 'body', what: 'update',
  run: (i, req) => service.update({ ...i, updated_by: req.auth.userId }),
}));

// DELETE /api/shift-rotations/:rotation_id   switches the rotation off (Inactive); nothing is removed
router.delete('/:rotation_id', route({
  schemaName: 'shift_rotation_id', what: 'delete',
  run: (i, req) => service.remove({ ...i, updated_by: req.auth.userId }),
}));

module.exports = router;
