// Joi schemas. Field names match the database columns; enum values are
// UPPER_SNAKE (the frontend maps them to labels). Cross-field schedule rules
// mirror recurrenceErrors() in zodu-checklist's recurrence.ts (§8.3 step 1).
const Joi = require('joi');
const { badRequest } = require('../utils/errors');

const uuid = Joi.string().guid({ version: ['uuidv4', 'uuidv5', 'uuidv7', 'uuidv1'], separator: '-' }).lowercase();
const anyUuid = Joi.string().pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i).lowercase();
const hhmm = Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/).message('{#label} must be HH:MM');
const ymd = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).custom((v, h) => {
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? h.error('date.base') : v;
}).messages({ 'date.base': '{#label} must be a real date (YYYY-MM-DD)' });
const text = (max) => Joi.string().trim().max(max);

const RULE_TYPES = ['REMIND_BEFORE_DUE', 'NOTIFY_ON_OVERDUE', 'ESCALATE_AFTER_OVERDUE', 'AUTO_CLOSE',
  'NOTIFY_REVIEWER_ON_SUBMIT', 'NOTIFY_ON_COMPLETE', 'MISSED_STREAK'];
const TARGETS = ['ASSIGNEE', 'REVIEWER', 'CREATOR', 'CUSTOM'];
const CHANNELS = ['IN_APP', 'WEB_PUSH', 'EMAIL'];
const NOTIFICATION_TYPES = ['RUN_REMINDER', 'RUN_OVERDUE', 'RUN_ESCALATED', 'RUN_SUBMITTED', 'RUN_APPROVED',
  'RUN_REJECTED', 'RUN_COMPLETED', 'RUN_REASSIGNED', 'MISSED_STREAK', 'CHECKLIST_ASSIGNED'];
