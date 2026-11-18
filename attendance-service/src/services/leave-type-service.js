const repo = require('../repository/leave-type-repo');
const { httpError } = require('../utils/http-error');
const { istToday } = require('../utils/ist');

// Leave types of a branch: what the Leave Settings screen lists, adds, edits and "deletes".
//   - a type is never removed: Delete switches it off, because leave requests point at it;
//   - a switched-off type can no longer be applied for, and shows as Inactive. Edit can switch it back on;
//   - paid / carry forward / encashment / effective-from are settings stored for the types. The leave balance
//     only uses annual_days today. Applicability by department is stored too, but is not enforced until the
//     employees have departments.

const PG = { UNIQUE_VIOLATION: '23505', CHECK_VIOLATION: '23514' };

const IS_ACTIVE = { active: true, inactive: false, all: null };

/** The rules between fields, checked on the whole row (the form's checkboxes decide which fields count). */
function settle(t) {
  const row = { ...t };

  if (row.carry_forward) {
    if (!(row.carry_forward_max_days > 0)) throw httpError(400, 'Enter the maximum days that can be carried forward');
  } else {
    row.carry_forward_max_days = 0;        // unticked: whatever was typed there no longer counts
  }

  if (row.applicable_to === 'DEPARTMENTS') {
    if (!row.department_ids.length) throw httpError(400, 'Select at least one department');
  } else {
    row.department_ids = [];
  }
  return row;
}

/** Turns the database's refusals into answers the screen can show. */
function translate(err, code) {
  if (err.code === PG.UNIQUE_VIOLATION) return httpError(409, `Leave code "${code}" is already used in this branch`);
  if (err.code === PG.CHECK_VIOLATION) return httpError(400, 'These leave type settings are not allowed');
  return err;
}

const notFound = () => httpError(404, 'Leave type not found');

exports.list = async ({ zodu_id, branch_id, status = 'all', search }) => {
  const items = await repo.list({ zodu_id, branch_id, is_active: IS_ACTIVE[status], search });
  return { success: true, data: items };
};

exports.get = async ({ zodu_id, branch_id, leave_type_id }) => {
  const row = await repo.findById({ zodu_id, branch_id, leave_type_id });
  if (!row) throw notFound();
  return { success: true, data: row };
};

exports.create = async (input) => {
  const row = settle({ ...input, effective_from: input.effective_from ?? `${istToday().slice(0, 4)}-01-01` });
  try {
    return { success: true, data: await repo.insert(row) };
  } catch (err) {
    throw translate(err, row.code);
  }
};

exports.update = async ({ zodu_id, branch_id, leave_type_id, ...change }) => {
  const current = await repo.findById({ zodu_id, branch_id, leave_type_id });
  if (!current) throw notFound();

  // Only what was sent changes; the rest of the row stays as it is.
  const row = settle({ ...current, ...change, zodu_id, branch_id, leave_type_id });
  try {
    const saved = await repo.update(row);
    if (!saved) throw notFound();          // deleted by someone else in between
    return { success: true, data: saved };
  } catch (err) {
    throw translate(err, row.code);
  }
};

/** "Delete": the type is switched off, whether or not it has been used. */
exports.remove = async ({ zodu_id, branch_id, leave_type_id }) => {
  const row = await repo.deactivate({ zodu_id, branch_id, leave_type_id });
  if (!row) throw notFound();
  return { success: true, message: 'Leave type deleted. It is now Inactive.', data: row };
};
