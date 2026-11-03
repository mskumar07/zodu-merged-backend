// Per-request helpers for the token endpoints: client platform, the web
// refresh cookie, and the security event log.

const config = require('../config');
const { logger } = require('../utils/logger');
const sessionRepo = require('../repository/session-repo');

const PLATFORMS = new Set(['web', 'desktop', 'mobile']);
// Clients from before X-Client-Platform: refresh token in the body (as before).
const UNKNOWN_PLATFORM = 'unknown';
const REFRESH_COOKIE = 'rt';

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let lastMissingWarning = 0;

// 'web' | 'desktop' | 'mobile', or 'unknown' while the header is optional.
function readPlatform(req) {
  const raw = req.get('X-Client-Platform');
  if (raw === undefined || raw === '') {
    if (config.AUTH_REQUIRE_PLATFORM_HEADER) throw new RequestError(400, 'X-Client-Platform header is required');
    if (Date.now() - lastMissingWarning > 60_000) {
      lastMissingWarning = Date.now();
      logger.warn({ path: req.path }, 'X-Client-Platform missing: refresh token sent in the body (legacy client)');
    }
    return UNKNOWN_PLATFORM;
  }
  const platform = String(raw).trim().toLowerCase();
  if (!PLATFORMS.has(platform)) throw new RequestError(400, 'X-Client-Platform must be web, desktop or mobile');
  return platform;
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

// Web clients: the refresh token never reaches JavaScript.
function setRefreshCookie(res, token, maxAgeSeconds) {
  res.append('Set-Cookie', [
    `${REFRESH_COOKIE}=${token}`, 'HttpOnly', 'Secure', 'SameSite=Strict',
    `Path=${config.REFRESH_COOKIE_PATH}`, `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ].join('; '));
}

function clearRefreshCookie(res) {
  res.append('Set-Cookie', [
    `${REFRESH_COOKIE}=`, 'HttpOnly', 'Secure', 'SameSite=Strict', `Path=${config.REFRESH_COOKIE_PATH}`, 'Max-Age=0',
  ].join('; '));
}

// web reads the cookie; desktop, mobile and legacy clients send it in the body.
// A web client that just started sending X-Client-Platform still holds its old
// body-mode token once: accepted from the body when there is no cookie (the
// session's platform binding still applies).
function readRefreshToken(req, platform) {
  const fromBody = typeof req.body?.refresh_token === 'string' && req.body.refresh_token.length <= 4096
    ? req.body.refresh_token : null;
  if (platform === 'web') return readCookie(req, REFRESH_COOKIE) || fromBody;
  return fromBody;
}

const requestMeta = (req) => ({
  ip_address: req.ip,
  user_agent: req.get('user-agent') || null,
});

// Never blocks or fails the request it describes.
function recordEvent(req, event, { userId, zoduId, platform, details } = {}) {
  sessionRepo.insertSecurityEvent({
    user_id: userId,
    zodu_id: zoduId,
    event,
    ip: req?.ip,
    user_agent: req?.get?.('user-agent'),
    platform,
    details,
  }).catch((err) => logger.error({ err: err.message, event }, 'security event not recorded'));
}

module.exports = {
  PLATFORMS, UNKNOWN_PLATFORM, REFRESH_COOKIE, RequestError,
  readPlatform, readCookie, setRefreshCookie, clearRefreshCookie, readRefreshToken, requestMeta, recordEvent,
};
