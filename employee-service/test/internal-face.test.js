// POST /internal/faces/identify — who is in a photo, for attendance-service's face
// check-in. Only attendance-service may call it; the punch itself is recorded there.
const request = require('supertest');

const T = (c) => c.repeat(40);
// Tokens are read when the app loads, so they are set before requiring it.
process.env.INTERNAL_TOKEN_AUTH = T('a');
process.env.INTERNAL_TOKEN_ATTENDANCE = T('t');

const E1 = '00000000-0000-4000-8000-000000000001';
const E2 = '00000000-0000-4000-8000-000000000002';

jest.mock('../src/database/connection', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../src/repository/face-repo', () => ({
  findCandidates: jest.fn(),
}));
jest.mock('../src/utils/face-client', () => ({
  getEmbedding: jest.fn(async () => [1, 0]),
  // Cosine of L2-normalised vectors: the candidates' embeddings carry their score.
  similarity: jest.fn((a, b) => b[0]),
}));

const faceRepo = require('../src/repository/face-repo');
const faceClient = require('../src/utils/face-client');
const app = require('../src/express-app');

const as = (c) => ({ 'X-Internal-Token': T(c) });
const photo = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const JPG = { filename: 'face.jpg', contentType: 'image/jpeg' };
const candidate = (employee_id, score, name) => ({ employee_id, embedding: [score], employee_name: name, employee_code: 'EMP1' });

const identify = (headers, fields = { zodu_id: 'Z001', branch_id: 'B1' }) => {
  let req = request(app).post('/internal/faces/identify').set(headers);
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  return req.attach('image', photo, JPG);
};

beforeEach(() => jest.clearAllMocks());

test('attendance-service only: no token 401, another service 403', async () => {
  faceRepo.findCandidates.mockResolvedValue([candidate(E1, 0.9, 'Asha')]);
  expect((await identify({})).status).toBe(401);
  expect((await identify(as('a'))).status).toBe(403);
  expect((await identify(as('t'))).status).toBe(200);
});

test('identifies the best match in the branch', async () => {
  faceRepo.findCandidates.mockResolvedValue([candidate(E1, 0.5, 'Asha'), candidate(E2, 0.9, 'Ravi')]);
  const res = await identify(as('t'));
  expect(res.status).toBe(200);
  expect(res.body.data).toEqual({ employee_id: E2, employee_name: 'Ravi', employee_code: 'EMP1', similarity: 0.9 });
  expect(faceRepo.findCandidates).toHaveBeenCalledWith({ zodu_id: 'Z001', branch_id: 'B1', employee_id: undefined });
});

test('with employee_id only that employee is compared (self check-in)', async () => {
  faceRepo.findCandidates.mockResolvedValue([candidate(E1, 0.8, 'Asha')]);
  const res = await identify(as('t'), { zodu_id: 'Z001', branch_id: 'B1', employee_id: E1 });
  expect(res.status).toBe(200);
  expect(faceRepo.findCandidates).toHaveBeenCalledWith({ zodu_id: 'Z001', branch_id: 'B1', employee_id: E1 });
});

test('no match, look-alikes and no registered face are 4xx with a message for the app', async () => {
  faceRepo.findCandidates.mockResolvedValueOnce([candidate(E1, 0.2, 'Asha')]);
  const low = await identify(as('t'));
  expect(low.status).toBe(422);
  expect(low.body.message).toMatch(/not recognised/i);

  faceRepo.findCandidates.mockResolvedValueOnce([candidate(E1, 0.80, 'Asha'), candidate(E2, 0.78, 'Ravi')]);
  expect((await identify(as('t'))).status).toBe(422);

  faceRepo.findCandidates.mockResolvedValueOnce([]);
  const none = await identify(as('t'), { zodu_id: 'Z001', branch_id: 'B1', employee_id: E1 });
  expect(none.status).toBe(404);
  expect(none.body.message).toMatch(/not registered/i);
});

test('bad input is a 400 before any face work', async () => {
  for (const fields of [{ branch_id: 'B1' }, { zodu_id: 'Z001' }, { zodu_id: 'Z001', branch_id: 'B1', employee_id: 'nope' }]) {
    expect((await identify(as('t'), fields)).status).toBe(400);
  }
  const noPhoto = await request(app).post('/internal/faces/identify').set(as('t')).field('zodu_id', 'Z001').field('branch_id', 'B1');
  expect(noPhoto.status).toBe(400);
  expect(faceRepo.findCandidates).not.toHaveBeenCalled();
  expect(faceClient.getEmbedding).not.toHaveBeenCalled();
});
