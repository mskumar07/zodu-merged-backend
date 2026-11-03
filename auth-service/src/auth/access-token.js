// Issues the customer access token (RFC 9068 profile), verified by every
// service with authenticate() from @zodu/security.
//
//   header  { alg: ES256, typ: at+jwt, kid }
//   claims  sub (user_id), zid (active zodu_id), bid (active branch_id),
//           role, perms[], utype (user_type), plt (web | desktop | mobile | unknown),
//           sid (session family), iss, aud, iat, nbf, exp, jti
//
// No PII or secrets: no email, phone, GSTIN, PAN, bank details or salary.

const crypto = require('node:crypto');
const { DEFAULT_ISSUER, DEFAULT_AUDIENCE, ACCESS_TOKEN_TYPE } = require('@zodu/security');

function createAccessTokenIssuer({ keys, config }) {
  const issuer = config.JWT_ISSUER || DEFAULT_ISSUER;
  const audience = config.JWT_AUDIENCE || DEFAULT_AUDIENCE;
  const ttl = config.ACCESS_TOKEN_TTL_SECONDS;

  async function issue({ userId, zoduId, branchId, role, perms, userType, platform, sessionId }) {
    const jose = require('jose');
    const accessToken = await new jose.SignJWT({
      zid: zoduId,
      bid: branchId ?? null,
      role: role ?? null,
      perms: perms ?? [],
      utype: userType ?? null,
      plt: platform,
      sid: sessionId,
    })
      .setProtectedHeader({ alg: 'ES256', typ: ACCESS_TOKEN_TYPE, kid: keys.kid })
      .setSubject(userId)
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setNotBefore('0s')
      .setExpirationTime(`${ttl}s`)
      .setJti(crypto.randomUUID())
      .sign(keys.privateKey);
    return { access_token: accessToken, token_type: 'Bearer', expires_in: ttl };
  }

  return { issue, issuer, audience };
}

module.exports = { createAccessTokenIssuer };