const BOARD_STATUSES = ['TODO', 'IN_PROGRESS', 'OVERDUE', 'COMPLETED'];
const FREQUENCIES = ['HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'ONE_TIME'];

const schedule = Joi.object({
  task_type: Joi.string().valid('ONCE', 'RECURRING').required(),
  frequency: Joi.string().valid('HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY').allow(null),
  every_n: Joi.number().integer().min(1).max(99).default(1),
  all_day: Joi.boolean().default(false),
  window_start: hhmm.allow(null),
  window_end: hhmm.allow(null),
  weekdays_only: Joi.boolean().default(false),
  weekdays: Joi.array().items(Joi.number().integer().min(0).max(6)).unique().max(7).default([]),
  monthly_by: Joi.string().valid('DAY', 'WEEKDAY').allow(null),
  month_day: Joi.number().integer().min(1).max(31).allow(null),
  nth: Joi.number().integer().valid(1, 2, 3, 4, -1).allow(null),
  nth_weekday: Joi.number().integer().min(0).max(6).allow(null),
  trigger_time: hhmm.allow(null),
  start_date: ymd.required(),
  ends: Joi.string().valid('NEVER', 'AFTER', 'ON_DATE').default('NEVER'),
  max_occurrences: Joi.number().integer().min(1).max(999).allow(null),
  end_date: ymd.allow(null),
});

const toMinutes = (t) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

// Cross-field checks + normalisation: fields the chosen pattern doesn't use are
// cleared, so the stored row satisfies the table's CHECK constraints and two
// equal recurrences compare equal. → { value } | throws 400 with details.
function normalizeSchedule(input) {
  const { value: s, error } = schedule.validate(input, { abortEarly: false, stripUnknown: true });
  if (error) throw badRequest('Invalid schedule', 'VALIDATION_FAILED', error.details.map((d) => d.message));
  const errors = [];
  const recurring = s.task_type === 'RECURRING';
  const hourly = recurring && s.frequency === 'HOURLY';
  if (recurring && !s.frequency) errors.push('"schedule.frequency" is required for a recurring checklist');
  if (!hourly && !s.trigger_time) errors.push('"schedule.trigger_time" is required');
  if (hourly) {
    if (s.every_n > 23) errors.push('"schedule.every_n" must be at most 23 for hourly checklists');
    if (!s.all_day) {
      if (!s.window_start || !s.window_end) errors.push('"schedule.window_start" and "window_end" are required unless all_day');
      else if (toMinutes(s.window_end) <= toMinutes(s.window_start)) errors.push('"schedule.window_end" must be after "window_start"');
    }
  }
  if (recurring && s.frequency === 'WEEKLY' && !s.weekdays.length) errors.push('"schedule.weekdays" needs at least one day');
  if (recurring && s.frequency === 'MONTHLY') {
    if (s.monthly_by === 'DAY' && !s.month_day) errors.push('"schedule.month_day" is required');
    else if (s.monthly_by === 'WEEKDAY' && (s.nth == null || s.nth_weekday == null)) errors.push('"schedule.nth" and "nth_weekday" are required');
    else if (!s.monthly_by) errors.push('"schedule.monthly_by" is required for monthly checklists');
  }
  if (recurring && s.ends === 'AFTER' && !s.max_occurrences) errors.push('"schedule.max_occurrences" is required when ends is AFTER');
  if (recurring && s.ends === 'ON_DATE') {
    if (!s.end_date) errors.push('"schedule.end_date" is required when ends is ON_DATE');
    else if (s.end_date < s.start_date) errors.push('"schedule.end_date" must not be before start_date');
  }
  if (errors.length) throw badRequest('Invalid schedule', 'VALIDATION_FAILED', errors);

  const freq = recurring ? s.frequency : null;
  const t = (v) => (v ? `${v.slice(0, 5)}:00` : null);
  return {
    task_type: s.task_type,
    frequency: freq,
    every_n: recurring ? s.every_n : 1,
    all_day: hourly ? s.all_day : false,
    window_start: hourly && !s.all_day ? t(s.window_start) : null,
    window_end: hourly && !s.all_day ? t(s.window_end) : null,
    weekdays_only: freq === 'DAILY' ? s.weekdays_only : false,
    weekdays: freq === 'WEEKLY' ? [...s.weekdays].sort((a, b) => a - b) : [],
    monthly_by: freq === 'MONTHLY' ? s.monthly_by : null,
    month_day: freq === 'MONTHLY' && s.monthly_by === 'DAY' ? s.month_day : null,
    nth: freq === 'MONTHLY' && s.monthly_by === 'WEEKDAY' ? s.nth : null,
    nth_weekday: freq === 'MONTHLY' && s.monthly_by === 'WEEKDAY' ? s.nth_weekday : null,
    trigger_time: hourly ? null : t(s.trigger_time),
    start_date: s.start_date,
    ends: recurring ? s.ends : 'NEVER',
    max_occurrences: recurring && s.ends === 'AFTER' ? s.max_occurrences : null,
    end_date: recurring && s.ends === 'ON_DATE' ? s.end_date : null,
  };
}

const RECURRENCE_FIELDS = ['task_type', 'frequency', 'every_n', 'all_day', 'window_start', 'window_end',
  'weekdays_only', 'weekdays', 'monthly_by', 'month_day', 'nth', 'nth_weekday', 'trigger_time',
  'start_date', 'ends', 'max_occurrences', 'end_date'];

const rule = Joi.object({
  rule_type: Joi.string().valid(...RULE_TYPES).required(),
  offset_min: Joi.number().integer().min(0).max(10080).default(0),
  threshold: Joi.number().integer().min(2).max(30).allow(null),
  target: Joi.string().valid(...TARGETS),
  target_employee_ids: Joi.array().items(anyUuid).unique().max(50).default([]),
  channels: Joi.array().items(Joi.string().valid(...CHANNELS)).unique().min(1).default(['IN_APP']),
  is_active: Joi.boolean().default(true),
});

const task = Joi.object({
  title: text(300).min(1).required(),
  instructions: text(2000).allow('', null),
  require_photo: Joi.boolean().default(false),
  allow_notes: Joi.boolean().default(true),
  // reference files uploaded through POST /checklists/task-files
  attachments: Joi.array().items(Joi.object({ id: anyUuid.required() }).unknown(true)).max(5).default([]),
});

const checklistBody = {
  name: text(150).min(1).required(),
  description: text(2000).allow('', null),
  category_id: anyUuid.allow(null),
  priority: Joi.string().valid('HIGH', 'MEDIUM', 'LOW').default('MEDIUM'),
  timezone: Joi.string().max(64),
  schedule: Joi.object().required(),
  assign_mode: Joi.string().valid('ALL', 'SPECIFIC').required(),
  assignee_employee_ids: Joi.array().items(anyUuid).unique().max(500).default([])
    .when('assign_mode', { is: 'SPECIFIC', then: Joi.array().min(1) }),
  reviewer_employee_id: anyUuid.allow(null).default(null),
  settings: Joi.object({
    require_photo: Joi.boolean().default(true),
    allow_partial: Joi.boolean().default(true),
    allow_notes: Joi.boolean().default(true),
    // Ignored: the company's settings (GET/PUT /api/settings) decide these and the
    // rules for every checklist. Still accepted so older clients keep working.
    // Used only when `rules` is not sent (§6 "Mapping from the existing form toggles").
    enable_reminders: Joi.boolean().default(false),
    auto_close: Joi.boolean().default(false),
    auto_close_after_min: Joi.number().integer().min(0).max(10080).default(0),
    notify_on_complete: Joi.boolean().default(false),
    missed_streak_alert: Joi.boolean().default(false),
  }).default(),
  rules: Joi.array().items(rule).max(10),
  tasks: Joi.array().items(task).min(1).max(50).required(),
};

const createChecklist = Joi.object(checklistBody);
const updateChecklist = Joi.object({
  ...checklistBody,
  row_version: Joi.number().integer().min(1).required(),
  apply_from: Joi.string().valid('TOMORROW', 'NOW').default('TOMORROW'),
});

const schedulePreview = Joi.object({
  schedule: Joi.object().required(),
  from: ymd,
  count: Joi.number().integer().min(1).max(50).default(5),
});

// Company-wide checklist settings (Settings page). No CUSTOM targets: employees
// belong to one branch, the settings to the whole company.
const companySettings = Joi.object({
  require_photo: Joi.boolean().required(),
  allow_partial: Joi.boolean().required(),
  allow_notes: Joi.boolean().required(),
  rules: Joi.array().items(rule.keys({
    target: Joi.string().valid('ASSIGNEE', 'REVIEWER', 'CREATOR'),
    target_employee_ids: Joi.array().max(0).default([]),
  })).max(10).required(),
  row_version: Joi.number().integer().min(0).required(),
});

const checklistStatus = Joi.object({ status: Joi.string().valid('ACTIVE', 'PAUSED', 'ARCHIVED').required() });

const listChecklists = Joi.object({
  status: Joi.string().valid('ACTIVE', 'PAUSED', 'ARCHIVED'),
  category_id: anyUuid,
  priority: Joi.string().valid('HIGH', 'MEDIUM', 'LOW'),
  frequency: Joi.string().valid(...FREQUENCIES),
  search: text(100).allow(''),
  cursor: Joi.string().max(500),
  limit: Joi.number().integer().min(1).max(200).default(50),
});

const createCategory = Joi.object({
  name: text(60).min(1).required(),
  color: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).default('#1D4ED8'),
  icon: Joi.string().pattern(/^[A-Za-z0-9]{1,40}$/).allow(null),
  sort_order: Joi.number().integer().min(0).max(1000).default(100),
});

