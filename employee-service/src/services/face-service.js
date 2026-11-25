const repo       = require('../repository/face-repo');
const employeeRepo = require('../repository/employee-repo');
const faceClient = require('../utils/face-client');
const { BaseError } = require('../utils/error/errors');
const { FACE_MIN_SIMILARITY } = require('../config');

// This service owns faces: registering them and telling who is in a photo.
// Attendance itself (the check-in / check-out rows) is attendance-service's;
// it calls identifyFace() through POST /internal/faces/identify and records
// the punch in its own database.

// When identifying among the whole branch, the best match must beat the
// runner-up by this much, or two employees look too alike to choose.
const MIN_MATCH_MARGIN = 0.05;

// ── REGISTER / STATUS / REMOVE ────────────────────────────────────────────────

exports.registerFace = async ({ employee_id, zodu_id, branch_id, file }) => {
  const employee = await repo.findEmployee({ employee_id, zodu_id, branch_id });
  if (!employee) throw BaseError('not found', 404, 'Employee not found');

  const embedding = await faceClient.getEmbedding(file);
  const saved = await repo.upsertFace({ employee_id, zodu_id, branch_id, embedding });
  return {
    success: true,
    message: 'Face registered',
    data: { registered: true, updated_at: saved.updated_at },
  };
};

exports.getFaceStatus = async (employee_id, { zodu_id, branch_id }) => {
  if (!(await repo.findEmployee({ employee_id, zodu_id, branch_id }))) throw BaseError('not found', 404, 'Employee not found');
  const row = await repo.findFaceStatus(employee_id);
  return {
    success: true,
    data: { registered: !!row, updated_at: row?.updated_at || null },
  };
};

exports.deleteFace = async (employee_id, { zodu_id, branch_id }) => {
  if (!(await repo.findEmployee({ employee_id, zodu_id, branch_id }))) throw BaseError('not found', 404, 'Employee not found');
  await repo.deleteFace(employee_id);
  return { success: true, message: 'Face removed', data: { registered: false } };
};

// ── SELF  (the signed-in employee's own face, from the attendance app) ───────

/** The caller's own active employee record in this company / branch. */
const findSelf = async ({ user_id, zodu_id, branch_id }) => {
  const own = await employeeRepo.findByUser(user_id, { zodu_id, branch_id });
  const employee = own && await repo.findEmployee({ employee_id: own.employee_id, zodu_id, branch_id });
  if (!employee) throw BaseError('not found', 404, 'No employee record for this user');
  if (employee.status && employee.status !== 'active') {
    throw BaseError('inactive', 403, 'Your employee record is inactive');
  }
  return employee;
};

exports.getMyFaceStatus = async ({ user_id, zodu_id, branch_id }) => {
  const me = await findSelf({ user_id, zodu_id, branch_id });
  const row = await repo.findFaceStatus(me.employee_id);
  return { success: true, data: { registered: !!row, updated_at: row?.updated_at || null } };
};

// First enrolment only. Replacing a face is a manager's job (employee:edit):
// otherwise anyone could swap in a colleague's face and punch for them.
exports.registerMyFace = async ({ user_id, zodu_id, branch_id, file }) => {
  const me = await findSelf({ user_id, zodu_id, branch_id });
  if (await repo.findFaceStatus(me.employee_id)) {
    throw BaseError('exists', 409, 'Your face is already registered. Ask your manager to update it.');
  }
  const embedding = await faceClient.getEmbedding(file);
  const saved = await repo.upsertFace({ employee_id: me.employee_id, zodu_id, branch_id, embedding });
  return {
    success: true,
    message: 'Face registered',
    data: { registered: true, updated_at: saved.updated_at },
  };
};

// ── IDENTIFY  (for attendance-service's face check-in / check-out) ────────────
// Who is in the photo: among the branch's active staff with a registered face,
// or only [employee_id] when the caller already knows who should be in it
// (self check-in). Throws a 4xx the app can show as-is when nobody matches.

exports.identifyFace = async ({ zodu_id, branch_id, employee_id, file }) => {
  const candidates = await repo.findCandidates({ zodu_id, branch_id, employee_id });
  if (!candidates.length) {
    throw BaseError('no faces', 404, employee_id
      ? 'Your face is not registered yet. Set it up from Profile → Face Check-in.'
      : 'No faces are registered for this branch yet.');
  }

  const embedding = await faceClient.getEmbedding(file);
  const scored = candidates
    .map((c) => ({ ...c, score: faceClient.similarity(embedding, c.embedding) }))
    .sort((a, b) => b.score - a.score);

  const [best, runnerUp] = scored;
  if (best.score < FACE_MIN_SIMILARITY) {
    throw BaseError('no match', 422, employee_id
      ? 'Face does not match. Look straight at the camera in good light and try again.'
      : 'Face not recognised. Make sure the face is registered and try again.');
  }
  if (runnerUp && runnerUp.score >= FACE_MIN_SIMILARITY &&
      best.score - runnerUp.score < MIN_MATCH_MARGIN) {
    throw BaseError('ambiguous', 422,
      'Could not tell who this is. Please try again facing the camera.');
  }
  return {
    success: true,
    data: {
      employee_id:   best.employee_id,
      employee_name: best.employee_name,
      employee_code: best.employee_code,
      similarity:    Number(best.score.toFixed(3)),
    },
  };
};
