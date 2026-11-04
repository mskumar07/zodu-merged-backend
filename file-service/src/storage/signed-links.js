// Expiring links for the two kinds of file URL that are stored in the
// services' tables and sent back by clients when they save a record, so the
// URL itself must stay the same:
//   <origin>/files/v/<file_id>          'link' modules (logo, invoice images, menu photos, staged uploads)
//   <origin>/{service}/file/<key>       files stored before file-service (old bucket)
// Responses carry them with ?exp=&sig= added (HMAC over the file + expiry,
// signed here, or for the services via /internal/sign-links); GET /files/v/:id
// and GET /legacy/* refuse anything else.
//
// exp is rounded up to a whole window, so a URL stays the same (and cacheable)
// for one TTL window and is valid for one to two windows.
//
// A link signed for a user carries &u=<userId>, covered by the signature. With
// FILE_LINKS_REQUIRE_AUTH it only opens with that user's Bearer token, so a
// copied link is useless to anyone else (storage/link-access.js).

const crypto = require('crypto');

const SERVICES = ['auth', 'employee', 'restaurant', 'retail', 'checklist'];
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
// Any old ?exp=&sig= is dropped and signed again.
const STABLE_URL = new RegExp(`^(https?://[^/?#]+/files/v/)(${UUID})(?:\\?[^#]*)?$`, 'i');
const LEGACY_URL = new RegExp(`^(https?://[^/?#]+/(?:${SERVICES.join('|')})/file/)([^?#]+)(?:\\?[^#]*)?$`, 'i');
const MAX_URL = 2048;
const USER_ID = /^[A-Za-z0-9_.:@-]{1,100}$/;

function createSignedLinks({ secret, ttlSeconds, now = Date.now }) {
  const key = Buffer.from(String(secret));
  const mac = (subject, exp, userId) => crypto.createHmac('sha256', key)
    .update(userId ? `${subject}\n${exp}\nu:${userId}` : `${subject}\n${exp}`)
    .digest('base64url');

  // The object key a legacy URL path names (segments are URL-encoded), else null.
  const keyOf = (path) => {
    try {
      const k = path.split('/').map(decodeURIComponent).join('/');
      return k && !k.includes('..') && !k.startsWith('/') && k.length <= 1024 ? k : null;
    } catch {
      return null;
    }
  };

  // What a URL's signature covers: 'v\n<file_id>' or 'legacy\n<key>'.
  function subjectOf(url) {
    if (typeof url !== 'string' || url.length > MAX_URL) return null;
    let m = STABLE_URL.exec(url);
    if (m) return { base: m[1] + m[2], subject: `v\n${m[2].toLowerCase()}` };
    m = LEGACY_URL.exec(url);
    const objectKey = m && keyOf(m[2]);
    return objectKey ? { base: m[1] + m[2], subject: `legacy\n${objectKey}` } : null;
  }

  // Stored URL → the same URL with a fresh ?exp=[&u=]&sig=, or null if it is
  // neither kind. userId: the user the link is issued to (left out if unknown).
  function sign(url, userId = null) {
    const s = subjectOf(url);
    if (!s) return null;
    const exp = (Math.floor(now() / 1000 / ttlSeconds) + 2) * ttlSeconds;
    const uid = userId != null && USER_ID.test(String(userId)) ? String(userId) : null;
    return uid
      ? `${s.base}?exp=${exp}&u=${encodeURIComponent(uid)}&sig=${mac(s.subject, exp, uid)}`
      : `${s.base}?exp=${exp}&sig=${mac(s.subject, exp)}`;
  }

  // { validFor: seconds left, userId: who it was issued to, or null }, or null
  // if it is not a valid link for subject.
  function check(subject, { exp, sig, u } = {}) {
    if (typeof exp !== 'string' || typeof sig !== 'string' || !/^\d{1,12}$/.test(exp)) return null;
    if (u !== undefined && (typeof u !== 'string' || !USER_ID.test(u))) return null;
    const left = Number(exp) - Math.floor(now() / 1000);
    if (left <= 0 || left > 2 * ttlSeconds) return null;
    const want = Buffer.from(mac(subject, exp, u || null));
    const got = Buffer.from(sig);
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
    return { validFor: left, userId: u || null };
  }

  return {
    sign,
    checkStable: (fileId, query) => check(`v\n${String(fileId).toLowerCase()}`, query),
    checkLegacy: (objectKey, query) => check(`legacy\n${objectKey}`, query),
  };
}

module.exports = { createSignedLinks, STABLE_URL, LEGACY_URL };
