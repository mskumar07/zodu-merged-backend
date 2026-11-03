// ES256 signing key and the public JWKS (RFC 8725: one algorithm, keys by kid).
//
//   JWT_PRIVATE_KEY           PKCS#8 PEM of a P-256 key, or that PEM base64-encoded
//                             (env files can't hold multi-line values)
//   JWT_KID                   its key id
//   JWT_PREVIOUS_PUBLIC_KEY   during a rotation: the old public key (SPKI PEM / base64),
//   JWT_PREVIOUS_KID          published so tokens it signed stay valid until they expire
//
// Only auth-service holds the private key. Rotation: docs/security/auth.md.

const crypto = require('node:crypto');
const { logger } = require('../utils/logger');

function readPem(value) {
  if (!value) return null;
  const v = String(value).trim();
  if (v.includes('-----BEGIN')) return v.replace(/\\n/g, '\n');
  return Buffer.from(v, 'base64').toString('utf8');
}

async function publicJwk(jose, keyObject, kid) {
  return { ...(await jose.exportJWK(keyObject)), kid, alg: 'ES256', use: 'sig' };
}

async function loadKeys(config) {
  const jose = require('jose');
  let privatePem = readPem(config.JWT_PRIVATE_KEY);
  let kid = config.JWT_KID;

  if (!privatePem) {
    if (config.NODE_ENV === 'production') throw new Error('JWT_PRIVATE_KEY and JWT_KID are required');
    // Local development only: tokens stop verifying when the service restarts.
    privatePem = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
      .privateKey.export({ type: 'pkcs8', format: 'pem' });
    kid = `dev-${crypto.randomBytes(4).toString('hex')}`;
    logger.warn('JWT_PRIVATE_KEY not set: using a temporary signing key (development only)');
  }
  if (!kid) throw new Error('JWT_KID is required with JWT_PRIVATE_KEY');

  // importPKCS8 refuses anything that isn't a P-256 key for ES256.
  const privateKey = await jose.importPKCS8(privatePem, 'ES256');
  const keys = [await publicJwk(jose, crypto.createPublicKey(privatePem), kid)];

  const previousPem = readPem(config.JWT_PREVIOUS_PUBLIC_KEY);
  if (previousPem) {
    if (!config.JWT_PREVIOUS_KID || config.JWT_PREVIOUS_KID === kid) {
      throw new Error('JWT_PREVIOUS_KID is required and must differ from JWT_KID');
    }
    await jose.importSPKI(previousPem, 'ES256');   // same check for the old key
    keys.push(await publicJwk(jose, crypto.createPublicKey(previousPem), config.JWT_PREVIOUS_KID));
  }

  const jwks = { keys };
  return { privateKey, kid, jwks, keySet: jose.createLocalJWKSet(jwks) };
}

module.exports = { loadKeys, readPem };
