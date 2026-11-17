const db = require('../database/connection');
const repo = require('../repository/leave-repo');
const { httpError } = require('../utils/http-error');
const { istToday } = require('../utils/ist');
const { parseHolidaySheet } = require('../utils/holiday-sheet');

// Leave management. Who may do what:
//   - an employee applies for, previews and cancels (while Pending) their own leave;
//   - the employee's reporting manager approves or rejects it (the company Admin can too, so a request
//     of someone with no manager never waits for nobody); nobody decides their own request;
//   - holidays are loaded by an Admin from an Excel sheet and are visible to everyone.

const PG = { EXCLUSION_VIOLATION: '23P01', CHECK_VIOLATION: '23514' };

const yearOf = (date) => Number(date.slice(0, 4));
const currentYear = () => yearOf(istToday());
const pageOf = ({ page = 1, limit }) => ({ limit, offset: (Math.max(Number(page) || 1, 1) - 1) * limit });

const paged = (rows, page, limit) => ({
  items: rows.map(({ total, ...row }) => row),
  pagination: { total: rows[0]?.total ?? 0, page: Number(page) || 1, limit, pages: Math.ceil((rows[0]?.total ?? 0) / limit) },
});

/** The signed-in user's employee record, which every "my leave" action needs. */
function requireEmployee(employee) {
  if (!employee) throw httpError(404, 'No employee record for this user');
  if (employee.status && employee.status !== 'active') throw httpError(403, 'Your employee record is inactive');
  return employee;
}

// ── Own leave ────────────────────────────────────────────────────────────────

const toBalance = (r) => ({
  leave_type_id: r.leave_type_id,
  code:          r.code,
  name:          r.name,
  entitlement:   r.entitlement,
  availed:       r.availed,
  pending:       r.pending,
  balance:       Math.max(r.entitlement - r.availed - r.pending, 0),
});

exports.getBalances = async ({ zodu_id, branch_id, employee, year = currentYear() }) => {
  requireEmployee(employee);
  const rows = await repo.findBalances({ zodu_id, branch_id, employee_id: employee.employee_id, year });
  return { success: true, data: { year, balances: rows.map(toBalance) } };
};

// The Leave screen in one round trip: balances, the holidays still to come, and the latest requests.
const UPCOMING_HOLIDAYS = 5;
const RECENT_LEAVES = 5;

exports.getSummary = async ({ zodu_id, branch_id, employee, year = currentYear() }) => {
  requireEmployee(employee);
  const today = istToday();
  // "Upcoming" is from today on, within the year (a future year: from its first day; a past year: none).
  const from = year > yearOf(today) ? `${year}-01-01` : today;

  const [balances, holidays, recent] = await Promise.all([
    repo.findBalances({ zodu_id, branch_id, employee_id: employee.employee_id, year }),
    year < yearOf(today)
      ? []
      : repo.findHolidays({ zodu_id, branch_id, from, to: `${year + 1}-01-01`, limit: UPCOMING_HOLIDAYS }),
    repo.listMyLeaves({ employee_id: employee.employee_id, year, limit: RECENT_LEAVES, offset: 0 }),
  ]);

  return {
    success: true,
    data: {
      year,
      balances: balances.map(toBalance),
      holidays,
      recent: { items: recent.map(({ total, ...row }) => row), total: recent[0]?.total ?? 0 },
    },
  };
};

exports.listMyLeaves = async ({ employee, year = currentYear(), page = 1, limit }) => {
  requireEmployee(employee);
  const { offset } = pageOf({ page, limit });
  const rows = await repo.listMyLeaves({ employee_id: employee.employee_id, year, limit, offset });
  return { success: true, data: paged(rows, page, limit) };
};

exports.listHolidays = async ({ zodu_id, branch_id, year = currentYear(), upcoming = false }) => {
  const from = upcoming ? (yearOf(istToday()) === year ? istToday() : `${year}-01-01`) : `${year}-01-01`;
  const items = await repo.findHolidays({ zodu_id, branch_id, from, to: `${year + 1}-01-01`, limit: 400 });
  return { success: true, data: { year, items } };
};

/** Rules every request must meet, before the database sees it. */
function checkDates({ from_date, to_date }) {
  if (to_date < from_date) throw httpError(400, 'The end date is before the start date');
  if (from_date < istToday()) throw httpError(400, 'Leave cannot start on a past date');
  if (yearOf(from_date) !== yearOf(to_date)) {
    throw httpError(400, 'A leave cannot run across two years. Apply for each year separately.');
  }
}

