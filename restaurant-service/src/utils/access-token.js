// Customer access tokens (ES256, issued by auth-service), checked against
// auth-service's public keys: AUTH_JWKS_URL, else AUTH_SERVICE_URL +
// /.well-known/jwks.json. Same file in retail-service and restaurant-service.
//
//   router.get('/x', authenticate, handler)   req.auth = { userId, zoduId, branchId, role, perms, ... }
//   await optionalAuth(req)                   req.auth or null, for routes that never required a token

const { createAccessTokenVerifier, createAuthenticate, jwksUrlFromEnv } = require('@zodu/security');
const { AUTH_SERVICE_URL } = require('../config');

let verifier;
const getVerifier = () => (verifier ??= createAccessTokenVerifier({
  jwksUrl: jwksUrlFromEnv({ AUTH_SERVICE_URL, ...process.env }),
  onError: (err) => console.warn('[auth] access token keys unavailable:', err.message),
}));

// Same error body as the routes here: { error }.
const respond = (_req, res, status, message) => res.status(status).json({ error: message });

function authenticate(req, res, next) {
  return createAuthenticate({ verifier: getVerifier(), respond }).authenticate(req, res, next);
}

const BEARER = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/;

async function optionalAuth(req) {
  const match = BEARER.exec(req.get('Authorization') || '');
  if (!match) return null;
  try {
    return await getVerifier().verify(match[1]);
  } catch {
    return null;
  }
}

module.exports = { authenticate, optionalAuth };
