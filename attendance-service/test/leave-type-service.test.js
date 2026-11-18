// The rules between a leave type's fields, with the repository replaced.
jest.mock('../src/repository/leave-type-repo', () => ({
  list: jest.fn(), findById: jest.fn(), insert: jest.fn(async (t) => t), update: jest.fn(async (t) => t), deactivate: jest.fn(),
}));

const repo = require('../src/repository/leave-type-repo');
const service = require('../src/services/leave-type-service');

const T = { zodu_id: 'Z001', branch_id: 'B1' };
const ID = '9f0a1c2e-0000-4000-8000-000000000000';
const base = {
  ...T, name: 'Casual Leave', code: 'CL', annual_days: 12, is_paid: true, carry_forward: false, carry_forward_max_days: 0,
  encashment: false, applicable_to: 'ALL', department_ids: [], effective_from: '2026-01-01', is_active: true,
};

beforeEach(() => jest.clearAllMocks());

describe('create', () => {
  test('carry forward on needs a maximum above 0', async () => {
    await expect(service.create({ ...base, carry_forward: true, carry_forward_max_days: 0 })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/maximum days/) });
    expect(repo.insert).not.toHaveBeenCalled();
    await service.create({ ...base, carry_forward: true, carry_forward_max_days: 10 });
    expect(repo.insert).toHaveBeenCalledWith(expect.objectContaining({ carry_forward: true, carry_forward_max_days: 10 }));
  });

  test('carry forward off: the maximum is cleared whatever was typed', async () => {
    await service.create({ ...base, carry_forward: false, carry_forward_max_days: 10 });
    expect(repo.insert).toHaveBeenCalledWith(expect.objectContaining({ carry_forward_max_days: 0 }));
  });

  test('selected departments need at least one; all employees clears the list', async () => {
    await expect(service.create({ ...base, applicable_to: 'DEPARTMENTS', department_ids: [] })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/department/i) });
    await service.create({ ...base, applicable_to: 'ALL', department_ids: ['D1'] });
    expect(repo.insert).toHaveBeenLastCalledWith(expect.objectContaining({ department_ids: [] }));
    await service.create({ ...base, applicable_to: 'DEPARTMENTS', department_ids: ['D1', 'D2'] });
    expect(repo.insert).toHaveBeenLastCalledWith(expect.objectContaining({ department_ids: ['D1', 'D2'] }));
  });

  test('effective-from defaults to the start of the year', async () => {
    const { effective_from, ...rest } = base;
    await service.create(rest);
    expect(repo.insert.mock.calls[0][0].effective_from).toMatch(/^\d{4}-01-01$/);
  });

  test('a code already used in the branch is a 409 naming the code', async () => {
    repo.insert.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    await expect(service.create(base)).rejects.toMatchObject({ status: 409, message: 'Leave code "CL" is already used in this branch' });
  });

  test('an unexpected database error is not turned into a user message', async () => {
    const boom = new Error('connection lost');
    repo.insert.mockRejectedValueOnce(boom);
    await expect(service.create(base)).rejects.toBe(boom);
  });
});

describe('update', () => {
  const current = { ...base, leave_type_id: ID, sort_order: 1 };

  test('only what was sent changes', async () => {
    repo.findById.mockResolvedValueOnce(current);
    await service.update({ ...T, leave_type_id: ID, annual_days: 15 });
    expect(repo.update).toHaveBeenCalledWith(expect.objectContaining({ code: 'CL', name: 'Casual Leave', annual_days: 15, is_active: true }));
  });

  test('another branch\'s or a missing type → 404, nothing is saved', async () => {
    repo.findById.mockResolvedValueOnce(null);
    await expect(service.update({ ...T, leave_type_id: ID, name: 'x1' })).rejects.toMatchObject({ status: 404 });
    expect(repo.update).not.toHaveBeenCalled();
  });

  test('switching carry forward off clears its maximum; switching it on without one is refused', async () => {
    repo.findById.mockResolvedValueOnce({ ...current, carry_forward: true, carry_forward_max_days: 10 });
    await service.update({ ...T, leave_type_id: ID, carry_forward: false });
    expect(repo.update).toHaveBeenLastCalledWith(expect.objectContaining({ carry_forward: false, carry_forward_max_days: 0 }));

    repo.findById.mockResolvedValueOnce(current);
    await expect(service.update({ ...T, leave_type_id: ID, carry_forward: true })).rejects.toMatchObject({ status: 400 });
  });

  test('renaming the code to one already used → 409', async () => {
    repo.findById.mockResolvedValueOnce(current);
    repo.update.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    await expect(service.update({ ...T, leave_type_id: ID, code: 'SL' })).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/"SL"/) });
  });

  test('an inactive type can be switched back on', async () => {
    repo.findById.mockResolvedValueOnce({ ...current, is_active: false });
    await service.update({ ...T, leave_type_id: ID, is_active: true });
    expect(repo.update).toHaveBeenCalledWith(expect.objectContaining({ is_active: true }));
  });
});

describe('delete', () => {
  test('switches the type off and says so', async () => {
    repo.deactivate.mockResolvedValueOnce({ ...base, leave_type_id: ID, is_active: false });
    const res = await service.remove({ ...T, leave_type_id: ID });
    expect(res.data.is_active).toBe(false);
    expect(res.message).toMatch(/Inactive/);
    expect(repo.deactivate).toHaveBeenCalledWith({ ...T, leave_type_id: ID });
  });

  test('a missing type → 404', async () => {
    repo.deactivate.mockResolvedValueOnce(null);
    await expect(service.remove({ ...T, leave_type_id: ID })).rejects.toMatchObject({ status: 404 });
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