exports.previewLeave = async ({ zodu_id, branch_id, employee, from_date, to_date }) => {
  requireEmployee(employee);
  checkDates({ from_date, to_date });
  const { days, overlaps } = await repo.previewDays({ zodu_id, branch_id, employee_id: employee.employee_id, from_date, to_date });
  return { success: true, data: { days, overlaps } };
};

exports.applyLeave = async ({ zodu_id, branch_id, employee, leave_type_id, from_date, to_date, reason }) => {
  requireEmployee(employee);
  checkDates({ from_date, to_date });

  let row;
  try {
    row = await repo.insertRequest({ zodu_id, branch_id, employee_id: employee.employee_id, leave_type_id, from_date, to_date, reason });
  } catch (err) {
    if (err.code === PG.EXCLUSION_VIOLATION) throw httpError(409, 'You already have leave on some of these dates');
    if (err.code === PG.CHECK_VIOLATION) throw httpError(400, 'These dates have no working day (Sundays and holidays are not counted)');
    throw err;
  }
  if (!row) throw httpError(404, 'Leave type not found');
  return { success: true, data: row };
};

exports.cancelLeave = async ({ zodu_id, branch_id, employee, leave_request_id }) => {
  requireEmployee(employee);
  if (await repo.cancelOwnPending({ leave_request_id, employee_id: employee.employee_id })) {
    return { success: true, data: { leave_request_id, status: 'Cancelled' } };
  }
  // Not cancelled: say why (someone else's request looks the same as a missing one).
  const found = await repo.findOwnerAndStatus({ leave_request_id, zodu_id, branch_id });
  if (!found || found.employee_id !== employee.employee_id) throw httpError(404, 'Leave request not found');
  throw httpError(409, `Only a Pending request can be cancelled (this one is ${found.status})`);
};

// ── Team ─────────────────────────────────────────────────────────────────────

/** Who is asking: their employee id (null if they have none) and whether they are the company Admin. */
function callerScope({ employee, isOwner }) {
  if (!employee && !isOwner) throw httpError(403, 'No employee record for this user');
  return { caller_id: employee?.employee_id ?? null, is_owner: Boolean(isOwner) };
}

exports.listPending = async ({ zodu_id, branch_id, employee, isOwner, search, page = 1, limit }) => {
  const scope = callerScope({ employee, isOwner });
  const { offset } = pageOf({ page, limit });
  const rows = await repo.listPending({ zodu_id, branch_id, ...scope, search, limit, offset });
  return { success: true, data: paged(rows, page, limit) };
};

exports.listTeamLeaves = async ({ zodu_id, branch_id, employee, isOwner, year = currentYear(), search, leave_type, status, page = 1, limit }) => {
  const scope = callerScope({ employee, isOwner });
  const { offset } = pageOf({ page, limit });
  const rows = await repo.listTeamLeaves({ zodu_id, branch_id, ...scope, year, search, leave_type, status, limit, offset });
  return { success: true, data: paged(rows, page, limit) };
};

/**
 * Approve or reject one or many requests. Only requests the caller may decide are changed; the
 * answer says how many were, and which ids were left alone (not theirs, not Pending, or not found).
 * An approval is written into attendance in the same transaction.
 */
exports.decide = async ({ zodu_id, branch_id, employee, isOwner, userId, ids, decision, note }) => {
  const scope = callerScope({ employee, isOwner });
  const decided_by = employee?.employee_id ?? userId;
  const decided_by_name = employee?.name ?? '-';

  const client = await db.connect();
  let updated;
  try {
    await client.query('BEGIN');
    updated = await repo.decide(client, {
      ids, zodu_id, branch_id, decision, note, decided_by, decided_by_name,
      caller_id: scope.caller_id, is_owner: scope.is_owner,
    });
    if (decision === 'Approved' && updated.length) {
      await repo.writeLeaveAttendance(client, { ids: updated, decided_by, decided_by_name });
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  if (!updated.length) throw httpError(409, 'None of these requests can be decided by you (they are not Pending, or not for your team)');
  const done = new Set(updated);
  return { success: true, data: { decision, updated: updated.length, ids: updated, skipped: ids.filter((id) => !done.has(id)) } };
};

// ── Holidays (Excel upload) ──────────────────────────────────────────────────

exports.importHolidays = async ({ zodu_id, branch_id, created_by, buffer }) => {
  const { rows, errors } = await parseHolidaySheet(buffer);
  if (errors.length) throw httpError(400, 'The sheet has errors. Nothing was saved.', errors);

  const { inserted, updated } = await repo.upsertHolidays({ zodu_id, branch_id, created_by, rows });
  return { success: true, data: { total: rows.length, inserted, updated } };
};
