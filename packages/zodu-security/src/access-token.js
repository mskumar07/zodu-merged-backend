// Verifies the customer access tokens auth-service issues (RFC 9068 profile,
// RFC 8725 practices):
//
//   - ES256 only: alg 'none', HS256 (including HS256 "signed" with the public
//     key) and every other algorithm are refused before any key is used
//   - header typ 'at+jwt'; iss, aud, exp, nbf checked, 30s clock tolerance
//   - the key is picked by kid from auth-service's JWKS, fetched over the
//     internal network and cached; an unknown kid triggers one refetch (with a
//     cooldown), then fails
//   - optionally, sessions revoked in the last minutes are refused at once
//     (AUTH_CHECK_REVOKED_SESSIONS=true, Redis deny-list written by auth-service)
//
// verify(token) resolves to req.auth:
//   { userId, zoduId, branchId, role, perms, userType, platform, sessionId, tokenId, expiresAt }
// and rejects with a TokenError: status 401 (bad token) or 503 (keys unreachable).

const DEFAULT_ISSUER = 'zodu-auth';
const DEFAULT_AUDIENCE = 'zodu-api';
const ACCESS_TOKEN_TYPE = 'at+jwt';
const ALGORITHM = 'ES256';
// Deny-list key for a revoked session family; auth-service writes it.
const revokedSessionKey = (sid) => `revoked:sid:${sid}`;

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_TOKEN_LENGTH = 8192;
const MAX_PERMS = 500;

class TokenError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'TokenError';
    this.status = status;
  }
}

// The keys couldn't be fetched (auth-service down, timeout, broken JWKS):
// a 503, not the user's fault. Every other jose error is a bad token.
const UNAVAILABLE = new Set(['ERR_JWKS_TIMEOUT', 'ERR_JWKS_INVALID', 'ERR_JOSE_GENERIC']);
const keysUnavailable = (err) => UNAVAILABLE.has(err?.code) || !String(err?.code || '').startsWith('ERR_J');

function jwksUrlFromEnv(env = process.env) {
  if (env.AUTH_JWKS_URL) return env.AUTH_JWKS_URL;
  if (env.AUTH_SERVICE_URL) return `${env.AUTH_SERVICE_URL.replace(/\/+$/, '')}/.well-known/jwks.json`;
  return undefined;
}

function toAuth(p) {
  const ok = typeof p.sub === 'string' && p.sub.length <= 64
    && SAFE_ID.test(String(p.zid ?? ''))
    && (p.bid == null || SAFE_ID.test(String(p.bid)))
    && typeof p.sid === 'string' && p.sid.length <= 64
    && (p.perms === undefined || (Array.isArray(p.perms) && p.perms.length <= MAX_PERMS
      && p.perms.every((x) => typeof x === 'string' && x.length <= 64)));
  if (!ok) throw new TokenError(401, 'Invalid token');
  return {
    userId: p.sub,
    zoduId: p.zid,
    branchId: p.bid ?? null,
    role: typeof p.role === 'string' ? p.role : null,
    perms: p.perms ?? [],
    userType: typeof p.utype === 'string' ? p.utype : null,
    platform: typeof p.plt === 'string' ? p.plt : null,
    sessionId: p.sid,
    tokenId: p.jti,
    expiresAt: p.exp,
  };
}

// jwksUrl   auth-service's /.well-known/jwks.json on the internal network
//           (default: AUTH_JWKS_URL, else AUTH_SERVICE_URL + that path)
// keySet    instead of jwksUrl: a jose key-set function (auth-service's own keys, tests)
// redis     ioredis client, for the revoked-session check
function createAccessTokenVerifier({
  jwksUrl = jwksUrlFromEnv(),
  keySet,
  issuer = process.env.JWT_ISSUER || DEFAULT_ISSUER,
  audience = process.env.JWT_AUDIENCE || DEFAULT_AUDIENCE,
  clockTolerance = 30,
  redis,
  checkRevoked = process.env.AUTH_CHECK_REVOKED_SESSIONS === 'true',
  onError,
} = {}) {
  const jose = require('jose');
  if (!keySet && !jwksUrl) throw new Error('createAccessTokenVerifier: jwksUrl (or AUTH_SERVICE_URL) is required');
  const getKey = keySet ?? jose.createRemoteJWKSet(new URL(jwksUrl), {
    timeoutDuration: 5_000,
    cooldownDuration: 30_000,      // at most one refetch per 30s for unknown kids
    cacheMaxAge: 10 * 60_000,
  });
  if (checkRevoked && !redis) throw new Error('AUTH_CHECK_REVOKED_SESSIONS=true needs a Redis client');

  async function verify(token) {
    if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH || token.split('.').length !== 3) {
      throw new TokenError(401, 'Invalid token');
    }
    let payload;
    try {
      ({ payload } = await jose.jwtVerify(token, getKey, {
        algorithms: [ALGORITHM],
        typ: ACCESS_TOKEN_TYPE,
        issuer,
        audience,
        clockTolerance,
        requiredClaims: ['sub', 'zid', 'sid', 'jti', 'iat', 'nbf', 'exp'],
      }));
    } catch (err) {
      if (keysUnavailable(err)) {
        onError?.(err);
        throw new TokenError(503, 'Authentication is temporarily unavailable');
      }
      throw new TokenError(401, err.code === 'ERR_JWT_EXPIRED' ? 'Token expired' : 'Invalid token');
    }
    const auth = toAuth(payload);

    if (checkRevoked) {
      let revoked = false;
      try {
        revoked = Boolean(await redis.exists(revokedSessionKey(auth.sessionId)));
      } catch (err) {
        onError?.(err);   // Redis down: the token's 15 minutes still bound the session
      }
      if (revoked) throw new TokenError(401, 'Session revoked');
    }
    return auth;
  }

  return { verify };
}

module.exports = {
  createAccessTokenVerifier,
  jwksUrlFromEnv,
  revokedSessionKey,
  TokenError,
  DEFAULT_ISSUER,
  DEFAULT_AUDIENCE,
  ACCESS_TOKEN_TYPE,
};
