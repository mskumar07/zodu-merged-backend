// The rules between a shift template's fields, with the repository replaced.
jest.mock('../src/repository/shift-template-repo', () => ({
  list: jest.fn(), findById: jest.fn(), insert: jest.fn(async (t) => t), update: jest.fn(async (t) => t), deactivate: jest.fn(),
}));

const repo = require('../src/repository/shift-template-repo');
const service = require('../src/services/shift-template-service');

const T = { zodu_id: 'Z001', branch_id: 'B1' };
const ID = '9f0a1c2e-0000-4000-8000-000000000000';
const morning = {
  ...T, name: 'Morning Shift', code: 'M', description: '', start_time: '09:00', end_time: '17:00',
  break_start: '13:00', break_minutes: 60, applicable_to: 'ALL', department_ids: [],
  ot_eligible: true, is_active: true,
};

beforeEach(() => jest.clearAllMocks());

describe('create', () => {
  test('working hours = shift length - break (the 09:00-17:00 / 1h example is 7h)', async () => {
    await service.create(morning);
    expect(repo.insert).toHaveBeenCalledWith(expect.objectContaining({ working_minutes: 420, is_cross_day: false }));
  });

  test('a night shift crosses midnight: is_cross_day follows the times, hours are counted across it', async () => {
    await service.create({ ...morning, start_time: '22:00', end_time: '06:00', break_start: '02:00', break_minutes: 30 });
    expect(repo.insert).toHaveBeenCalledWith(expect.objectContaining({ is_cross_day: true, working_minutes: 450 }));
  });

  test('Cross Day switch that contradicts the times is refused, both ways', async () => {
    await expect(service.create({ ...morning, start_time: '22:00', end_time: '06:00', is_cross_day: false }))
      .rejects.toMatchObject({ status: 400, message: expect.stringMatching(/turn on/i) });
    await expect(service.create({ ...morning, is_cross_day: true }))
      .rejects.toMatchObject({ status: 400, message: expect.stringMatching(/turn off/i) });
    expect(repo.insert).not.toHaveBeenCalled();
  });

  test('same start and end is refused', async () => {
    await expect(service.create({ ...morning, end_time: '09:00' })).rejects.toMatchObject({ status: 400 });
  });

  test('the break must be shorter than the shift and inside it', async () => {
    await expect(service.create({ ...morning, break_minutes: 480 })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/shorter/) });
    await expect(service.create({ ...morning, break_start: '16:30', break_minutes: 60 })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/within/) });
    await expect(service.create({ ...morning, break_start: '07:00' })).rejects.toMatchObject({ status: 400 });
  });

  test('no break: the break start is dropped, nothing is deducted', async () => {
    await service.create({ ...morning, break_minutes: 0, break_start: '13:00' });
    expect(repo.insert).toHaveBeenCalledWith(expect.objectContaining({ break_start: null, working_minutes: 480 }));
  });

  test('a break length without a start time is fine (the form only asks for the duration)', async () => {
    await service.create({ ...morning, break_start: null });
    expect(repo.insert).toHaveBeenCalledWith(expect.objectContaining({ break_start: null, working_minutes: 420 }));
  });

  test('selected departments need at least one; all departments clears the list', async () => {
    await expect(service.create({ ...morning, applicable_to: 'DEPARTMENTS', department_ids: [] })).rejects.toMatchObject({ status: 400 });
    await service.create({ ...morning, applicable_to: 'ALL', department_ids: ['D1'] });
    expect(repo.insert).toHaveBeenLastCalledWith(expect.objectContaining({ department_ids: [] }));
  });

  test('a duplicate code and a duplicate name give different 409 messages', async () => {
    repo.insert.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505', constraint: 'uq_shift_templates_branch_code' }));
    await expect(service.create(morning)).rejects.toMatchObject({ status: 409, message: 'Shift code "M" is already used in this branch' });
    repo.insert.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505', constraint: 'uq_shift_templates_branch_name' }));
    await expect(service.create(morning)).rejects.toMatchObject({ status: 409, message: 'Shift template "Morning Shift" already exists in this branch' });
  });

  test('an unexpected database error is not turned into a user message', async () => {
    const boom = new Error('connection lost');
    repo.insert.mockRejectedValueOnce(boom);
    await expect(service.create(morning)).rejects.toBe(boom);
  });
});

describe('update', () => {
  const current = { ...morning, shift_template_id: ID, is_cross_day: false, working_minutes: 420, sort_order: 1 };

  test('only what was sent changes', async () => {
    repo.findById.mockResolvedValueOnce(current);
    await service.update({ ...T, shift_template_id: ID, name: 'Early Shift' });
    expect(repo.update).toHaveBeenCalledWith(expect.objectContaining({ name: 'Early Shift', code: 'M', start_time: '09:00', working_minutes: 420 }));
  });

  test('changing the times recomputes the hours and Cross Day', async () => {
    repo.findById.mockResolvedValueOnce(current);
    await service.update({ ...T, shift_template_id: ID, start_time: '22:00', end_time: '06:00', break_start: '02:00' });
    expect(repo.update).toHaveBeenCalledWith(expect.objectContaining({ is_cross_day: true, working_minutes: 420 }));
  });

  test('changing the break alone moves the hours', async () => {
    repo.findById.mockResolvedValueOnce(current);
    await service.update({ ...T, shift_template_id: ID, break_minutes: 30 });
    expect(repo.update).toHaveBeenCalledWith(expect.objectContaining({ working_minutes: 450 }));
  });

  test('a missing template, or another branch\'s → 404, nothing is saved', async () => {
    repo.findById.mockResolvedValueOnce(null);
    await expect(service.update({ ...T, shift_template_id: ID, name: 'x1' })).rejects.toMatchObject({ status: 404 });
    expect(repo.update).not.toHaveBeenCalled();
  });

  test('an inactive template can be switched back on', async () => {
    repo.findById.mockResolvedValueOnce({ ...current, is_active: false });
    await service.update({ ...T, shift_template_id: ID, is_active: true });
    expect(repo.update).toHaveBeenCalledWith(expect.objectContaining({ is_active: true }));
  });
});

describe('delete', () => {
  test('switches the template off and says so', async () => {
    repo.deactivate.mockResolvedValueOnce({ ...morning, shift_template_id: ID, is_active: false });
    const res = await service.remove({ ...T, shift_template_id: ID });
    expect(res.data.is_active).toBe(false);
    expect(res.message).toMatch(/Inactive/);
  });

  test('a missing template → 404', async () => {
    repo.deactivate.mockResolvedValueOnce(null);
    await expect(service.remove({ ...T, shift_template_id: ID })).rejects.toMatchObject({ status: 404 });
  });
});

describe('list', () => {
  test('status becomes the active filter', async () => {
    repo.list.mockResolvedValue([]);
    await service.list({ ...T, status: 'active' });
    expect(repo.list).toHaveBeenLastCalledWith(expect.objectContaining({ is_active: true }));
    await service.list({ ...T, status: 'inactive' });
    expect(repo.list).toHaveBeenLastCalledWith(expect.objectContaining({ is_active: false }));
    await service.list({ ...T });
    expect(repo.list).toHaveBeenLastCalledWith(expect.objectContaining({ is_active: null }));
  });
});
