const { CHECKLIST_TIMEZONE } = require('../config');

const DAY_MS = 24 * 60 * 60 * 1000;

// 'YYYY-MM-DD' for "now" in the checklist timezone (en-CA formats as ISO).
const formatDay = (date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: CHECKLIST_TIMEZONE }).format(date);

exports.todayInZone = () => formatDay(new Date());

// 'YYYY-MM-DD' n days before today in the checklist timezone.
exports.daysAgoInZone = (n) => formatDay(new Date(Date.now() - n * DAY_MS));

// Milliseconds until 00:01 in the checklist timezone (never <= 0).
exports.msUntilNextRun = () => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: CHECKLIST_TIMEZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (type) => Number(parts.find(p => p.type === type).value);
  const elapsed = get('hour') * 3600 + get('minute') * 60 + get('second');
  return (DAY_MS / 1000 - elapsed + 60) * 1000;
};
