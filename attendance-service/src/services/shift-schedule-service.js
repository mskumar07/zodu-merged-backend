const repo = require('../repository/shift-schedule-repo');
const templateRepo = require('../repository/shift-template-repo');
const directory = require('../clients/employee-directory');
const { httpError } = require('../utils/http-error');
const { istToday } = require('../utils/ist');

// The shift schedule of a branch: what Shift Allocation Engine → Schedule Shifts shows and saves.
//   - the grid is employees x dates for a period of up to 31 days; the employees come from employee-service (the cached
//     roster) and are paged, the scheduled cells from tbl_shift_assignments. A cell with no entry is "not scheduled yet";
//     an OFF cell is scheduled with no shift;
//   - Assign Shifts saves only the cells that changed, all or nothing. Past days can't be changed. Every cell carries
//     the version the screen loaded: a cell someone else changed since is refused (409, with the cells listed);
//   - the company's Admin (the owner's own employee record, named "Admin") is not scheduled: it is left out of the grid
//     and refused by Assign Shifts, the same rule as employee-service's attendance dashboard (name != 'Admin');
//   - leave and holidays are not checked: a shift can be assigned on those days;
//   - Auto Schedule and Copy Schedule are not part of this yet (rows are marked source = 'MANUAL').

const MAX_DAYS = 31;
const DAY_MS = 86_400_000;

const utc = (iso) => new Date(`${iso}T00:00:00Z`);
const isoOf = (d) => d.toISOString().slice(0, 10);

/** Every date from `from` to `to` as the grid's column headers. */
function datesBetween(from, to, today) {
  const out = [];
  for (let t = utc(from).getTime(); t <= utc(to).getTime(); t += DAY_MS) {
    const d = new Date(t);
    const date = isoOf(d);
    out.push({
      date,
      weekday: d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),                    // "Mon"
      day_label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),   // "Nov 23"
      is_today: date === today,
      is_past: date < today,                                                                            // can't be edited
    });
  }
  return out;
}

/** The company's Admin record (not a scheduled employee). */
const isAdmin = (e) => String(e.name ?? '').trim().toLowerCase() === 'admin';

