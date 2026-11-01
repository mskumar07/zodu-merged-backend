const http = require('http');
const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const jose = require('jose');
const {
  createAccessTokenVerifier, createAuthenticate, requirePermission, requireRole,
  revokedSessionKey, permsFromAccessRows,
} = require('..');

const ISS = 'zodu-auth';
const AUD = 'zodu-api';
let key; let otherKey; let jwks; let keySet;

beforeAll(async () => {
  key = await jose.generateKeyPair('ES256', { extractable: true });
  otherKey = await jose.generateKeyPair('ES256', { extractable: true });
  const pub = { ...(await jose.exportJWK(key.publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
  jwks = { keys: [pub] };
  keySet = jose.createLocalJWKSet(jwks);
});

const claims = (extra = {}) => ({
  sub: 'u-1', zid: 'Z001', bid: 'B1', role: 'Manager', perms: ['expense:read'],
  utype: 'employee', plt: 'web', sid: 'fam-1', ...extra,
});

function sign(payload = claims(), { header = {}, signer = key.privateKey, exp = '15m', iss = ISS, aud = AUD } = {}) {
  return new jose.SignJWT(payload)
    .setProtectedHeader({ alg: 'ES256', typ: 'at+jwt', kid: 'k1', ...header })
    .setIssuer(iss).setAudience(aud).setIssuedAt().setNotBefore('0s').setExpirationTime(exp)
    .setJti(crypto.randomUUID())
    .sign(signer);
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const verifier = (opts = {}) => createAccessTokenVerifier({ keySet, issuer: ISS, audience: AUD, ...opts });

test('a valid token becomes req.auth', async () => {
  const auth = await verifier().verify(await sign());
  expect(auth).toMatchObject({
    userId: 'u-1', zoduId: 'Z001', branchId: 'B1', role: 'Manager', perms: ['expense:read'],
    userType: 'employee', platform: 'web', sessionId: 'fam-1',
  });
});

describe('rejected tokens → 401', () => {
  const rejects = async (token, opts) => {
    await expect(verifier(opts).verify(token)).rejects.toMatchObject({ status: 401 });
  };

  test('expired', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await new jose.SignJWT(claims())
      .setProtectedHeader({ alg: 'ES256', typ: 'at+jwt', kid: 'k1' })
      .setIssuer(ISS).setAudience(AUD).setIssuedAt(now - 3600).setNotBefore(now - 3600)
      .setExpirationTime(now - 60).setJti('j').sign(key.privateKey);
    await rejects(token);
  });

  test('tampered payload', async () => {
    const [h, , s] = (await sign()).split('.');
    await rejects(`${h}.${b64({ ...claims({ zid: 'Z999' }), iss: ISS, aud: AUD, exp: 9e9, nbf: 0, iat: 0, jti: 'x' })}.${s}`);
  });

  test('alg none', async () => {
    const body = b64({ ...claims(), iss: ISS, aud: AUD, exp: 9e9, nbf: 0, iat: 0, jti: 'x' });
    await rejects(`${b64({ alg: 'none', typ: 'at+jwt', kid: 'k1' })}.${body}.`);
  });

  test('HS256 signed with the public key (algorithm confusion)', async () => {
    const pem = await jose.exportSPKI(key.publicKey);
    const header = b64({ alg: 'HS256', typ: 'at+jwt', kid: 'k1' });
    const body = b64({ ...claims(), iss: ISS, aud: AUD, exp: 9e9, nbf: 0, iat: 0, jti: 'x' });
    const sig = crypto.createHmac('sha256', pem).update(`${header}.${body}`).digest('base64url');
    await rejects(`${header}.${body}.${sig}`);
  });

  test('old HS256 token signed with APP_SECRET', async () => {
    const token = await new jose.SignJWT({ user_id: 'u-1', zodu_id: 'Z001' })
      .setProtectedHeader({ alg: 'HS256' }).setExpirationTime('30d')
      .sign(new TextEncoder().encode('app-secret'));
    await rejects(token);
  });

  test('wrong typ', async () => rejects(await sign(claims(), { header: { typ: 'JWT' } })));
  test('wrong audience', async () => rejects(await sign(claims(), { aud: 'other-api' })));
  test('wrong issuer', async () => rejects(await sign(claims(), { iss: 'someone-else' })));
  test('unknown kid', async () => rejects(await sign(claims(), { header: { kid: 'nope' } })));
  test('signed by another key under our kid', async () => rejects(await sign(claims(), { signer: otherKey.privateKey })));
  test('missing tenant claim', async () => rejects(await sign({ ...claims(), zid: undefined })));
  test('malformed tenant claim', async () => rejects(await sign(claims({ zid: "Z1' OR 1=1" }))));
  test('not a JWT', async () => rejects('abc'));

  test('revoked session, when the deny-list is on', async () => {
    const redis = { exists: async (k) => (k === revokedSessionKey('fam-1') ? 1 : 0) };
    await rejects(await sign(), { redis, checkRevoked: true });
    await expect(verifier({ redis, checkRevoked: true }).verify(await sign(claims({ sid: 'fam-2' }))))
      .resolves.toMatchObject({ sessionId: 'fam-2' });
  });
});

describe('keys fetched from auth-service', () => {
  let server; let url; let up = true;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (!up) { res.statusCode = 500; return res.end(); }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(jwks));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${server.address().port}/.well-known/jwks.json`;
  });
  afterAll(() => server.close());

  test('verifies with the remote JWKS', async () => {
    const v = createAccessTokenVerifier({ jwksUrl: url, issuer: ISS, audience: AUD });
    await expect(v.verify(await sign())).resolves.toMatchObject({ userId: 'u-1' });
  });

  test('JWKS unreachable → 503', async () => {
    up = false;
    const v = createAccessTokenVerifier({ jwksUrl: url, issuer: ISS, audience: AUD });
    await expect(v.verify(await sign())).rejects.toMatchObject({ status: 503 });
    up = true;
  });
});

describe('middleware', () => {
  const app = express();
  beforeAll(() => {
    const { authenticate } = createAuthenticate({ verifier: verifier() });
    app.get('/me', authenticate, (req, res) => res.json(req.auth));
    app.get('/expense', authenticate, requirePermission('expense:read'), (req, res) => res.json({ ok: true }));
    app.delete('/expense', authenticate, requirePermission('expense:delete'), (req, res) => res.json({ ok: true }));
    app.get('/admin', authenticate, requireRole('Admin'), (req, res) => res.json({ ok: true }));
  });

  test('no token → 401 with WWW-Authenticate; token in the query string is ignored', async () => {
    const res = await request(app).get(`/me?access_token=${await sign()}`);
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });

  test('bad token → 401 invalid_token', async () => {
    const res = await request(app).get('/me').set('Authorization', 'Bearer a.b.c');
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/invalid_token/);
  });

  test('permission present → 200, missing → 403', async () => {
    const t = await sign();
    expect((await request(app).get('/expense').set('Authorization', `Bearer ${t}`)).status).toBe(200);
    expect((await request(app).delete('/expense').set('Authorization', `Bearer ${t}`)).status).toBe(403);
    expect((await request(app).get('/admin').set('Authorization', `Bearer ${t}`)).status).toBe(403);
  });

  test('the owner role passes permission checks', async () => {
    const t = await sign(claims({ role: 'Admin', perms: [] }));
    expect((await request(app).delete('/expense').set('Authorization', `Bearer ${t}`)).status).toBe(200);
  });
});

test('permissions come from tbl_access_control rows, any grant wins', () => {
  expect(permsFromAccessRows([
    { module_name: 'Expense', can_read: true, can_create: false, can_edit: false, can_delete: false },
    { module_name: 'Expense', can_read: false, can_create: true, can_edit: false, can_delete: false },
    { module_name: 'Staff / User Management', can_read: true, can_create: false, can_edit: true, can_delete: false },
    { module_name: 'New Thing', can_read: true },
  ])).toEqual(['employee:edit', 'employee:read', 'expense:create', 'expense:read', 'new_thing:read']);
});
