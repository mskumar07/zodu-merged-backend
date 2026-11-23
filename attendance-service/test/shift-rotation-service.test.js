// The rules of a shift rotation, with the repository replaced.
jest.mock('../src/repository/shift-rotation-repo', () => ({
  list: jest.fn(), findById: jest.fn(), findTemplates: jest.fn(),
  insert: jest.fn(async (r) => ({ ...r, version: 1, days: [] })), update: jest.fn(), deactivate: jest.fn(),
}));

const repo = require('../src/repository/shift-rotation-repo');
const service = require('../src/services/shift-rotation-service');

const T = { zodu_id: 'Z001', branch_id: 'B1' };
const ID = '9f0a1c2e-0000-4000-8000-000000000000';
const M = '11111111-1111-4111-8111-111111111111';
const E = '22222222-2222-4222-8222-222222222222';
const FUTURE = '2099-01-01';

const pattern = (ids) => ids.map((shift_template_id, i) => ({ day_no: i + 1, shift_template_id }));
const create = {
  ...T, name: 'Support Rotation', description: '', rotation_type: 'FIXED_CYCLE', cycle_length: 7, applicable_to: 'ALL',
  effective_from: FUTURE, is_active: true, days: pattern([M, M, M, E, E, null, null]),
};

beforeEach(() => {
  jest.clearAllMocks();
  repo.findTemplates.mockResolvedValue([
    { shift_template_id: M, name: 'Morning Shift', is_active: true },
    { shift_template_id: E, name: 'Evening Shift', is_active: true },
  ]);
});

describe('create', () => {
  test('saves a valid pattern', async () => {
    await service.create(create);
    expect(repo.insert).toHaveBeenCalledWith(expect.objectContaining({ cycle_length: 7, department_ids: [] }));
  });

  test('Effective From in the past is refused, today or later is fine', async () => {
    await expect(service.create({ ...create, effective_from: '2000-01-01' })).rejects.toMatchObject({ status: 400 });
    expect(repo.insert).not.toHaveBeenCalled();
  });

  test('the days must match the cycle length and be Day 1..N', async () => {
    await expect(service.create({ ...create, cycle_length: 10 })).rejects.toMatchObject({ status: 400 });
    const dup = [...create.days]; dup[6] = { day_no: 1, shift_template_id: null };
    await expect(service.create({ ...create, days: dup })).rejects.toMatchObject({ status: 400 });
  });

  test('a rotation of only rest days is refused', async () => {
    await expect(service.create({ ...create, cycle_length: 2, days: pattern([null, null]) })).rejects.toMatchObject({ status: 400 });
  });

  test('an inactive or unknown shift cannot be picked', async () => {
    repo.findTemplates.mockResolvedValue([{ shift_template_id: M, name: 'Morning Shift', is_active: false }, { shift_template_id: E, name: 'Evening Shift', is_active: true }]);
    await expect(service.create(create)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/Morning Shift.*inactive/) });
    repo.findTemplates.mockResolvedValue([]);
    await expect(service.create(create)).rejects.toMatchObject({ status: 400 });
  });

  test('a name already used is a 409', async () => {
    repo.insert.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    await expect(service.create(create)).rejects.toMatchObject({ status: 409 });
  });
});

describe('what the screen shows', () => {
  const row = (days, extra = {}) => ({ rotation_id: ID, ...T, name: 'S', cycle_length: days.length, rotation_type: 'FIXED_CYCLE', applicable_to: 'ALL', version: 1, days, ...extra });
  const d = (n, id, code, name, active = true) => ({ day_no: n, shift_template_id: id, code, name, start_time_label: '09:00 AM', end_time_label: '05:00 PM', is_active: active });

  test('counts, labels, summary and weeks', async () => {
    const days = [d(1, M, 'M', 'Morning Shift'), d(2, M, 'M', 'Morning Shift'), d(3, E, 'E', 'Evening Shift'),
      d(4, null), d(5, null), d(6, null), d(7, null), d(8, M, 'M', 'Morning Shift')];
    repo.findById.mockResolvedValue(row(days));
    const { data } = await service.get({ ...T, rotation_id: ID });
    expect(data.working_label).toBe('4 working · 4 off');
    expect(data.pattern_label).toBe('8 Days');
    expect(data.days[7].week_no).toBe(2);
    expect(data.shift_summary.map((s) => [s.code, s.days])).toEqual([['M', 3], ['E', 1], ['OFF', 4]]);
    expect(data.warnings).toEqual([]);
  });

  test('a switched-off shift shows a warning on the rotation', async () => {
    repo.findById.mockResolvedValue(row([d(1, M, 'M', 'Morning Shift', false), d(2, null)]));
    const { data } = await service.get({ ...T, rotation_id: ID });
    expect(data.warnings).toEqual(['Shift "Morning Shift" is inactive. Replace it in this rotation.']);
    expect(data.days[0].shift_is_active).toBe(false);
  });
});

describe('update', () => {
  const current = { rotation_id: ID, ...T, name: 'S', description: '', rotation_type: 'FIXED_CYCLE', cycle_length: 7, applicable_to: 'ALL',
    effective_from: '2000-01-01', is_active: true, version: 3, days: [] };

  test('a stale version is a 409 and nothing is written', async () => {
    repo.findById.mockResolvedValue(current);
    await expect(service.update({ ...T, rotation_id: ID, version: 2, name: 'X' })).rejects.toMatchObject({ status: 409 });
    expect(repo.update).not.toHaveBeenCalled();
  });

  test('losing the race at the write is a 409', async () => {
    repo.findById.mockResolvedValue(current);
    repo.update.mockResolvedValue(null);
    await expect(service.update({ ...T, rotation_id: ID, version: 3, name: 'X' })).rejects.toMatchObject({ status: 409 });
  });

  test('an old Effective From that is left alone is not asked again; a new past one is refused', async () => {
    repo.findById.mockResolvedValue(current);
    repo.update.mockResolvedValue({ ...current, days: [] });
    await service.update({ ...T, rotation_id: ID, version: 3, name: 'X' });
    expect(repo.update.mock.calls[0][0]).toMatchObject({ expected_version: 3 });
    expect(repo.update.mock.calls[0][0].days).toBeUndefined();
    await expect(service.update({ ...T, rotation_id: ID, version: 3, effective_from: '2001-01-01' })).rejects.toMatchObject({ status: 400 });
  });

  test('a new cycle length needs the new pattern', async () => {
    repo.findById.mockResolvedValue(current);
    await expect(service.update({ ...T, rotation_id: ID, version: 3, cycle_length: 14 })).rejects.toMatchObject({ status: 400 });
  });
});

describe('delete', () => {
  test('switches off; unknown is 404', async () => {
    repo.deactivate.mockResolvedValue({ rotation_id: ID, cycle_length: 1, version: 2, applicable_to: 'ALL', rotation_type: 'CUSTOM', days: [] });
    expect((await service.remove({ ...T, rotation_id: ID })).success).toBe(true);
    repo.deactivate.mockResolvedValue(null);
    await expect(service.remove({ ...T, rotation_id: ID })).rejects.toMatchObject({ status: 404 });
  });
});
