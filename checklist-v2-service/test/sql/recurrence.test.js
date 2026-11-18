// fn_preview_occurrences against the shared vectors (§13.2), via the same
// normalisation the API applies (schema.normalizeSchedule).
const { pool } = require('../helpers/db');
const { normalizeSchedule } = require('../../src/schema');
const { previewOccurrences } = require('../../src/services/checklists');
const { vectors } = require('../fixtures/recurrence-vectors.json');

afterAll(() => pool.end());

test.each(vectors.map((v) => [v.name, v]))('%s', async (_name, v) => {
  const rule = normalizeSchedule(v.rule);
  const got = await previewOccurrences(rule, v.from, v.count);
  expect(got).toEqual(v.expected);
});

test('the schedule table accepts every normalised vector rule (CHECK constraints)', async () => {
  for (const v of vectors) {
    const s = normalizeSchedule(v.rule);
    const cols = Object.keys(s);
    await pool.query('BEGIN');
    try {
      await pool.query(
        `INSERT INTO ckl.checklists (zodu_id, branch_id, code, name, assign_mode, created_by_user_id, created_by_name)
         VALUES ('ZV', 'B1', 'CL-V', 'v', 'ALL', gen_random_uuid(), 'v')`,
      );
      await pool.query(
        `INSERT INTO ckl.checklist_schedules (checklist_id, ${cols.join(', ')})
         SELECT id, ${cols.map((k, i) => (k === 'weekdays' ? `$${i + 1}::smallint[]` : `$${i + 1}`)).join(', ')}
           FROM ckl.checklists WHERE zodu_id = 'ZV'`,
        cols.map((k) => s[k]),
      );
    } finally {
      await pool.query('ROLLBACK');
    }
  }
});

describe('normalizeSchedule mirrors recurrenceErrors()', () => {
  const base = { task_type: 'RECURRING', frequency: 'DAILY', trigger_time: '09:00', start_date: '2026-11-16' };
  const bad = (patch) => () => normalizeSchedule({ ...base, ...patch });
  test.each([
    ['recurring without frequency', { frequency: null }],
    ['no trigger time', { trigger_time: null }],
    ['hourly window end before start', { frequency: 'HOURLY', window_start: '13:00', window_end: '09:00' }],
    ['hourly every 24', { frequency: 'HOURLY', all_day: true, every_n: 24 }],
    ['weekly without days', { frequency: 'WEEKLY', weekdays: [] }],
    ['monthly without pattern', { frequency: 'MONTHLY' }],
    ['monthly nth without weekday', { frequency: 'MONTHLY', monthly_by: 'WEEKDAY', nth: 2 }],
    ['after without count', { ends: 'AFTER' }],
    ['end date before start', { ends: 'ON_DATE', end_date: '2026-11-01' }],
    ['not a real date', { start_date: '2026-02-30' }],
  ])('%s → 400', (_n, patch) => {
    expect(bad(patch)).toThrow(expect.objectContaining({ status: 400 }));
  });

  test('fields the pattern does not use are cleared', () => {
    const s = normalizeSchedule({ ...base, weekdays: [1, 2], month_day: 5, window_start: '08:00', ends: 'NEVER', max_occurrences: 9 });
    expect(s).toMatchObject({ weekdays: [], month_day: null, window_start: null, max_occurrences: null, trigger_time: '09:00:00' });
  });
});
