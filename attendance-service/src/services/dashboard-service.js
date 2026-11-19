const repo      = require('../repository/dashboard-repo');
const leaveRepo = require('../repository/leave-repo');
const { istToday } = require('../utils/ist');

// "My Attendance" dashboard in one response: the week's check-in / check-out log with its summary
// cards, the month calendar, leave balances and the upcoming holidays. The three queries run in
// parallel and the response is shaped for display (labels, counts, hours), so the screen only renders.

const UPCOMING_HOLIDAYS = 5;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── Date helpers: "YYYY-MM-DD" strings, calculated in UTC so the server's zone never shifts a day ──
const toDate = (s) => new Date(`${s}T00:00:00Z`);
const toIso  = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return toIso(d); };
const pad = (n) => String(n).padStart(2, '0');
const monthStart = (year, month) => `${year}-${pad(month)}-01`;
const nextMonthStart = (year, month) => (month === 12 ? monthStart(year + 1, 1) : monthStart(year, month + 1));
const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const mondayOf = (s) => addDays(s, -((toDate(s).getUTCDay() + 6) % 7));
const shortDate = (s) => `${Number(s.slice(8))} ${MONTHS[Number(s.slice(5, 7)) - 1]}`;

const hours = (minutes) => Math.round((minutes / 60) * 100) / 100;
const hoursText = (minutes) => (minutes == null ? null : `${hours(minutes).toFixed(2)} hrs`);

const toBalance = (r) => ({
  leave_type_id: r.leave_type_id,
  code:      r.code,
  name:      r.name,
  available: Math.max(r.entitlement - r.availed - r.pending, 0),
  used:      r.availed,
});

exports.getDashboard = async ({ zodu_id, branch_id, employee, week_start, month, year }) => {
  const today = istToday();
  const wStart = mondayOf(week_start || today);       // weeks run Monday to Sunday
  const wEnd = addDays(wStart, 6);
  const calYear = year || Number(today.slice(0, 4));
  const calMonth = month || Number(today.slice(5, 7));
  const mStart = monthStart(calYear, calMonth);
  const mEnd = nextMonthStart(calYear, calMonth);     // exclusive

  const [rows, balances, holidays] = await Promise.all([
    repo.findDays({
      zodu_id, branch_id, employee_id: employee.employee_id,
      from: wStart < mStart ? wStart : mStart,
      to: addDays(wEnd, 1) > mEnd ? addDays(wEnd, 1) : mEnd,
    }),
    leaveRepo.findBalances({ zodu_id, branch_id, employee_id: employee.employee_id, year: Number(today.slice(0, 4)) }),
    repo.findUpcomingHolidays({ zodu_id, branch_id, from: today, limit: UPCOMING_HOLIDAYS }),
  ]);

  const byDate = new Map(rows.map((r) => [r.date, r]));

  // ── Week log ──
  let present = 0, expected = 0, absent = 0, loggedMinutes = 0, loggedDays = 0;
  const log = [];
  for (let i = 0; i < 7; i += 1) {
    const date = addDays(wStart, i);
    const r = byDate.get(date);
    // Only what is stored: a day nobody marked (any weekday, Sunday included) has no status.
    const status = r?.status ?? null;

    // Days the employee was expected to work: marked days other than weekly offs.
    if (status && status !== 'Weekly Off') expected += 1;
    if (status === 'Present') present += 1;
    if (status === 'Absent') absent += 1;
    if (r?.working_minutes) { loggedMinutes += r.working_minutes; loggedDays += 1; }

    log.push({
      date,
      day: WEEKDAYS[toDate(date).getUTCDay()],
      label: `${WEEKDAYS[toDate(date).getUTCDay()]}, ${shortDate(date)}`,   // "Mon, 16 Nov"
      is_today: date === today,
      status,
      check_in_time: r?.check_in_time ?? null,      // "09:07 AM"
      check_out_time: r?.check_out_time ?? null,
      log_hours: r?.working_minutes ? hours(r.working_minutes) : null,
      log_hours_text: hoursText(r?.working_minutes),   // "9.00 hrs"
    });
  }

  // ── Month calendar ──
  const total = daysInMonth(calYear, calMonth);
  const calendarDays = [];
  for (let d = 1; d <= total; d += 1) {
    const date = `${calYear}-${pad(calMonth)}-${pad(d)}`;
    calendarDays.push({
      date,
      day: d,
      is_today: date === today,
      status: byDate.get(date)?.status ?? null,
    });
  }

  return {
    success: true,
    data: {
      today,
      week: {
        start: wStart,
        end: wEnd,
        prev_start: addDays(wStart, -7),
        next_start: addDays(wStart, 7),
        label: `${shortDate(wStart)} – ${shortDate(wEnd)} ${wEnd.slice(0, 4)}`,   // "16 Nov – 22 Nov 2026"
      },
      summary: {
        days_present: present,
        working_days: expected,                       // marked days this week that were not a weekly off
        absent_days: absent,
        avg_log_hours: loggedDays ? hours(loggedMinutes / loggedDays) : 0,
        total_log_hours: hours(loggedMinutes),
        avg_log_hours_text: `${(loggedDays ? hours(loggedMinutes / loggedDays) : 0).toFixed(2)} hrs`,
        total_log_hours_text: `${hours(loggedMinutes).toFixed(2)} hrs`,
      },
      log,
      calendar: {
        year: calYear,
        month: calMonth,
        label: `${MONTHS[calMonth - 1]} ${calYear}`,   // "Nov 2026"
        first_weekday: toDate(mStart).getUTCDay(),     // 0 = Sunday: blank cells before day 1
        days: calendarDays,
      },
      leave_balances: balances.map(toBalance),
      upcoming_holidays: holidays,
    },
  };
};

