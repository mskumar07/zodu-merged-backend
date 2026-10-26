const { FACE_SERVICE_URL } = require('../config');
const { BaseError } = require('./error/errors');

// face-service runs the model on CPU; a VPS takes a second or two per photo.
const TIMEOUT_MS = 20000;

const REASONS = {
  no_face:        'No face found. Look straight at the camera in good light and try again.',
  multiple_faces: 'More than one face in the photo. Make sure only one person is in frame.',
  invalid_image:  'The photo could not be read. Please capture it again.',
};

/**
 * The 512-d L2-normalised embedding of the single face in [file] (a multer
 * file). Throws a 422 BaseError the app can show as-is when no usable face is
 * found, and a 503 when face-service is unreachable.
 */
exports.getEmbedding = async (file) => {
  const form = new FormData();
  form.append(
    'file',
    new Blob([file.buffer], { type: file.mimetype || 'image/jpeg' }),
    file.originalname || 'face.jpg',
  );

  let body;
  try {
    const res = await fetch(`${FACE_SERVICE_URL}/embedding`, {
      method: 'POST',
      body:   form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`face-service HTTP ${res.status}`);
    body = await res.json();
  } catch (err) {
    console.error('face-service call failed:', err.message);
    throw BaseError('face service unavailable', 503,
      'Face recognition is unavailable right now. Please try again shortly.');
  }

  if (!body.success || !Array.isArray(body.embedding)) {
    throw BaseError('face not usable', 422, REASONS[body.reason] || REASONS.no_face);
  }
  return body.embedding.map(Number);
};

/** Cosine similarity of two L2-normalised vectors (a plain dot product). */
exports.similarity = (a, b) => {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
};
