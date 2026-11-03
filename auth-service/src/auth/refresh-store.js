// Refresh tokens (RFC 9700): opaque, single use, rotated on every refresh,
// grouped in families (one per device login). Only SHA-256 hashes are stored.
//
// Redis keys
//   rt:<hash>          → family id; the family's current token (TTL: idle timeout)
//   rtused:<hash>      → { fid, at, next }: a token already rotated (reuse detection)
//   fam:<fid>          hash { uid, plt, zid, bid, created, abs, rt } (TTL: absolute lifetime)
//   ufam:<uid>         set of the user's family ids (revokeAllForUser)
//   revoked:sid:<fid>  deny-list for access tokens still in flight (read by authenticate())
//
// Reusing a rotated token revokes the whole family, except during a short grace
// window: parallel requests that all hit an expired access token refresh with
// the same token, and get the same successor. The successor is stored only
// encrypted with a key derived from the old token, so it is useless to anyone
// who doesn't already hold that token.
//
// The family id is also the tbl_user_sessions row id and the access token's sid.

const crypto = require('node:crypto');
const { revokedSessionKey } = require('@zodu/security');

const TOKEN_BYTES = 48;
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('base64url');
const newToken = () => crypto.randomBytes(TOKEN_BYTES).toString('base64url');
const nowSec = () => Math.floor(Date.now() / 1000);

// Refresh tokens are 48 random bytes, base64url: 64 characters.
const looksOpaque = (t) => typeof t === 'string' && /^[A-Za-z0-9_-]{64}$/.test(t);

