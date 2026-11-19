// The rules between a leave policy's fields, and how edits and deletes answer, with the repository replaced.
jest.mock('../src/repository/leave-policy-repo', () => ({
  list: jest.fn(), findById: jest.fn(), insert: jest.fn(async (p) => ({ ...p, policy_id: 'P1', version: 1 })),
  update: jest.fn(async (p) => ({ ...p, version: p.expected_version + 1 })), remove: jest.fn(),
}));

const repo = require('../src/repository/leave-policy-repo');
const service = require('../src/services/leave-policy-service');

const T = { zodu_id: 'Z001', branch_id: 'B1' };
const ID = '9f0a1c2e-0000-4000-8000-000000000000';
const base = {
  ...T, name: 'Standard Policy', description: 'Default policy', is_active: true, applicable_to: 'ALL', department_ids: [],
  annual_entitlement: true, leave_year_start_month: 1, carry_forward: false, carry_forward_max_days: 0,
  encashment: false, encashment_limit_days: 0,
};

beforeEach(() => jest.clearAllMocks());

describe('create', () => {
  test('carry forward on needs a maximum above 0; off clears it', async () => {
    await expect(service.create({ ...base, carry_forward: true, carry_forward_max_days: 0 })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/carried forward/) });
    expect(repo.insert).not.toHaveBeenCalled();
    await service.create({ ...base, carry_forward: true, carry_forward_max_days: 10 });
    expect(repo.insert).toHaveBeenLastCalledWith(expect.objectContaining({ carry_forward: true, carry_forward_max_days: 10 }));
    await service.create({ ...base, carry_forward: false, carry_forward_max_days: 10 });
    expect(repo.insert).toHaveBeenLastCalledWith(expect.objectContaining({ carry_forward_max_days: 0 }));
  });

  test('encashment on needs a limit above 0; off clears it', async () => {
    await expect(service.create({ ...base, encashment: true, encashment_limit_days: 0 })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/encashment limit/) });
    await service.create({ ...base, encashment: true, encashment_limit_days: 30 });
    expect(repo.insert).toHaveBeenLastCalledWith(expect.objectContaining({ encashment: true, encashment_limit_days: 30 }));
    await service.create({ ...base, encashment: false, encashment_limit_days: 30 });
    expect(repo.insert).toHaveBeenLastCalledWith(expect.objectContaining({ encashment_limit_days: 0 }));
  });

  test('selected departments need at least one; all employees clears the list', async () => {
    await expect(service.create({ ...base, applicable_to: 'DEPARTMENTS', department_ids: [] })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/department/i) });
    await service.create({ ...base, applicable_to: 'ALL', department_ids: ['D1'] });
    expect(repo.insert).toHaveBeenLastCalledWith(expect.objectContaining({ department_ids: [] }));
    await service.create({ ...base, applicable_to: 'DEPARTMENTS', department_ids: ['D1', 'D2'] });
    expect(repo.insert).toHaveBeenLastCalledWith(expect.objectContaining({ department_ids: ['D1', 'D2'] }));
  });

  test('a blank description is stored as nothing', async () => {
    await service.create({ ...base, description: '   ' });
    expect(repo.insert).toHaveBeenLastCalledWith(expect.objectContaining({ description: null }));
  });

  test('the answer carries the labels the screen shows', async () => {
    const { data } = await service.create({ ...base, leave_year_start_month: 4 });
    expect(data).toMatchObject({ applicable_label: 'All Employees', leave_year_label: 'Apr – Mar' });
    expect((await service.create(base)).data.leave_year_label).toBe('Jan – Dec');
  });

  test('a name already used is a 409 naming it; a second active All Employees policy says so', async () => {
    repo.insert.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505', constraint: 'uq_leave_policies_branch_name' }));
    await expect(service.create(base)).rejects.toMatchObject({ status: 409, message: 'A policy named "Standard Policy" already exists in this branch' });
    repo.insert.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505', constraint: 'uq_leave_policies_one_default' }));
    await expect(service.create(base)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/applies to all employees/) });
  });

  test('an unexpected database error is not turned into a user message', async () => {
    const boom = new Error('connection lost');
    repo.insert.mockRejectedValueOnce(boom);
    await expect(service.create(base)).rejects.toBe(boom);
  });
});

describe('update', () => {
  const current = { ...base, policy_id: ID, version: 3 };

  test('only what was sent changes, and the version it was loaded at is what the write is guarded by', async () => {
    repo.findById.mockResolvedValueOnce(current);
    const { data } = await service.update({ ...T, policy_id: ID, version: 3, name: 'Renamed' });
    expect(repo.update).toHaveBeenCalledWith(expect.objectContaining({
      policy_id: ID, name: 'Renamed', description: 'Default policy', carry_forward: false, expected_version: 3,
    }));
    expect(data.version).toBe(4);
  });

  test('a version that is no longer current is refused before anything is written', async () => {
    repo.findById.mockResolvedValueOnce(current);
    await expect(service.update({ ...T, policy_id: ID, version: 2, name: 'Renamed' })).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/changed by someone else/) });
    expect(repo.update).not.toHaveBeenCalled();
  });

  test('someone saving between the read and the write is a 409; a delete in between is a 404', async () => {
    repo.findById.mockResolvedValueOnce(current).mockResolvedValueOnce({ ...current, version: 4 });
    repo.update.mockResolvedValueOnce(null);
    await expect(service.update({ ...T, policy_id: ID, version: 3, name: 'X' })).rejects.toMatchObject({ status: 409 });

    repo.findById.mockResolvedValueOnce(current).mockResolvedValueOnce(null);
    repo.update.mockResolvedValueOnce(null);
    await expect(service.update({ ...T, policy_id: ID, version: 3, name: 'X' })).rejects.toMatchObject({ status: 404 });
  });

  test('unticking carry forward on a policy that had days clears them', async () => {
    repo.findById.mockResolvedValueOnce({ ...current, carry_forward: true, carry_forward_max_days: 10 });
    await service.update({ ...T, policy_id: ID, version: 3, carry_forward: false });
    expect(repo.update).toHaveBeenCalledWith(expect.objectContaining({ carry_forward: false, carry_forward_max_days: 0 }));
  });

  test('a policy that does not exist (or is deleted, or is another branch\'s) is a 404', async () => {
    repo.findById.mockResolvedValueOnce(null);
    await expect(service.update({ ...T, policy_id: ID, version: 1, name: 'X' })).rejects.toMatchObject({ status: 404 });
  });
});

describe('list / get / remove', () => {
  test('list passes the status filter as active / inactive / all', async () => {
    repo.list.mockResolvedValue([]);
    await service.list({ ...T, status: 'active' });
    expect(repo.list).toHaveBeenLastCalledWith(expect.objectContaining({ is_active: true }));
    await service.list({ ...T, status: 'inactive' });
    expect(repo.list).toHaveBeenLastCalledWith(expect.objectContaining({ is_active: false }));
    await service.list({ ...T });
    expect(repo.list).toHaveBeenLastCalledWith(expect.objectContaining({ is_active: null }));
  });

  test('get and delete answer 404 for a policy that is not there', async () => {
    repo.findById.mockResolvedValueOnce(null);
    await expect(service.get({ ...T, policy_id: ID })).rejects.toMatchObject({ status: 404 });
    repo.remove.mockResolvedValueOnce(null);
    await expect(service.remove({ ...T, policy_id: ID })).rejects.toMatchObject({ status: 404 });
    repo.remove.mockResolvedValueOnce({ policy_id: ID });
    await expect(service.remove({ ...T, policy_id: ID })).resolves.toMatchObject({ success: true });
  });
});
