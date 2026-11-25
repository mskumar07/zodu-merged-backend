// Face check-in / check-out: employee-service says who is in the photo, the punch is the
// same check-in / check-out the buttons do, in this service's database (so the dashboard
// sees it). The repository and employee-service are mocked.

jest.mock('../src/database/connection', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../src/repository/attendance-repo', () => ({
  checkIn: jest.fn(),
  checkOut: jest.fn(),
  findToday: jest.fn(),
  findTodayPunch: jest.fn(),
}));
jest.mock('../src/clients/face-identify', () => ({ identifyFace: jest.fn() }));

const repo = require('../src/repository/attendance-repo');
const faceClient = require('../src/clients/face-identify');
const service = require('../src/services/attendance-service');

const ASHA = { employee_id: 'E1', employee_name: 'Asha', employee_code: 'EMP1', similarity: 0.91 };
const ROW = { status: 'Present', check_in_time: '09:02 AM' };
const punchState = (over = {}) => ({
  status: 'Present', check_in_iso: '2026-11-24T09:02:11', check_out_iso: null, seconds_since_in: 3600, ...over,
});
const photo = { buffer: Buffer.from([0xff, 0xd8]), mimetype: 'image/jpeg' };
const tenant = { zodu_id: 'Z001', branch_id: 'B1' };

beforeEach(() => {
  jest.resetAllMocks();
  faceClient.identifyFace.mockResolvedValue(ASHA);
});

describe('self', () => {
  const employee = { employee_id: 'E1', name: 'Asha' };

  test('check-in: matched against the caller only, recorded with the same check-in as the button', async () => {
    repo.checkIn.mockResolvedValue(ROW);
    repo.findTodayPunch.mockResolvedValue(punchState());

    const res = await service.faceSelf({ ...tenant, employee, expect: 'in', file: photo });

    expect(faceClient.identifyFace).toHaveBeenCalledWith({ ...tenant, employee_id: 'E1', file: photo });
    expect(repo.checkIn).toHaveBeenCalledWith({ ...tenant, employee_id: 'E1', employee_name: 'Asha' });
    expect(res.data).toEqual(expect.objectContaining({
      type: 'in', employee_id: 'E1', employee_name: 'Asha', check_in_time: '2026-11-24T09:02:11', check_out_time: null, similarity: 0.91,
    }));
  });

  test('check-out', async () => {
    repo.checkOut.mockResolvedValue({ ...ROW, check_out_time: '06:01 PM' });
    repo.findTodayPunch.mockResolvedValue(punchState({ check_out_iso: '2026-11-24T18:01:00' }));

    const res = await service.faceSelf({ ...tenant, employee, expect: 'out', file: photo });

    expect(repo.checkOut).toHaveBeenCalledWith({ employee_id: 'E1' });
    expect(res.data).toEqual(expect.objectContaining({ type: 'out', check_out_time: '2026-11-24T18:01:00' }));
  });

  test('refused like the buttons: already in → 409, not in yet → 400; nothing recorded', async () => {
    repo.checkIn.mockResolvedValue(null);
    await expect(service.faceSelf({ ...tenant, employee, expect: 'in', file: photo }))
      .rejects.toMatchObject({ status: 409, message: 'You have already checked in today' });

    repo.checkOut.mockResolvedValue(null);
    repo.findToday.mockResolvedValue(null);
    await expect(service.faceSelf({ ...tenant, employee, expect: 'out', file: photo }))
      .rejects.toMatchObject({ status: 400, message: 'You have not checked in today' });
  });

  test('a face that does not match never punches', async () => {
    faceClient.identifyFace.mockRejectedValue(Object.assign(new Error('Face does not match.'), { status: 422 }));
    await expect(service.faceSelf({ ...tenant, employee, expect: 'in', file: photo })).rejects.toMatchObject({ status: 422 });
    expect(repo.checkIn).not.toHaveBeenCalled();
    expect(repo.checkOut).not.toHaveBeenCalled();
  });
});

