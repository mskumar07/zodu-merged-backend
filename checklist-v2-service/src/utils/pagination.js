// Keyset cursors: opaque base64url of the last row's sort key.
const { badRequest } = require('./errors');

const encodeCursor = (key) => Buffer.from(JSON.stringify(key)).toString('base64url');

function decodeCursor(cursor) {
  if (cursor === undefined || cursor === null || cursor === '') return null;
  try {
    const key = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    if (!Array.isArray(key)) throw new Error('not an array');
    return key;
  } catch {
    throw badRequest('Invalid cursor', 'INVALID_CURSOR');
  }
}

function clampLimit(value, def, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(n, max);
}

module.exports = { encodeCursor, decodeCursor, clampLimit };