// The successor, encrypted with a key only the holder of the old token can derive.
function sealFor(oldToken, plaintext) {
  const key = crypto.hkdfSync('sha256', oldToken, 'zodu-refresh-grace', 'successor', 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key), iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

function openWith(oldToken, sealed) {
  try {
    const raw = Buffer.from(sealed, 'base64url');
    const key = crypto.hkdfSync('sha256', oldToken, 'zodu-refresh-grace', 'successor', 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

// One atomic step: take the token (GETDEL), mark it used with its successor,
// store the successor. Parallel refreshes with the same token therefore always
// find either the token or the used marker, never neither.
//   KEYS: rt:<old>, rtused:<old>, rt:<new>   ARGV: now, idle seconds, sealed successor, new hash
//   → { 0 } unknown, { 1, fid } family gone, { 2, fid } past absolute lifetime, { 3, fid } rotated
// (The family key is derived inside: single-node Redis, as deployed.)
const ROTATE = `
local fid = redis.call('GETDEL', KEYS[1])
if not fid then return {0} end
local fam = 'fam:' .. fid
if redis.call('EXISTS', fam) == 0 then return {1, fid} end
local now = tonumber(ARGV[1])
local abs = tonumber(redis.call('HGET', fam, 'abs'))
if abs <= now then return {2, fid} end
local ttl = math.min(tonumber(ARGV[2]), abs - now)
redis.call('SET', KEYS[2], cjson.encode({ fid = fid, at = now, next = ARGV[3] }), 'EX', ttl)
redis.call('SET', KEYS[3], fid, 'EX', ttl)
redis.call('HSET', fam, 'rt', ARGV[4])
return {3, fid}
`;

function createRefreshStore({ redis, idleSeconds, maxSeconds, graceSeconds, accessTtlSeconds }) {
  const famKey = (fid) => `fam:${fid}`;
  const userKey = (uid) => `ufam:${uid}`;

  const parseFamily = (h, fid) => (h && h.uid ? {
    fid,
    userId: h.uid,
    platform: h.plt,
    zoduId: h.zid || null,
    branchId: h.bid || null,
    created: Number(h.created),
    absoluteExpiry: Number(h.abs),
    current: h.rt,
  } : null);

  async function getFamily(fid) {
    return parseFamily(await redis.hgetall(famKey(fid)), fid);
  }

  // A new login on one device. Returns the first refresh token.
  async function createFamily({ fid, userId, platform, zoduId, branchId }) {
    const token = newToken();
    const h = hashToken(token);
    const now = nowSec();
    const abs = now + maxSeconds;
    await redis.multi()
      .hset(famKey(fid), { uid: userId, plt: platform, zid: zoduId || '', bid: branchId || '', created: now, abs, rt: h })
      .expire(famKey(fid), maxSeconds)
      .set(`rt:${h}`, fid, 'EX', Math.min(idleSeconds, maxSeconds))
      .sadd(userKey(userId), fid)
      .expire(userKey(userId), maxSeconds)
      .exec();
    return { token, absoluteExpiry: abs };
  }

  // { status: 'ok', token, family }        rotated (or the grace-window replay)
  // { status: 'invalid' }                  unknown, expired by idle timeout, or family revoked
  // { status: 'expired', family }          absolute lifetime reached (family revoked)
  // { status: 'reuse', family }            an already-used token: family revoked
  async function rotate(token) {
    if (!looksOpaque(token)) return { status: 'invalid' };
    const h = hashToken(token);
    const next = newToken();
    const nh = hashToken(next);
    const [code, fid] = await redis.eval(ROTATE, 3, `rt:${h}`, `rtused:${h}`, `rt:${nh}`,
      nowSec(), idleSeconds, sealFor(token, next), nh);

    if (code === 3) {
      const family = await getFamily(fid);
      return family ? { status: 'ok', token: next, family } : { status: 'invalid' };
    }
    if (code === 1) return { status: 'invalid' };
    if (code === 2) {
      const family = await getFamily(fid);
      await revokeFamily(fid);
      return { status: 'expired', family };
    }

    // Not a current token: already rotated, or never valid.
    const usedRaw = await redis.get(`rtused:${h}`);
    if (!usedRaw) return { status: 'invalid' };
    const used = JSON.parse(usedRaw);
    const family = await getFamily(used.fid);
    if (!family) return { status: 'invalid' };   // already revoked
    if (nowSec() - used.at <= graceSeconds && used.next) {
      const successor = openWith(token, used.next);
      if (successor && family.current === hashToken(successor)) return { status: 'ok', token: successor, family, replay: true };
    }
    await revokeFamily(used.fid);
    return { status: 'reuse', family };
  }

  // The family of a current token, without rotating it.
  async function peek(token) {
    if (!looksOpaque(token)) return null;
    const fid = await redis.get(`rt:${hashToken(token)}`);
    return fid ? getFamily(fid) : null;
  }

  // Pre-ES256 refresh JWTs are exchanged once. Parallel requests carrying the
  // same old token within the grace window get the same new session.
  async function rememberLegacyExchange(oldToken, fid, successor) {
    await redis.set(`legacyused:${hashToken(oldToken)}`,
      JSON.stringify({ fid, at: nowSec(), next: sealFor(oldToken, successor) }), 'EX', Math.max(graceSeconds, 1));
  }

  async function replayLegacyExchange(oldToken) {
    const raw = await redis.get(`legacyused:${hashToken(oldToken)}`);
    if (!raw) return null;
    const used = JSON.parse(raw);
    const family = await getFamily(used.fid);
    const successor = family && openWith(oldToken, used.next);
    if (!successor || family.current !== hashToken(successor)) return null;
    return { token: successor, family };
  }

  // Family id of a token that is current or was recently rotated (logout).
  async function familyOf(token) {
    if (!looksOpaque(token)) return null;
    const h = hashToken(token);
    const fid = await redis.get(`rt:${h}`);
    if (fid) return fid;
    const used = await redis.get(`rtused:${h}`);
    return used ? JSON.parse(used).fid : null;
  }

  async function updateFamily(fid, { platform, zoduId, branchId }) {
    const fields = {};
    if (platform) fields.plt = platform;
    if (zoduId !== undefined) fields.zid = zoduId || '';
    if (branchId !== undefined) fields.bid = branchId || '';
    if (Object.keys(fields).length) await redis.hset(famKey(fid), fields);
  }

  // Access tokens of this family are refused from now on (when
  // AUTH_CHECK_REVOKED_SESSIONS is on) and its refresh token stops working.
  async function revokeFamily(fid) {
    const family = await getFamily(fid);
    const m = redis.multi()
      .del(famKey(fid))
      .set(revokedSessionKey(fid), '1', 'EX', accessTtlSeconds + 60);
    if (family) m.del(`rt:${family.current}`).srem(userKey(family.userId), fid);
    await m.exec();
    return family;
  }

  async function revokeAllForUser(userId) {
    const fids = await redis.smembers(userKey(userId));
    for (const fid of fids) await revokeFamily(fid);
    await redis.del(userKey(userId));
    return fids;
  }

  async function familiesOf(userId) {
    const fids = await redis.smembers(userKey(userId));
    const families = await Promise.all(fids.map(getFamily));
    return families.filter(Boolean);
  }

  return {
    createFamily, rotate, peek, familyOf, getFamily, updateFamily, revokeFamily, revokeAllForUser, familiesOf,
    rememberLegacyExchange, replayLegacyExchange,
  };
}

module.exports = { createRefreshStore, hashToken, looksOpaque };
