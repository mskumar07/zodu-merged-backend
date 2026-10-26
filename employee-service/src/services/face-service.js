const db         = require('../database/connection');
const repo       = require('../repository/face-repo');
const faceClient = require('../utils/face-client');
const { BaseError } = require('../utils/error/errors');
const { FACE_MIN_SIMILARITY } = require('../config');

// Two scans this close together are the same punch, not check-in then out.
const MIN_PUNCH_GAP_MS = 60 * 1000;
// When identifying among the whole branch, the best match must beat the
// runner-up by this much, or two employees look too alike to choose.
const MIN_MATCH_MARGIN = 0.05;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Today's date in IST, as attendance rows are dated. */
const todayIst = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

const timeIst = (date) =>
  new Date(date).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true,
  });

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

exports.getFaceStatus = async (employee_id) => {
  const row = await repo.findFaceStatus(employee_id);
  return {
    success: true,
    data: { registered: !!row, updated_at: row?.updated_at || null },
  };
};

exports.deleteFace = async (employee_id) => {
  await repo.deleteFace(employee_id);
  return { success: true, message: 'Face removed', data: { registered: false } };
};

// ── MARK ATTENDANCE BY FACE ───────────────────────────────────────────────────
// Identifies who is in the photo — among the whole branch, or only
// [employee_id] when given — then punches: check-in if not in yet today,
// check-out if in, refused once both are recorded.

const identify = async ({ zodu_id, branch_id, employee_id, file }) => {
  const candidates = await repo.findCandidates({ zodu_id, branch_id, employee_id });
  if (!candidates.length) {
    throw BaseError('no faces', 404, employee_id
      ? 'Face is not registered for this employee. Register it from the employee profile.'
      : 'No faces are registered for this branch yet.');
  }

  const embedding = await faceClient.getEmbedding(file);
  const scored = candidates
    .map((c) => ({ ...c, score: faceClient.similarity(embedding, c.embedding) }))
    .sort((a, b) => b.score - a.score);

  const [best, runnerUp] = scored;
  if (best.score < FACE_MIN_SIMILARITY) {
    throw BaseError('no match', 422, employee_id
      ? 'Face does not match this employee.'
      : 'Face not recognised. Make sure the face is registered and try again.');
  }
  if (runnerUp && runnerUp.score >= FACE_MIN_SIMILARITY &&
      best.score - runnerUp.score < MIN_MATCH_MARGIN) {
    throw BaseError('ambiguous', 422,
      'Could not tell who this is. Please try again facing the camera.');
  }
  return best;
};

exports.markByFace = async ({ zodu_id, branch_id, employee_id, marked_by, marked_by_name, file }) => {
  const match = await identify({ zodu_id, branch_id, employee_id, file });
  const attendance_date = todayIst();

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const today = await repo.findTodayForUpdate(client, {
      employee_id: match.employee_id, attendance_date,
    });

    let type;
    let times;
    if (!today || !today.check_in_time || today.status !== 'Present') {
      type  = 'in';
      times = await repo.checkIn(client, {
        zodu_id, branch_id, attendance_date,
        employee_id: match.employee_id,
        // Self check-in on a shared device: record the employee themselves
        // when the caller didn't say who operated it.
        marked_by:      UUID_RE.test(marked_by || '') ? marked_by : match.employee_id,
        marked_by_name: marked_by_name || match.employee_name,
      });
    } else if (!today.check_out_time) {
      if (Date.now() - new Date(today.check_in_time).getTime() < MIN_PUNCH_GAP_MS) {
        throw BaseError('duplicate', 409,
          `${match.employee_name} already checked in at ${timeIst(today.check_in_time)}.`);
      }
      type  = 'out';
      times = await repo.checkOut(client, { employee_id: match.employee_id, attendance_date });
    } else {
      throw BaseError('completed', 409,
        `${match.employee_name} has already checked in and out today.`);
    }

    await client.query('COMMIT');
    return {
      success: true,
      message: type === 'in' ? 'Checked in successfully' : 'Checked out successfully',
      data: {
        type,
        employee_id:     match.employee_id,
        employee_name:   match.employee_name,
        employee_code:   match.employee_code,
        attendance_date,
        check_in_time:   times.check_in_time,
        check_out_time:  times.check_out_time || null,
        similarity:      Number(match.score.toFixed(3)),
      },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};