const initialsOf = (name) => String(name || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');

/** A cell as the grid shows it. */
const toCell = (c) => ({
  shift_template_id: c.shift_template_id,
  code: c.shift_template_id ? c.code : 'OFF',
  is_off: c.shift_template_id === null,
  shift_is_active: c.shift_template_id ? c.is_active : true,
  version: c.version,
});

exports.list = async ({ zodu_id, branch_id, from, to, search, page = 1, limit = 50 }) => {
  if (to < from) throw httpError(400, 'The period must end on or after its start');
  const dates = datesBetween(from, to, istToday());
  if (dates.length > MAX_DAYS) throw httpError(400, `The period can be at most ${MAX_DAYS} days`);

  // Active employees, searched by name or code, in name order (the roster comes sorted), then the page asked for.
  const needle = search ? search.trim().toLowerCase() : '';
  const people = (await directory.roster({ zodu_id, branch_id })).filter((e) =>
    e.status === 'active' && !isAdmin(e) && (!needle || `${e.name} ${e.employee_code ?? ''}`.toLowerCase().includes(needle)));
  const total = people.length;
  const pageRows = people.slice((page - 1) * limit, page * limit);

  const [cells, templates] = await Promise.all([
    repo.cells({ zodu_id, branch_id, employee_ids: pageRows.map((e) => e.employee_id), from, to }),
    templateRepo.list({ zodu_id, branch_id, is_active: true }),
  ]);

  const byEmployee = new Map();
  for (const c of cells) {
    if (!byEmployee.has(c.employee_id)) byEmployee.set(c.employee_id, {});
    byEmployee.get(c.employee_id)[c.work_date] = toCell(c);
  }

  return {
    success: true,
    data: {
      period: { from, to, days: dates.length },
      dates,
      // The legend and the dropdown of every cell: the active shift templates (OFF is added by the screen).
      shifts: templates.map((t) => ({
        shift_template_id: t.shift_template_id, code: t.code, name: t.name,
        time_label: `${t.start_time_label} – ${t.end_time_label}`,
      })),
      employees: pageRows.map((e) => ({
        employee_id: e.employee_id,
        employee_code: e.employee_code,
        name: e.name,
        initials: initialsOf(e.name),
        reporting_manager_name: e.reporting_manager_name ?? null,
        days: byEmployee.get(e.employee_id) ?? {},      // { "2026-11-23": { code, version, ... } }; a missing date = not scheduled
      })),
      pagination: { page, limit, total, total_pages: Math.max(1, Math.ceil(total / limit)) },
    },
  };
};

// ── MY SHIFT SCHEDULE (the employee's "Myself" view) ─────────────────────────────────────────────────────────────

const UPCOMING_DAYS = 14;
const addDays = (iso, n) => isoOf(new Date(utc(iso).getTime() + n * DAY_MS));
const hoursLabel = (min) => `${Math.floor(min / 60)}h${min % 60 ? ` ${String(min % 60).padStart(2, '0')}m` : ''}`;
const weekdayOf = (iso) => utc(iso).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
const longDate = (iso) => utc(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** A scheduled day as the screen shows it. A day with no row is "not scheduled yet". */
function toMyDay(date, row, today) {
  const base = { date, weekday: weekdayOf(date), is_today: date === today, is_past: date < today };
  if (!row) return { ...base, is_scheduled: false, is_off: false, shift_template_id: null, code: null, name: null, time_label: null };
  if (!row.shift_template_id) {
    return { ...base, is_scheduled: true, is_off: true, shift_template_id: null, code: 'OFF', name: 'Off / Rest Day', time_label: null };
  }
  return {
    ...base, is_scheduled: true, is_off: false,
    shift_template_id: row.shift_template_id, code: row.code, name: row.name,
    time_label: `${row.start_time_label} – ${row.end_time_label}`,
  };
}

/** The shift card: times and break of one day. */
const toShiftCard = (day, row) => ({
  ...day,
  start_time_label: row?.start_time_label ?? null,
  end_time_label: row?.end_time_label ?? null,
  break_label: row?.break_label ?? null,
  break_minutes: row?.break_minutes ?? 0,
  working_hours_label: row?.shift_template_id ? hoursLabel(row.working_minutes) : null,
});

/**
 * The signed-in employee's own schedule for a month: today's shift, the next 14 days, the month's calendar and its
 * totals, in one call and one query. `month` is "YYYY-MM" (default: this month in India). One range covers the
 * month and the upcoming days, so crossing into next month needs no second query.
 */
exports.my = async ({ zodu_id, branch_id, employee, month }) => {
  if (!employee) throw httpError(404, 'No employee record for this user');
  if (employee.status && employee.status !== 'active') throw httpError(403, 'Your employee record is inactive');

  const today = istToday();
  const ym = month || today.slice(0, 7);
  const monthStart = `${ym}-01`;
  const [y, m] = ym.split('-').map(Number);
  const monthEnd = isoOf(new Date(Date.UTC(y, m, 0)));          // day 0 of next month = last day of this one
  const upcomingEnd = addDays(today, UPCOMING_DAYS);

  const rows = await repo.myDays({
    zodu_id, branch_id, employee_id: employee.employee_id,
    from: monthStart < today ? monthStart : today,
    to: monthEnd > upcomingEnd ? monthEnd : upcomingEnd,
  });
  const byDate = new Map(rows.map((r) => [r.work_date, r]));

  // Calendar and totals for the month.
  const days = [];
  const tally = new Map();          // shift code -> { code, name, days }
  let offDays = 0;
  let minutes = 0;
  for (let d = monthStart; d <= monthEnd; d = addDays(d, 1)) {
    const row = byDate.get(d);
    days.push(toMyDay(d, row, today));
    if (!row) continue;
    if (!row.shift_template_id) { offDays += 1; continue; }
    minutes += row.working_minutes;
    const t = tally.get(row.code) ?? { shift_template_id: row.shift_template_id, code: row.code, name: row.name, days: 0 };
    t.days += 1;
    tally.set(row.code, t);
  }

  // Next 14 days, starting tomorrow. Days with nothing scheduled are left out.
  const upcoming = [];
  for (let i = 1; i <= UPCOMING_DAYS; i++) {
    const d = addDays(today, i);
    if (byDate.has(d)) upcoming.push(toMyDay(d, byDate.get(d), today));
  }

  // The rotation that produced today's shift; failing that, the latest one in the window.
  const rotRow = byDate.get(today)?.rotation_id ? byDate.get(today) : [...rows].reverse().find((r) => r.rotation_id);
  const todayRow = byDate.get(today);

  return {
    success: true,
    data: {
      today: toShiftCard(toMyDay(today, todayRow, today), todayRow),
      rotation: rotRow ? {
        rotation_id: rotRow.rotation_id,
        name: rotRow.rotation_name,
        type: rotRow.rotation_type,
        type_label: rotRow.rotation_type === 'FIXED_CYCLE' ? 'Fixed Cycle' : 'Custom Pattern',
        cycle_length: rotRow.cycle_length,
        cycle_label: `${rotRow.cycle_length} Days`,
        effective_from: rotRow.rotation_effective_from,
        effective_from_label: longDate(rotRow.rotation_effective_from),
      } : null,                                              // scheduled by hand: no rotation
      month: { month: ym, from: monthStart, to: monthEnd, first_weekday: weekdayOf(monthStart) },
      days,
      summary: {
        by_shift: [...tally.values()],                        // the legend: Morning 9 days, Evening 8 days ...
        off_days: offDays,
        scheduled_minutes: minutes,
        scheduled_hours_label: hoursLabel(minutes),
      },
      upcoming,
    },
  };
};

exports.assign = async ({ zodu_id, branch_id, changes, updated_by }) => {
  const today = istToday();

  const seen = new Set();
  for (const c of changes) {
    if (c.work_date < today) throw httpError(400, 'Past dates cannot be changed');
    const key = `${c.employee_id}|${c.work_date}`;
    if (seen.has(key)) throw httpError(400, 'The same employee and date is listed twice');
    seen.add(key);
  }

  // Everyone must be an active employee of this branch, and every shift an active template of this branch.
  const roster = new Map((await directory.roster({ zodu_id, branch_id })).map((e) => [e.employee_id, e]));
  for (const c of changes) {
    const e = roster.get(c.employee_id);
    if (!e || isAdmin(e)) throw httpError(400, 'An employee in the request does not belong to this branch');
    if (e.status !== 'active') throw httpError(400, `${e.name} is not an active employee`);
  }
  const ids = [...new Set(changes.map((c) => c.shift_template_id).filter(Boolean))];
  const templates = new Map((await repo.findTemplates({ zodu_id, branch_id, ids })).map((t) => [t.shift_template_id, t]));
  for (const id of ids) {
    const t = templates.get(id);
    if (!t) throw httpError(400, 'One of the selected shifts does not exist in this branch');
    if (!t.is_active) throw httpError(400, `Shift "${t.name}" is inactive. Choose an active shift`);
  }

  const cells = changes.map((c) => ({ ...c, version: c.version ?? 0 }));
  const saved = await repo.assign({ zodu_id, branch_id, cells, updated_by });
  if (saved) {
    return {
      success: true,
      message: `${saved.length} shift${saved.length === 1 ? '' : 's'} assigned`,
      // The new versions, so the screen can keep editing without reloading.
      data: {
        updated: saved.length,
        cells: saved.map((r) => ({
          employee_id: r.employee_id, work_date: r.work_date, shift_template_id: r.shift_template_id,
          code: r.shift_template_id ? templates.get(r.shift_template_id)?.code : 'OFF', version: r.version,
        })),
      },
    };
  }

  // Nothing was saved: some cells changed under the screen. Say which, with what they are now.
  const current = new Map((await repo.currentCells({ zodu_id, branch_id, cells }))
    .map((r) => [`${r.employee_id}|${r.work_date}`, r]));
  const conflicts = cells
    .filter((c) => (current.get(`${c.employee_id}|${c.work_date}`)?.version ?? 0) !== c.version)
    .map((c) => {
      const now = current.get(`${c.employee_id}|${c.work_date}`);
      return {
        employee_id: c.employee_id, work_date: c.work_date,
        current: now ? { shift_template_id: now.shift_template_id, code: now.shift_template_id ? now.code : 'OFF', version: now.version } : null,
      };
    });
  throw httpError(409, 'Some shifts were changed by someone else. Reload the schedule and try again', conflicts);
};
