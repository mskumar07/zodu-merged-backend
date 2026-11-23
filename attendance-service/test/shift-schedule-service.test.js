// The rules of the shift schedule, with the repositories and the employee directory replaced.
jest.mock('../src/repository/shift-schedule-repo', () => ({
  cells: jest.fn(), findTemplates: jest.fn(), assign: jest.fn(), currentCells: jest.fn(),
}));
jest.mock('../src/repository/shift-template-repo', () => ({ list: jest.fn() }));
jest.mock('../src/clients/employee-directory', () => ({ roster: jest.fn() }));

const repo = require('../src/repository/shift-schedule-repo');
const templateRepo = require('../src/repository/shift-template-repo');
const directory = require('../src/clients/employee-directory');
const service = require('../src/services/shift-schedule-service');

const T = { zodu_id: 'Z001', branch_id: 'B1' };
const RAHUL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ANJALI = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADMIN = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const GONE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const M = '11111111-1111-4111-8111-111111111111';
const DAY = '2099-01-05';

beforeEach(() => {
  jest.clearAllMocks();
  directory.roster.mockResolvedValue([
    { employee_id: ADMIN, employee_code: 'EMP001', name: 'Admin', status: 'active' },
    { employee_id: RAHUL, employee_code: 'E001', name: 'Rahul Menon', status: 'active' },
    { employee_id: ANJALI, employee_code: 'E002', name: 'Anjali Sharma', status: 'active' },
    { employee_id: GONE, employee_code: 'E003', name: 'Old Hand', status: 'inactive' },
  ]);
  repo.findTemplates.mockResolvedValue([{ shift_template_id: M, code: 'M', name: 'Morning Shift', is_active: true }]);
  repo.cells.mockResolvedValue([]);
  templateRepo.list.mockResolvedValue([{ shift_template_id: M, code: 'M', name: 'Morning Shift', start_time_label: '09:00 AM', end_time_label: '05:00 PM' }]);
});

describe('list', () => {
  test('builds the grid: dates, shifts, active employees only, and each cell by date', async () => {
    repo.cells.mockResolvedValue([
      { employee_id: RAHUL, work_date: '2099-01-05', shift_template_id: M, version: 2, code: 'M', is_active: true },
      { employee_id: RAHUL, work_date: '2099-01-06', shift_template_id: null, version: 1, code: null, is_active: null },
    ]);
    const { data } = await service.list({ ...T, from: '2099-01-05', to: '2099-01-11' });
    expect(data.dates).toHaveLength(7);
    expect(data.dates[0]).toMatchObject({ date: '2099-01-05', weekday: 'Mon', day_label: 'Jan 5', is_past: false });
    expect(data.employees.map((e) => e.name)).toEqual(['Rahul Menon', 'Anjali Sharma']);   // the inactive one and the Admin are left out
    expect(data.employees[0].initials).toBe('RM');
    expect(data.employees[0].days['2099-01-05']).toMatchObject({ code: 'M', version: 2, is_off: false });
    expect(data.employees[0].days['2099-01-06']).toMatchObject({ code: 'OFF', is_off: true });
    expect(data.employees[1].days).toEqual({});                                            // nothing scheduled yet
    expect(data.shifts[0]).toMatchObject({ code: 'M', time_label: '09:00 AM – 05:00 PM' });
    expect(repo.cells).toHaveBeenCalledWith(expect.objectContaining({ employee_ids: [RAHUL, ANJALI] }));
  });

  test('search and paging apply to the employees', async () => {
    const found = await service.list({ ...T, from: DAY, to: DAY, search: 'anj' });
    expect(found.data.employees.map((e) => e.name)).toEqual(['Anjali Sharma']);
    const page2 = await service.list({ ...T, from: DAY, to: DAY, page: 2, limit: 1 });
    expect(page2.data.employees.map((e) => e.name)).toEqual(['Anjali Sharma']);
    expect(page2.data.pagination).toEqual({ page: 2, limit: 1, total: 2, total_pages: 2 });
  });

  test('a period that ends before it starts, or is over 31 days, is refused', async () => {
    await expect(service.list({ ...T, from: '2099-01-10', to: '2099-01-05' })).rejects.toMatchObject({ status: 400 });
    await expect(service.list({ ...T, from: '2099-01-01', to: '2099-02-05' })).rejects.toMatchObject({ status: 400 });
  });
});

describe('assign', () => {
  const change = (extra = {}) => ({ employee_id: RAHUL, work_date: DAY, shift_template_id: M, version: 0, ...extra });

  test('saves the changed cells and returns their new versions', async () => {
    repo.assign.mockResolvedValue([{ employee_id: RAHUL, work_date: DAY, shift_template_id: M, version: 1 }]);
    const res = await service.assign({ ...T, changes: [change()], updated_by: 'u1' });
    expect(res.data.cells[0]).toMatchObject({ code: 'M', version: 1 });
    expect(repo.assign).toHaveBeenCalledWith(expect.objectContaining({ updated_by: 'u1' }));
  });

  test('past days cannot be changed', async () => {
    await expect(service.assign({ ...T, changes: [change({ work_date: '2000-01-01' })] }))
      .rejects.toMatchObject({ status: 400, message: 'Past dates cannot be changed' });
    expect(repo.assign).not.toHaveBeenCalled();
  });

  test('refuses a duplicated cell, an unknown or inactive employee, and an unknown or inactive shift', async () => {
    await expect(service.assign({ ...T, changes: [change(), change()] })).rejects.toMatchObject({ status: 400 });
    await expect(service.assign({ ...T, changes: [change({ employee_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' })] })).rejects.toMatchObject({ status: 400 });
    await expect(service.assign({ ...T, changes: [change({ employee_id: GONE })] })).rejects.toMatchObject({ status: 400 });
    await expect(service.assign({ ...T, changes: [change({ employee_id: ADMIN })] })).rejects.toMatchObject({ status: 400 });
    repo.findTemplates.mockResolvedValue([]);
    await expect(service.assign({ ...T, changes: [change()] })).rejects.toMatchObject({ status: 400 });
    repo.findTemplates.mockResolvedValue([{ shift_template_id: M, code: 'M', name: 'Morning Shift', is_active: false }]);
    await expect(service.assign({ ...T, changes: [change()] })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/inactive/) });
    expect(repo.assign).not.toHaveBeenCalled();
  });

  test('OFF (no shift) is allowed', async () => {
    repo.assign.mockResolvedValue([{ employee_id: RAHUL, work_date: DAY, shift_template_id: null, version: 1 }]);
    const res = await service.assign({ ...T, changes: [change({ shift_template_id: null })] });
    expect(res.data.cells[0]).toMatchObject({ code: 'OFF', shift_template_id: null });
  });

  test('a cell changed by someone else is a 409 that lists the cell and what it is now', async () => {
    repo.assign.mockResolvedValue(null);
    repo.currentCells.mockResolvedValue([{ employee_id: RAHUL, work_date: DAY, shift_template_id: null, version: 3, code: null }]);
    const err = await service.assign({ ...T, changes: [change({ version: 2 }), change({ employee_id: ANJALI })] }).catch((e) => e);
    expect(err.status).toBe(409);
    expect(err.details).toEqual([{ employee_id: RAHUL, work_date: DAY, current: { shift_template_id: null, code: 'OFF', version: 3 } }]);
  });
});