const updateCategory = Joi.object({
  name: text(60).min(1),
  color: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/),
  icon: Joi.string().pattern(/^[A-Za-z0-9]{1,40}$/),
  sort_order: Joi.number().integer().min(0).max(1000),
}).min(1);

const listRuns = Joi.object({
  date: ymd,
  from: ymd,
  to: ymd,
  view: Joi.string().valid('my', 'team').default('my'),
  employee_id: anyUuid,
  status: Joi.string().valid(...BOARD_STATUSES),
  priority: Joi.string().valid('HIGH', 'MEDIUM', 'LOW'),
  category_id: anyUuid,
  checklist_id: anyUuid,
  frequency: Joi.string().valid(...FREQUENCIES),
  search: text(100).allow(''),
  cursor: Joi.string().max(500),
  limit: Joi.number().integer().min(1).max(500).default(500),
}).oxor('date', 'from').and('from', 'to');

// sub_status_id: one of the company's task statuses; null clears it. Not with is_done: true.
const updateItem = Joi.object({
  is_done: Joi.boolean(),
  note: text(1000).allow('', null),
  sub_status_id: anyUuid.allow(null),
}).or('is_done', 'note', 'sub_status_id')
  .custom((v, h) => (v.is_done === true && v.sub_status_id ? h.error('any.invalid') : v))
  .messages({ 'any.invalid': 'A task is either done or has a status, not both' });