// ── Manager / Admin dashboard ─────────────────────────────────────────────────
// The team's week at a glance: the week's counts (cards + donut), the employees' log for that week,
// the attendance trend (the same week, or the month, per the Weekly / Monthly toggle) and the leave
// requests waiting for the caller. The repo answers it all in one query; this shapes it for display.
// The week filter (date arrows) drives the cards, donut and log; the toggle changes only the trend.

const PENDING_LISTED = 5;
const pct = (n, of) => (of ? Math.round((1000 * n) / of) / 10 : 0);   // one decimal: 80.8

// Identical requests that arrive together (a dashboard reloaded by many managers, a double click)
// share one database query. Nothing is kept once it finishes, so nothing can be stale.
const inFlight = new Map();
const shared = (key, work) => {
  if (inFlight.has(key)) return inFlight.get(key);
  const p = work().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
};

exports.getTeamDashboard = ({ zodu_id, branch_id, user_id, is_owner, date, view = 'weekly', search, page = 1, limit = 10 }) => {
  const today = istToday();
  const anchor = date || today;
  const monthly = view === 'monthly';

  // The week (Monday to Sunday) holding the chosen date: cards, donut and log.
  const week_from = mondayOf(anchor);
  const week_to = addDays(week_from, 7);                         // exclusive
  const weekEnd = addDays(week_from, 6);

  // The trend: that week, or the month holding the chosen date.
  const trend_from = monthly ? `${anchor.slice(0, 7)}-01` : week_from;
  const trend_to = monthly ? nextMonthStart(Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7))) : week_to;

  const offset = (Math.max(page, 1) - 1) * limit;
  const key = JSON.stringify([zodu_id, branch_id, user_id, is_owner, week_from, view, trend_from, search || '', page, limit]);

  return shared(key, async () => {
    const r = await repo.findTeamDashboard({
      zodu_id, branch_id, user_id, is_owner, week_from, week_to, trend_from, trend_to,
      search, limit, offset, pending_limit: PENDING_LISTED, today,
    });

    const total = r.total_employees;
    const c = r.range_counts;

    // ONE formula for the donut, the cards and every trend point:
    //   attendance % = Present / (Present + Absent + On Leave)
    // counted in person-days. Weekly offs and days nobody has marked are left out: nobody was expected
    // to work, or it isn't known yet. (Same basis as working_days / attendance_pct in /my.)
    const expectedOf = (x) => x.present + x.absent + x.on_leave;
    const expected = expectedOf(c);

    // Every day of the trend range, so the chart has its axis; a day with nothing marked yet
    // (or still to come) has a null rate.
    const byDate = new Map(r.trend.map((t) => [t.date, t]));
    const points = [];
    for (let d = trend_from; d < trend_to; d = addDays(d, 1)) {
      const t = byDate.get(d);
      const exp = t ? expectedOf(t) : 0;
      points.push({
        date: d,
        day: WEEKDAYS[toDate(d).getUTCDay()],
        label: shortDate(d),                                  // "16 Nov"
        present: t?.present ?? 0,
        absent: t?.absent ?? 0,
        on_leave: t?.on_leave ?? 0,
        attendance_pct: exp ? pct(t.present, exp) : null,
      });
    }

    return {
      success: true,
      data: {
        today,
        // The week filter: send prev_date / next_date back as `date` for its arrows.
        week: {
          start: week_from,
          end: weekEnd,
          label: `${shortDate(week_from)} – ${shortDate(weekEnd)} ${weekEnd.slice(0, 4)}`,   // "16 Nov – 22 Nov 2026"
          prev_date: addDays(week_from, -7),
          next_date: week_to,
        },
        // The week's counts in person-days: "present: 98" is 98 employee-days.
        // days_counted is how many days of the week are in it (none of the days still to come are).
        summary: {
          total_employees: total,
          days_counted: Math.max(Math.round((toDate(week_to <= today ? weekEnd : today) - toDate(week_from)) / 86400000) + 1, 0),
          present:    { count: c.present,  pct: pct(c.present, expected) },
          absent:     { count: c.absent,   pct: pct(c.absent, expected) },
          on_leave:   { count: c.on_leave, pct: pct(c.on_leave, expected) },
          weekly_off: c.weekly_off,
          attendance_pct: pct(c.present, expected),           // the donut's centre
        },
        trend: {
          view,
          label: monthly
            ? `${MONTHS[Number(trend_from.slice(5, 7)) - 1]} ${trend_from.slice(0, 4)}`    // "Nov 2026"
            : `${shortDate(week_from)} – ${shortDate(weekEnd)} ${weekEnd.slice(0, 4)}`,
          points,
        },
        // The week's attendance records, newest day first, then by name (only days that were marked).
        log: {
          items: r.log.map(({ working_minutes, attendance_date, ...row }) => ({
            ...row,
            attendance_date,                                   // "2026-11-19"
            date: shortDate(attendance_date),                  // "19 Nov"
            log_hours: working_minutes == null ? null : hours(working_minutes),
            log_hours_text: hoursText(working_minutes),        // "8.83 hrs"
          })),
          pagination: { total: r.log_total, page, limit, pages: Math.ceil(r.log_total / limit) },
        },
        leave_approvals: {
          pending_total: r.pending_total,
          items: r.pending.map(({ sort_from, sort_applied, ...row }) => row),
        },
      },
    };
  });
};
