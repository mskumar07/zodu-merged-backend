const repo = require('../repository/shift-rotation-repo');
const { httpError } = require('../utils/http-error');
const { istToday } = require('../utils/ist');

// Shift rotations of a branch: what Shift Allocation Engine → Shift Rotation lists, adds, edits and "deletes".
//   - the newest rotation is first in the list;
//   - a rotation is never removed: Delete switches it off (Inactive), Edit can switch it back on, and its name stays taken;
//   - Effective From can be today or a later day, never a past one (an edit that leaves the date alone is not asked again);
//   - an edit carries the `version` the screen loaded: if someone saved in between it is refused (409) and the
//     screen reloads, so two admins can never overwrite each other;
//   - switching a shift template off is allowed; the rotation that uses it shows a warning (`warnings`, and the day's
//     `shift_is_active: false`) so the admin replaces it. A shift that is switched off can't be picked for a day;
//   - applicability by department is stored, but only "All Employees" is accepted until the departments exist.

const PG = { UNIQUE_VIOLATION: '23505', FK_VIOLATION: '23503', CHECK_VIOLATION: '23514' };
const IS_ACTIVE = { active: true, inactive: false, all: null };
const TYPE_LABEL = { FIXED_CYCLE: 'Rotational (Fixed Cycle)', CUSTOM: 'Custom Pattern' };

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A rotation as the screen shows it: the row plus every text and count the screen would otherwise work out. */
function toRotation(r) {
  const days = r.days.map((d) => ({
    day_no: d.day_no,
    week_no: Math.ceil(d.day_no / 7),                     // "W1 / Week 1", "W2 / Week 2" … 7 days to a row
    is_off: d.shift_template_id === null,
    shift_template_id: d.shift_template_id,
    code: d.shift_template_id ? d.code : 'OFF',
    shift_name: d.shift_template_id ? d.name : 'Off / Rest Day',
    shift_is_active: d.shift_template_id ? d.is_active : true,
  }));

  // Shift Summary: one entry per shift in the order it first appears, then the rest days.
  const summary = new Map();
  const inactive = new Map();
  for (const d of r.days) {
    const key = d.shift_template_id ?? 'OFF';
    const entry = summary.get(key) ?? (summary.set(key, d.shift_template_id
      ? { shift_template_id: d.shift_template_id, code: d.code, name: d.name, time_label: `${d.start_time_label} – ${d.end_time_label}`, is_off: false, days: 0 }
      : { shift_template_id: null, code: 'OFF', name: 'Off / Rest Day', time_label: 'No work', is_off: true, days: 0 }).get(key));
    entry.days += 1;
    entry.days_label = plural(entry.days, 'day');
    if (d.shift_template_id && d.is_active === false) inactive.set(d.shift_template_id, { shift_template_id: d.shift_template_id, code: d.code, name: d.name });
  }
  const summaryList = [...summary.values()].sort((a, b) => Number(a.is_off) - Number(b.is_off));

  const off = days.filter((d) => d.is_off).length;
  const inactive_shifts = [...inactive.values()];

  return {
    ...r,
    days,
    rotation_type_label: TYPE_LABEL[r.rotation_type],
    pattern_label: plural(r.cycle_length, 'Day'),                   // "7 Days"
    applicable_label: r.applicable_to === 'ALL' ? 'All Employees' : 'Selected Departments',
    working_days: days.length - off,
    off_days: off,
    working_label: `${days.length - off} working · ${off} off`,     // "5 working · 2 off"
    shift_summary: summaryList,
    inactive_shifts,
    warnings: inactive_shifts.map((s) => `Shift "${s.name}" is inactive. Replace it in this rotation.`),
  };
}

/** The days must be exactly Day 1 … Day cycle_length, each once, with at least one working day. */
function checkDays(days, cycle_length) {
  if (days.length !== cycle_length) {
    throw httpError(400, `The pattern has ${days.length} days but the cycle length is ${cycle_length}`);
  }
  const sorted = [...days].sort((a, b) => a.day_no - b.day_no);
  sorted.forEach((d, i) => {
    if (d.day_no !== i + 1) throw httpError(400, `The pattern must have each day from Day 1 to Day ${cycle_length} once`);
  });
  if (sorted.every((d) => d.shift_template_id === null)) throw httpError(400, 'Select a shift for at least one day');
  return sorted;
}

