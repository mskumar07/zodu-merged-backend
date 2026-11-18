// The rules of the Holidays screen's API, with the repository replaced.
jest.mock('../src/repository/holiday-repo', () => ({
  list: jest.fn(), counts: jest.fn(), findById: jest.fn(),
  insert: jest.fn(async (h) => h), update: jest.fn(async (h) => h), remove: jest.fn(),
}));

const repo = require('../src/repository/holiday-repo');
const service = require('../src/services/holiday-service');
const { parseHolidaySheet } = require('../src/utils/holiday-sheet');

const T = { zodu_id: 'Z001', branch_id: 'B1' };
const ID = '9f0a1c2e-0000-4000-8000-000000000000';
const diwali = { ...T, name: 'Deepavali', holiday_date: '2026-11-08', type: 'Public', applicable_to: 'ALL', department_ids: [] };

beforeEach(() => jest.clearAllMocks());

describe('create', () => {
  test('the type is stored exactly as sent', async () => {
    await service.create(diwali);
    expect(repo.insert).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'Public' }));
    await service.create({ ...diwali, type: 'Optional Holiday' });
    expect(repo.insert).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'Optional Holiday' }));
  });

  test('who added it is passed on to be stored', async () => {
    await service.create({ ...diwali, created_by: ID });
    expect(repo.insert).toHaveBeenLastCalledWith(expect.objectContaining({ created_by: ID }));
  });

  test('selected departments need at least one; all employees clears the list', async () => {
    await expect(service.create({ ...diwali, applicable_to: 'DEPARTMENTS', department_ids: [] })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/department/i) });
    await service.create({ ...diwali, applicable_to: 'ALL', department_ids: ['D1'] });
    expect(repo.insert).toHaveBeenLastCalledWith(expect.objectContaining({ department_ids: [] }));
    await service.create({ ...diwali, applicable_to: 'DEPARTMENTS', department_ids: ['D1'] });
    expect(repo.insert).toHaveBeenLastCalledWith(expect.objectContaining({ department_ids: ['D1'] }));
  });

  test('a year outside 2000-2100 is refused', async () => {
    await expect(service.create({ ...diwali, holiday_date: '1999-12-31' })).rejects.toMatchObject({ status: 400 });
    expect(repo.insert).not.toHaveBeenCalled();
  });

  test('a date already taken is a 409 naming the date', async () => {
    repo.insert.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    await expect(service.create({ ...diwali, holiday_date: '2026-01-01' }))
      .rejects.toMatchObject({ status: 409, message: 'A holiday is already added on 01 Jan 2026' });
  });

  test('an unexpected database error is not turned into a user message', async () => {
    const boom = new Error('connection lost');
    repo.insert.mockRejectedValueOnce(boom);
    await expect(service.create(diwali)).rejects.toBe(boom);
  });
});

describe('update', () => {
  const current = { ...diwali, holiday_id: ID };

  test('only what was sent changes', async () => {
    repo.findById.mockResolvedValueOnce(current);
    await service.update({ ...T, holiday_id: ID, name: 'Diwali' });
    expect(repo.update).toHaveBeenCalledWith(expect.objectContaining({ name: 'Diwali', holiday_date: '2026-11-08', type: 'Public' }));
  });

  test('the type can be changed; it is stored as sent', async () => {
    repo.findById.mockResolvedValueOnce(current);
    await service.update({ ...T, holiday_id: ID, type: 'Restricted' });
    expect(repo.update).toHaveBeenCalledWith(expect.objectContaining({ type: 'Restricted' }));
  });

  test('moving it onto a taken date → 409', async () => {
    repo.findById.mockResolvedValueOnce(current);
    repo.update.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    await expect(service.update({ ...T, holiday_id: ID, holiday_date: '2026-01-14' })).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/14 Jan 2026/) });
  });

  test('a missing holiday, or another branch\'s → 404, nothing is saved', async () => {
    repo.findById.mockResolvedValueOnce(null);
    await expect(service.update({ ...T, holiday_id: ID, name: 'x1' })).rejects.toMatchObject({ status: 404 });
    expect(repo.update).not.toHaveBeenCalled();
  });
});

describe('delete', () => {
  test('removes it and says so', async () => {
    repo.remove.mockResolvedValueOnce({ ...diwali, holiday_id: ID });
    const res = await service.remove({ ...T, holiday_id: ID });
    expect(res).toMatchObject({ success: true, message: 'Holiday deleted' });
  });

  test('a missing holiday → 404', async () => {
    repo.remove.mockResolvedValueOnce(null);
    await expect(service.remove({ ...T, holiday_id: ID })).rejects.toMatchObject({ status: 404 });
  });
});

describe('list', () => {
  test('the year range, the exact type filter, and the counts per type in the same answer', async () => {
    repo.list.mockResolvedValue([]);
    repo.counts.mockResolvedValue([{ type: 'Company', count: 4 }, { type: 'Public', count: 10 }, { type: 'Restricted', count: 2 }]);
    const res = await service.list({ ...T, year: 2026, type: 'Restricted' });
    expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-01-01', to: '2027-01-01', type: 'Restricted' }));
    expect(repo.counts).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-01-01', to: '2027-01-01' }));
    expect(res).toMatchObject({ success: true, year: 2026, counts: { all: 16, by_type: { Company: 4, Public: 10, Restricted: 2 } }, data: [] });
  });

  test('no type means every type', async () => {
    repo.list.mockResolvedValue([]);
    repo.counts.mockResolvedValue([]);
    await service.list({ ...T, year: 2026 });
    expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ type: null }));
  });
});

describe('export', () => {
  test('the sheet can be uploaded again: the import reads back the same dates, names and types', async () => {
    repo.list.mockResolvedValue([
      { holiday_date: '2026-01-01', day: 'Thu', name: "New Year's Day", type: 'Public', applicable_label: 'All Employees' },
      { holiday_date: '2026-03-25', day: 'Wed', name: 'Holi', type: 'Restricted', applicable_label: 'All Employees' },
      { holiday_date: '2026-03-11', day: 'Wed', name: 'Company Day', type: 'Company Holiday', applicable_label: 'All Employees' },
    ]);
    const { year, buffer } = await service.exportSheet({ ...T, year: 2026 });
    expect(year).toBe(2026);
    const { rows, errors } = await parseHolidaySheet(buffer);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { date: '2026-01-01', name: "New Year's Day", type: 'Public' },
      { date: '2026-03-25', name: 'Holi', type: 'Restricted' },
      { date: '2026-03-11', name: 'Company Day', type: 'Company Holiday' },
    ]);
  });
});
