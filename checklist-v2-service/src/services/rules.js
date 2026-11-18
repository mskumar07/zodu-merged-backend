// Rule engine input: the rules[] a checklist is saved with (§6).
// Either the client sends rules explicitly, or they are derived from the
// form toggles in `settings`. Both paths end in the same validation.
const { badRequest, unprocessable } = require('../utils/errors');

const DEFAULT_TARGET = {
  REMIND_BEFORE_DUE: 'ASSIGNEE',
  NOTIFY_ON_OVERDUE: 'ASSIGNEE',
  ESCALATE_AFTER_OVERDUE: 'REVIEWER',
  AUTO_CLOSE: 'ASSIGNEE',
  NOTIFY_REVIEWER_ON_SUBMIT: 'REVIEWER',
  NOTIFY_ON_COMPLETE: 'CREATOR',
  MISSED_STREAK: 'CREATOR',
};
const USES_OFFSET = new Set(['REMIND_BEFORE_DUE', 'ESCALATE_AFTER_OVERDUE', 'AUTO_CLOSE']);

// §6 "Mapping from the existing form toggles".
function rulesFromSettings(settings, { hasReviewer }) {
  const rules = [];
  if (settings.enable_reminders) {
    rules.push({ rule_type: 'REMIND_BEFORE_DUE', offset_min: 15 });
    rules.push({ rule_type: 'NOTIFY_ON_OVERDUE' });
    rules.push({ rule_type: 'ESCALATE_AFTER_OVERDUE', offset_min: 60 });
  }
  if (settings.auto_close) rules.push({ rule_type: 'AUTO_CLOSE', offset_min: settings.auto_close_after_min ?? 0 });
  if (hasReviewer) rules.push({ rule_type: 'NOTIFY_REVIEWER_ON_SUBMIT' });
  if (settings.notify_on_complete) rules.push({ rule_type: 'NOTIFY_ON_COMPLETE' });
  if (settings.missed_streak_alert) rules.push({ rule_type: 'MISSED_STREAK', threshold: 3 });
  return rules;
}

// Fills defaults and applies the §6 validation that needs no database.
// → normalised rules; CUSTOM employee ids are checked by the caller.
function normalizeRules(input, { schedule }) {
  if (input.length > 10) throw badRequest('At most 10 rules per checklist', 'TOO_MANY_RULES');
  const rules = input.map((r) => {
    const target = r.target || DEFAULT_TARGET[r.rule_type];
    return {
      rule_type: r.rule_type,
      offset_min: USES_OFFSET.has(r.rule_type) ? (r.offset_min ?? 0) : 0,
      threshold: r.rule_type === 'MISSED_STREAK' ? (r.threshold ?? 3) : null,
      target,
      target_employee_ids: target === 'CUSTOM' ? [...new Set(r.target_employee_ids || [])] : [],
      channels: [...new Set(r.channels?.length ? r.channels : ['IN_APP'])],
      is_active: r.is_active !== false,
    };
  });

  const seen = new Set();
  for (const r of rules) {
    const key = `${r.rule_type}|${r.offset_min}|${r.target}`;
    if (seen.has(key)) throw badRequest(`Duplicate rule ${r.rule_type} (offset ${r.offset_min}, target ${r.target})`, 'DUPLICATE_RULE');
    seen.add(key);
    if (r.target === 'CUSTOM' && !r.target_employee_ids.length) {
      throw badRequest(`${r.rule_type}: CUSTOM target needs target_employee_ids`, 'VALIDATION_FAILED');
    }
  }

  const active = rules.filter((r) => r.is_active);
  const hourly = schedule.task_type === 'RECURRING' && schedule.frequency === 'HOURLY';
  for (const r of active.filter((x) => x.rule_type === 'REMIND_BEFORE_DUE')) {
    if (r.offset_min < 5 || r.offset_min > 1440) {
      throw unprocessable('Reminder lead time must be 5–1440 minutes', 'INVALID_REMINDER_OFFSET');
    }
    if (hourly && r.offset_min >= schedule.every_n * 60) {
      throw unprocessable(`Reminder lead time must be under ${schedule.every_n * 60} minutes for this hourly checklist`, 'INVALID_REMINDER_OFFSET');
    }
  }
  const autoClose = active.filter((r) => r.rule_type === 'AUTO_CLOSE');
  if (autoClose.length > 1) throw unprocessable('Only one auto-close rule per checklist', 'DUPLICATE_RULE');
  const escalations = active.filter((r) => r.rule_type === 'ESCALATE_AFTER_OVERDUE');
  if (autoClose.length) {
    const close = autoClose[0].offset_min;
    const late = escalations.find((e) => e.offset_min >= close);
    if (late) {
      throw unprocessable(
        `Auto close (after ${close} min) must come after escalation (after ${late.offset_min} min), or the run closes before it can escalate`,
        'AUTO_CLOSE_BEFORE_ESCALATION',
      );
    }
  }
  if (active.some((r) => r.rule_type === 'MISSED_STREAK') && !autoClose.length) {
    throw unprocessable('Missed-streak alerts need an auto-close rule (runs only become missed through auto close)', 'STREAK_NEEDS_AUTO_CLOSE');
  }
  return rules;
}

module.exports = { rulesFromSettings, normalizeRules, DEFAULT_TARGET };