/** Every shift named must be an active shift template of this branch. */
async function checkShifts({ zodu_id, branch_id }, days) {
  const ids = [...new Set(days.map((d) => d.shift_template_id).filter(Boolean))];
  const found = new Map((await repo.findTemplates({ zodu_id, branch_id, ids })).map((t) => [t.shift_template_id, t]));
  for (const id of ids) {
    const t = found.get(id);
    if (!t) throw httpError(400, 'One of the selected shifts does not exist in this branch');
    if (!t.is_active) throw httpError(400, `Shift "${t.name}" is inactive. Choose an active shift`);
  }
}

const checkEffectiveFrom = (date) => {
  if (date < istToday()) throw httpError(400, 'Effective From must be today or a later date');
};

/** Turns the database's refusals into answers the screen can show. */
function translate(err, name) {
  if (err.code === PG.UNIQUE_VIOLATION) return httpError(409, `A rotation named "${name}" already exists in this branch`);
  if (err.code === PG.FK_VIOLATION) return httpError(400, 'One of the selected shifts does not exist');
  if (err.code === PG.CHECK_VIOLATION) return httpError(400, 'These rotation settings are not allowed');
  return err;
}

const notFound = () => httpError(404, 'Shift rotation not found');
const changedByOther = () => httpError(409, 'This rotation was changed by someone else. Reload it and try again');

exports.list = async ({ zodu_id, branch_id, status = 'all', search }) => {
  const rows = await repo.list({ zodu_id, branch_id, is_active: IS_ACTIVE[status], search });
  return { success: true, data: rows.map(toRotation) };
};

exports.get = async ({ zodu_id, branch_id, rotation_id }) => {
  const row = await repo.findById({ zodu_id, branch_id, rotation_id });
  if (!row) throw notFound();
  return { success: true, data: toRotation(row) };
};

exports.create = async (input) => {
  const row = { ...input, department_ids: [] };           // only All Employees for now
  checkEffectiveFrom(row.effective_from);
  row.days = checkDays(row.days, row.cycle_length);
  await checkShifts(row, row.days);
  try {
    return { success: true, message: 'Shift rotation added', data: toRotation(await repo.insert(row)) };
  } catch (err) {
    throw translate(err, row.name);
  }
};

exports.update = async ({ zodu_id, branch_id, rotation_id, version, updated_by, ...change }) => {
  const current = await repo.findById({ zodu_id, branch_id, rotation_id });
  if (!current) throw notFound();
  if (current.version !== version) throw changedByOther();          // the quick answer; the write below is the guarantee

  // Only what was sent changes; the rest of the row stays as it is.
  const { days: _currentDays, ...saved } = current;
  const row = { ...saved, ...change, zodu_id, branch_id, rotation_id, updated_by, department_ids: [] };

  if (change.effective_from !== undefined && change.effective_from !== current.effective_from) {
    checkEffectiveFrom(change.effective_from);
  }
  if (change.days) {
    row.days = checkDays(change.days, row.cycle_length);
    await checkShifts(row, row.days);
  } else if (row.cycle_length !== current.cycle_length) {
    throw httpError(400, 'The cycle length changed: send the pattern (days) for the new length');
  }

  try {
    const result = await repo.update({ ...row, expected_version: version });
    if (result) return { success: true, message: 'Shift rotation updated', data: toRotation(result) };
  } catch (err) {
    throw translate(err, row.name);
  }
  // Nothing was saved: someone else saved between the read and the write.
  throw changedByOther();
};

/** "Delete": the rotation is switched off. */
exports.remove = async ({ zodu_id, branch_id, rotation_id, updated_by }) => {
  const row = await repo.deactivate({ zodu_id, branch_id, rotation_id, updated_by });
  if (!row) throw notFound();
  return { success: true, message: 'Shift rotation deleted. It is now Inactive.', data: toRotation(row) };
};
