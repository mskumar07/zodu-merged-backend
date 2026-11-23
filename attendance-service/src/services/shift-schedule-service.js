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