describe('kiosk', () => {
  const marker = { employee_id: 'M1', name: 'Manager' };

  test('not in yet → check-in, marked by the manager running the kiosk', async () => {
    repo.findTodayPunch.mockResolvedValueOnce(null).mockResolvedValueOnce(punchState());
    repo.checkIn.mockResolvedValue(ROW);

    const res = await service.faceKiosk({ ...tenant, marker, file: photo });

    expect(faceClient.identifyFace).toHaveBeenCalledWith({ ...tenant, file: photo });
    expect(repo.checkIn).toHaveBeenCalledWith({
      ...tenant, employee_id: 'E1', employee_name: 'Asha', marked_by: 'M1', marked_by_name: 'Manager',
    });
    expect(res.data.type).toBe('in');
  });

  test('on leave / weekly off with no check-in → check-in (as the button does)', async () => {
    repo.findTodayPunch.mockResolvedValueOnce(punchState({ status: 'On Leave', check_in_iso: null })).mockResolvedValueOnce(punchState());
    repo.checkIn.mockResolvedValue(ROW);
    expect((await service.faceKiosk({ ...tenant, marker, file: photo })).data.type).toBe('in');
  });

  test('already in → check-out', async () => {
    repo.findTodayPunch.mockResolvedValueOnce(punchState()).mockResolvedValueOnce(punchState({ check_out_iso: '2026-11-24T18:01:00' }));
    repo.checkOut.mockResolvedValue(ROW);

    const res = await service.faceKiosk({ ...tenant, marker, file: photo });

    expect(repo.checkIn).not.toHaveBeenCalled();
    expect(repo.checkOut).toHaveBeenCalledWith({ employee_id: 'E1' });
    expect(res.data).toEqual(expect.objectContaining({ type: 'out', check_out_time: '2026-11-24T18:01:00' }));
  });

  test('a second scan within a minute of checking in is the same punch, not a check-out', async () => {
    repo.findTodayPunch.mockResolvedValue(punchState({ seconds_since_in: 20 }));
    await expect(service.faceKiosk({ ...tenant, marker, file: photo }))
      .rejects.toMatchObject({ status: 409, message: 'Asha already checked in at 09:02 AM.' });
    expect(repo.checkOut).not.toHaveBeenCalled();
  });

  test('already in and out → 409', async () => {
    repo.findTodayPunch.mockResolvedValue(punchState({ check_out_iso: '2026-11-24T18:01:00' }));
    await expect(service.faceKiosk({ ...tenant, marker, file: photo }))
      .rejects.toMatchObject({ status: 409, message: 'Asha has already checked in and out today.' });
  });

  test('two scans racing: the check-in that loses is a 409, not a second row', async () => {
    repo.findTodayPunch.mockResolvedValue(null);
    repo.checkIn.mockResolvedValue(null);
    await expect(service.faceKiosk({ ...tenant, marker, file: photo })).rejects.toMatchObject({ status: 409 });
  });
});

describe('employee-service client', () => {
  const { identifyFace } = jest.requireActual('../src/clients/face-identify');
  const realFetch = global.fetch;
  const reply = (status, body) => ({ ok: status < 300, status, json: async () => body });
  afterEach(() => { global.fetch = realFetch; });

  test('sends the photo and scope with the service token, returns the match', async () => {
    global.fetch = jest.fn(async () => reply(200, { success: true, data: ASHA }));
    await expect(identifyFace({ ...tenant, employee_id: 'E1', file: photo })).resolves.toEqual(ASHA);

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toMatch(/\/internal\/faces\/identify$/);
    const form = init.body;
    expect([form.get('zodu_id'), form.get('branch_id'), form.get('employee_id')]).toEqual(['Z001', 'B1', 'E1']);
    expect(form.get('image')).toBeTruthy();
  });

  test('a 4xx about the photo is passed on with its message', async () => {
    global.fetch = jest.fn(async () => reply(422, { success: false, message: 'Face not recognised.' }));
    await expect(identifyFace({ ...tenant, file: photo })).rejects.toMatchObject({ status: 422, message: 'Face not recognised.' });
  });

  test('a token problem (401 / 403), an outage or no answer is a 503, never blamed on the user', async () => {
    for (const r of [reply(401, { detail: 'Invalid internal token' }), reply(403, { message: 'nope' }), reply(500, {})]) {
      global.fetch = jest.fn(async () => r);
      await expect(identifyFace({ ...tenant, file: photo })).rejects.toMatchObject({ status: 503 });
    }
    global.fetch = jest.fn(async () => { throw new Error('ECONNREFUSED'); });
    await expect(identifyFace({ ...tenant, file: photo })).rejects.toMatchObject({ status: 503 });
  });
});
