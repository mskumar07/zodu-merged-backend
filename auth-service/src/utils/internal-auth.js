const crypto = require('crypto');

// Shared-secret check for service-to-service routes: the caller sends its token
// in X-Internal-Token. Constant-time compare on SHA-256 digests (equal length).
// Unset or short (< 32 chars) secret → every call is refused.
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest();

function requireInternalToken(secret) {
  const expected = secret && secret.length >= 32 ? sha256(secret) : null;
  return (req, res, next) => {
    const presented = req.get('X-Internal-Token');
    if (!expected || !presented || !crypto.timingSafeEqual(sha256(presented), expected)) {
      return res.status(401).json({ success: false, message: 'Invalid internal token' });
    }
    next();
  };
}

module.exports = { requireInternalToken };