// Task sub-statuses (Settings): a name, a colour, and whether it closes the task.
const hexColor = Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/);
const createTaskStatus = Joi.object({
  name: text(40).min(1).required(),
  color: hexColor.default('#2563EB'),
  closes_task: Joi.boolean().default(false),
  sort_order: Joi.number().integer().min(0).max(1000).default(100),
});
const updateTaskStatus = Joi.object({
  name: text(40).min(1),
  color: hexColor,
  closes_task: Joi.boolean(),
  sort_order: Joi.number().integer().min(0).max(1000),
}).min(1);

const versioned = Joi.object({ row_version: Joi.number().integer().min(1).required() });
const review = Joi.object({
  decision: Joi.string().valid('APPROVE', 'REJECT').required(),
  comment: text(1000).allow('', null)
    .when('decision', { is: 'REJECT', then: Joi.string().trim().min(1).required() }),
  row_version: Joi.number().integer().min(1).required(),
});
const reassign = Joi.object({ employee_id: anyUuid.required(), row_version: Joi.number().integer().min(1).required() });

const dashboardRange = Joi.object({ from: ymd, to: ymd }).and('from', 'to');

const listNotifications = Joi.object({
  unread_only: Joi.boolean().default(false),
  cursor: Joi.string().max(500),
  limit: Joi.number().integer().min(1).max(50).default(20),
});
const readAll = Joi.object({ before: Joi.date().iso() });

const preferences = Joi.object({
  settings: Joi.object({
    timezone: Joi.string().max(64),
    quiet_start: hhmm.allow(null),
    quiet_end: hhmm.allow(null),
    muted_until: Joi.date().iso().allow(null),
  }).default({}),
  preferences: Joi.array().items(Joi.object({
    type: Joi.string().valid(...NOTIFICATION_TYPES).required(),
    channel: Joi.string().valid(...CHANNELS).required(),
    enabled: Joi.boolean().required(),
  })).max(NOTIFICATION_TYPES.length * CHANNELS.length).default([]),
});

// Validates and returns the value; 400 with every message otherwise.
function validate(schemaObj, input, { label = 'request' } = {}) {
  const { value, error } = schemaObj.validate(input ?? {}, { abortEarly: false, stripUnknown: true, convert: true });
  if (error) throw badRequest(`Invalid ${label}`, 'VALIDATION_FAILED', error.details.map((d) => d.message));
  return value;
}

module.exports = {
  validate, normalizeSchedule, RECURRENCE_FIELDS,
  createChecklist, updateChecklist, schedulePreview, checklistStatus, listChecklists, createCategory, updateCategory,
  companySettings, createTaskStatus, updateTaskStatus, listRuns, updateItem, versioned, review, reassign, dashboardRange,
  listNotifications, readAll, preferences,
  RULE_TYPES, TARGETS, CHANNELS, NOTIFICATION_TYPES, uuid,
};
