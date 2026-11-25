const repo = require('../repository/leave-policy-repo');
const { httpError } = require('../utils/http-error');

// Leave policies of a branch: what Leave → Leave Policy lists, adds, edits and deletes.
//   - the newest policy is first in the list; no policy is created for a branch automatically;
//   - Delete only makes the policy inactive (the row stays in the list as inactive; its name stays taken);
//   - an edit carries the `version` the screen loaded: if someone saved in between it is refused (409) and the
//     screen reloads, so two admins can never overwrite each other;
//   - leave year / carry forward / encashment are settings stored for the policy. The leave balance does not
//     use them yet. Applicability by department is stored too, but is not enforced until the employees have
//     departments.

const PG = { UNIQUE_VIOLATION: '23505', CHECK_VIOLATION: '23514' };

const IS_ACTIVE = { active: true, inactive: false, all: null };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A policy as the screen shows it: the database row plus the texts the screen would otherwise build. */
const toPolicy = (r) => ({
  ...r,
  applicable_label: r.applicable_to === 'ALL' ? 'All Employees' : 'Selected Departments',
  // 1 -> "Jan – Dec", 4 -> "Apr – Mar"
  leave_year_label: `${MONTHS[r.leave_year_start_month - 1]} – ${MONTHS[(r.leave_year_start_month + 10) % 12]}`,
});

/** The rules between fields, checked on the whole row (the form's checkboxes decide which fields count). */
function settle(p) {
  const row = { ...p, description: p.description?.trim() || null };

  if (row.carry_forward) {
    if (!(row.carry_forward_max_days > 0)) throw httpError(400, 'Enter the maximum days that can be carried forward');
  } else {
    row.carry_forward_max_days = 0;          // unticked: whatever was typed there no longer counts
  }

  if (row.encashment) {
    if (!(row.encashment_limit_days > 0)) throw httpError(400, 'Enter the encashment limit in days');
  } else {
    row.encashment_limit_days = 0;
  }

  if (row.applicable_to === 'DEPARTMENTS') {
    if (!row.department_ids.length) throw httpError(400, 'Select at least one department');
  } else {
    row.department_ids = [];
  }
  return row;
}

/** Turns the database's refusals into answers the screen can show. */
function translate(err, name) {
  if (err.code === PG.UNIQUE_VIOLATION) {
    if (err.constraint === 'uq_leave_policies_one_default') {
      return httpError(409, 'Another active policy already applies to all employees. Make it inactive, or apply this one to selected departments');
    }
    return httpError(409, `A policy named "${name}" already exists in this branch`);
  }
  if (err.code === PG.CHECK_VIOLATION) return httpError(400, 'These leave policy settings are not allowed');
  return err;
}

const notFound = () => httpError(404, 'Leave policy not found');
const changedByOther = () => httpError(409, 'This policy was changed by someone else. Reload it and try again');

exports.list = async ({ zodu_id, branch_id, status = 'all', search }) => {
  const rows = await repo.list({ zodu_id, branch_id, is_active: IS_ACTIVE[status], search });
  return { success: true, data: rows.map(toPolicy) };
};

exports.get = async ({ zodu_id, branch_id, policy_id }) => {
  const row = await repo.findById({ zodu_id, branch_id, policy_id });
  if (!row) throw notFound();
  return { success: true, data: toPolicy(row) };
};

exports.create = async (input) => {
  const row = settle(input);
  try {
    return { success: true, message: 'Leave policy added', data: toPolicy(await repo.insert(row)) };
  } catch (err) {
    throw translate(err, row.name);
  }
};

exports.update = async ({ zodu_id, branch_id, policy_id, version, ...change }) => {
  const current = await repo.findById({ zodu_id, branch_id, policy_id });
  if (!current) throw notFound();
  if (current.version !== version) throw changedByOther();          // the quick answer; the write below is the guarantee

  // Only what was sent changes; the rest of the row stays as it is.
  const row = settle({ ...current, ...change, zodu_id, branch_id, policy_id });
  try {
    const saved = await repo.update({ ...row, expected_version: version });
    if (saved) return { success: true, message: 'Leave policy updated', data: toPolicy(saved) };
  } catch (err) {
    throw translate(err, row.name);
  }
  // Nothing was saved: it was deleted, or saved by someone else, between the read and the write.
  throw (await repo.findById({ zodu_id, branch_id, policy_id })) ? changedByOther() : notFound();
};

exports.remove = async ({ zodu_id, branch_id, policy_id }) => {
  if (!(await repo.remove({ zodu_id, branch_id, policy_id }))) throw notFound();
  return { success: true, message: 'Leave policy marked as inactive' };
};
