const express = require('express');
const router = express.Router();
const service = require('../services/leave-policy-service');
const schema = require('../schema/leave-policy-schema');
const RequestValidator = require('../utils/requestValidator');
const security = require('../security');
const { tenantOf } = require('../security/request');
const { isHttpError } = require('../utils/http-error');
const { logger } = require('../utils/logger');

security.protectParams(router);

// Leave → Leave Policy. Reading is for any signed-in user; adding, editing and deleting need the Settings module
// (security/rules.js).

/** Answers an expected failure with its own status and message; anything else is logged and is a plain 500. */
const fail = (res, err, what) => {
  if (isHttpError(err)) return res.status(err.status).json({ success: false, error: err.message });
  logger.error({ err }, `[leave-policies] ${what} failed`);
  return res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
};

/**
 * A route: validate the input (query or body, the :policy_id, and the token's company and branch), then run the
 * service. `status` is the answer's status when it is not 200. `run` also gets the request, for who is signed in.
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

// GET /api/leave-policies?status=active|inactive|all&search=      the left-hand list, newest first, full configuration
router.get('/', route({ schemaName: 'leave_policy_list', what: 'list', run: (i) => service.list(i) }));

// GET /api/leave-policies/:policy_id                              Leave Policy Details
router.get('/:policy_id', route({ schemaName: 'leave_policy_id', what: 'get', run: (i) => service.get(i) }));

// POST /api/leave-policies   { name, description?, is_active?, applicable_to?, department_ids?, annual_entitlement?,
//                              leave_year_start_month?, carry_forward?, carry_forward_max_days?, encashment?,
//                              encashment_limit_days? }
router.post('/', route({
  schemaName: 'leave_policy_create', source: 'body', what: 'create', status: 201,
  // Who added it is the signed-in user, whatever the body says.
  run: (i, req) => service.create({ ...i, created_by: req.auth.userId }),
}));

// PUT /api/leave-policies/:policy_id   { version, ...any of the fields above }; the rest stay as they are.
// `version` is the one the screen loaded: a policy saved by someone else since is a 409.
router.put('/:policy_id', route({ schemaName: 'leave_policy_update', source: 'body', what: 'update', run: (i) => service.update(i) }));

// DELETE /api/leave-policies/:policy_id      removes the policy from the list
router.delete('/:policy_id', route({ schemaName: 'leave_policy_id', what: 'delete', run: (i) => service.remove(i) }));

module.exports = router;
