// Face identification for face check-in / check-out. Faces live in employee-service
// (registered embeddings + face-service); attendance rows live here. So this service asks
//   POST /internal/faces/identify   multipart: image + { zodu_id, branch_id, employee_id? }
// who is in the photo (caller name: attendance, INTERNAL_TOKEN — the same pairing as the
// roster call), then records the punch in its own database.

const { internalHeaders } = require('@zodu/security');
const { EMPLOYEE_SERVICE_URL } = require('../config');
const { httpError } = require('../utils/http-error');
const { logger } = require('../utils/logger');

// employee-service sends the photo on to face-service, which runs the model on CPU.
const TIMEOUT_MS = 30_000;
const BASE = String(EMPLOYEE_SERVICE_URL).replace(/\/+$/, '');

/**
 * { employee_id, employee_name, employee_code, similarity } of the face in [file] (a multer
 * file). With [employee_id] only that employee's face is compared. Nobody matching, no face
 * in the photo, etc. are 4xx errors whose message the app shows as-is; an unreachable
 * employee-service / face-service is a 503.
 */
async function identifyFace({ zodu_id, branch_id, employee_id, file }) {
  const form = new FormData();
  form.append('zodu_id', zodu_id);
  form.append('branch_id', branch_id);
  if (employee_id) form.append('employee_id', employee_id);
  form.append('image', new Blob([file.buffer], { type: file.mimetype || 'image/jpeg' }), file.originalname || 'face.jpg');

  let res;
  let body;
  try {
    res = await fetch(`${BASE}/internal/faces/identify`, {
      method: 'POST',
      headers: internalHeaders(),
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    body = await res.json().catch(() => ({}));
  } catch (err) {
    logger.error({ err: err.message }, '[face-identify] employee-service unreachable');
    throw unavailable();
  }

  if (res.ok && body?.data?.employee_id) return body.data;

  const message = body?.message || body?.error;
  // 400 / 404 / 409 / 422: a real answer about the photo or the employee — pass it on.
  if (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 403 && message) {
    throw httpError(res.status, message);
  }
  // 401 / 403 is a service-token misconfiguration, 5xx an outage: not the user's fault.
  logger.error({ status: res.status, message }, '[face-identify] identification failed');
  if (res.status === 503 && message) throw Object.assign(new Error(message), { status: 503 });
  throw unavailable();
}

const unavailable = () =>
  Object.assign(new Error('Face recognition is unavailable right now. Please try again shortly.'), { status: 503 });

module.exports = { identifyFace };
