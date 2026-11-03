// The owner's login (EMP001) can only be changed by the owner.
jest.mock('../src/repository/employee-repo', () => ({
  findById: jest.fn(async (id) => (id === 'OWNER'
    ? { employee_id: id, employee_code: 'EMP001', user_id: 'u-owner' }
    : { employee_id: id, employee_code: 'EMP007', user_id: 'u-staff' })),
  softDelete: jest.fn(async () => {}),
}));
jest.mock('@zodu/security', () => ({
  ...jest.requireActual('@zodu/security'),
  createInternalHttp: () => ({ put: jest.fn(async () => ({ data: {} })), post: jest.fn(async () => ({ data: {} })), get: jest.fn(async () => ({ data: {} })) }),
}));

const service = require('../src/services/employee-service');

const scope = { zodu_id: 'Z001', branch_id: 'B1' };
const manager = { isOwner: false };
const owner = { isOwner: true };

test('a manager cannot set the owner\'s password or deactivate the owner', async () => {
  await expect(service.setLoginDetails('OWNER', { ...scope, password: 'new pass phrase' }, manager)).rejects.toMatchObject({ status: 403 });
  await expect(service.deleteEmployee('OWNER', { ...scope, status: 'Inactive' }, manager)).rejects.toMatchObject({ status: 403 });
});

test('the owner can; other employees are unaffected', async () => {
  await expect(service.deleteEmployee('OWNER', { ...scope, status: 'Inactive' }, owner)).resolves.toMatchObject({ success: true });
  await expect(service.deleteEmployee('E7', { ...scope, status: 'Inactive' }, manager)).resolves.toMatchObject({ success: true });
});
