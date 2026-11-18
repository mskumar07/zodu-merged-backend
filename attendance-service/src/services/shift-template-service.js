const repo = require('../repository/shift-template-repo');
const { httpError } = require('../utils/http-error');

// Shift templates of a branch: what Shift Allocation Engine lists, adds, edits and "deletes".
//   - a template is never removed: Delete switches it off, because rosters will point at it. Edit can switch it back on;
//   - working hours = shift length - break, worked out here and stored, so the list only reads;
//   - applicability by department is stored but not enforced until the employees have departments.

const PG = { UNIQUE_VIOLATION: '23505', CHECK_VIOLATION: '23514' };
const DAY = 24 * 60;
const IS_ACTIVE = { active: true, inactive: false, all: null };

const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** The rules between fields, checked on the whole row. Fills in is_cross_day and working_minutes. */
function settle(t, { crossDaySent }) {
  const row = { ...t };

  if (row.start_time === row.end_time) throw httpError(400, 'Shift end time must be different from the start time');
  const endsNextDay = row.end_time < row.start_time;            // "HH:mm" strings compare in clock order
  if (!crossDaySent) row.is_cross_day = endsNextDay;
  else if (row.is_cross_day !== endsNextDay) {
    throw httpError(400, endsNextDay
      ? 'The shift ends after midnight: turn on "Cross Day Shift"'
      : 'The shift ends the same day: turn off "Cross Day Shift"');
  }

  const start = minutesOf(row.start_time);
  const length = (minutesOf(row.end_time) - start + DAY) % DAY;   // minutes from start to end, across midnight if needed

  if (!row.break_minutes) {
    row.break_minutes = 0;
    row.break_start = null;                                      // no break: a start time alone means nothing
  } else if (row.break_minutes >= length) {
    throw httpError(400, 'The break must be shorter than the shift');
  } else if (row.break_start) {
    const offset = (minutesOf(row.break_start) - start + DAY) % DAY;   // minutes after the shift starts
    if (offset + row.break_minutes > length) throw httpError(400, 'The break must fall within the shift hours');
  }

  row.working_minutes = length - row.break_minutes;

  if (row.applicable_to === 'DEPARTMENTS') {
    if (!row.department_ids.length) throw httpError(400, 'Select at least one department');
  } else {
    row.department_ids = [];
  }
  return row;
}

/** Turns the database's refusals into answers the screen can show. */
function translate(err, row) {
  if (err.code === PG.UNIQUE_VIOLATION) {
    return err.constraint === 'uq_shift_templates_branch_name'
      ? httpError(409, `Shift template "${row.name}" already exists in this branch`)
      : httpError(409, `Shift code "${row.code}" is already used in this branch`);
  }
  if (err.code === PG.CHECK_VIOLATION) return httpError(400, 'These shift template settings are not allowed');
  return err;
}

const notFound = () => httpError(404, 'Shift template not found');

exports.list = async ({ zodu_id, branch_id, status = 'all', search }) => {
  const items = await repo.list({ zodu_id, branch_id, is_active: IS_ACTIVE[status], search });
  return { success: true, data: items };
};

exports.get = async ({ zodu_id, branch_id, shift_template_id }) => {
  const row = await repo.findById({ zodu_id, branch_id, shift_template_id });
  if (!row) throw notFound();
  return { success: true, data: row };
};

exports.create = async (input) => {
  const row = settle(input, { crossDaySent: input.is_cross_day !== undefined });
  try {
    return { success: true, data: await repo.insert(row) };
  } catch (err) {
    throw translate(err, row);
  }
};

exports.update = async ({ zodu_id, branch_id, shift_template_id, ...change }) => {
  const current = await repo.findById({ zodu_id, branch_id, shift_template_id });
  if (!current) throw notFound();

  // Only what was sent changes. If the times change and Cross Day was not sent, it follows the new times.
  const row = settle({ ...current, ...change, zodu_id, branch_id, shift_template_id },
    { crossDaySent: change.is_cross_day !== undefined });
  try {
    const saved = await repo.update(row);
    if (!saved) throw notFound();          // deleted by someone else in between
    return { success: true, data: saved };
  } catch (err) {
    throw translate(err, row);
  }
};

/** "Delete": the template is switched off, whether or not it has been used. */
exports.remove = async ({ zodu_id, branch_id, shift_template_id }) => {
  const row = await repo.deactivate({ zodu_id, branch_id, shift_template_id });
  if (!row) throw notFound();
  return { success: true, message: 'Shift template deleted. It is now Inactive.', data: row };
};
