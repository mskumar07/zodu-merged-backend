// Login, token refresh, logout and sessions (docs/security/auth.md).
//
// Every function returns { status, data, refresh?, retryAfter? }. The controller
// turns `refresh` into the web cookie or the refresh_token body field.
//
// Active company and branch (zid / bid in the access token):
//   - login uses the primary company (tbl_user_companies.is_primary, else the
//     oldest membership), the same company the apps open today;
//   - branch: B1 if the user may use it, else the first branch the user's roles
//     allow (Admin and company-wide roles: every active branch; other roles:
//     the branches they are assigned to);
//   - POST /api/switch-context changes both for the same session;
//   - refresh keeps the session's company and branch while the user still has
//     access to them, else falls back to the rule above.

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { createInternalHttp, permsFromAccessRows, OWNER_ROLE } = require('@zodu/security');

const config = require('../config');
const { logger } = require('../utils/logger');
const repo = require('../repository/auth-repo');
const businessRepo = require('../repository/business-repo');
const sessionRepo = require('../repository/session-repo');
const { auth } = require('../auth');
const { verifyPassword, hashPassword } = require('../auth/password');
const { looksOpaque } = require('../auth/refresh-store');
const { UNKNOWN_PLATFORM, readRefreshToken, recordEvent, requestMeta } = require('../auth/request');

const internalHttp = createInternalHttp(axios, { timeout: 10_000 });

const LOGIN_FAILED = 'Invalid email/phone or password';
const LOCKED = 'Too many failed attempts. Try again later.';
const REFRESH_FAILED = 'Invalid or expired refresh token';
const idleSeconds = () => config.REFRESH_IDLE_DAYS * 86_400;

const fail = (status, error, extra = {}) => ({ status, data: { error }, ...extra });

// ── active company / branch ───────────────────────────────────────────────────

// { zoduId, branchId, role, perms }, or null when strictBranch and the branch
// isn't one the user may use.
async function contextFor({ userId, zoduId, branchId = null, strictBranch = false }) {
  const [roles, branches] = await Promise.all([
    repo.getUserRolesInCompany({ user_id: userId, zodu_id: zoduId }),
    repo.getActiveBranchIds({ zodu_id: zoduId }),
  ]);
  const owner = roles.find((r) => r.role_name === OWNER_ROLE);
  const companyWide = Boolean(owner) || roles.some((r) => r.branch_id == null);
  const allowed = companyWide ? branches : branches.filter((b) => roles.some((r) => r.branch_id === b));

  let bid = branchId;
  if (bid && !allowed.includes(bid)) {
    if (strictBranch) return null;
    bid = null;
  }
  if (!bid) bid = allowed.includes('B1') ? 'B1' : (allowed[0] ?? null);

  const role = owner ?? roles.find((r) => r.branch_id === bid) ?? roles.find((r) => r.branch_id == null) ?? null;
  const access = await repo.getUserRoleAccess({ user_id: userId, zodu_id: zoduId, branch_id: bid });
  return { zoduId, branchId: bid, role: role?.role_name ?? null, perms: permsFromAccessRows(access) };
}

const primaryOf = (companies) => companies.find((c) => c.is_primary) || companies[0] || null;

const contextBody = (ctx) => ({ zodu_id: ctx.zoduId, branch_id: ctx.branchId, role: ctx.role });

// ── login response data (unchanged shape: user + companies) ──────────────────

async function buildProfile(user, userCompanies) {
  // employee_id / employee_code from employee-service (non-fatal).
  let employeeInfo = null;
  try {
    const primaryCompany = primaryOf(userCompanies);
    if (primaryCompany) {
      const { data: empRes } = await internalHttp.get(
        `${config.EMPLOYEE_SERVICE_URL}/internal/employee/by-user`,
        { params: { user_id: user.user_id, zodu_id: primaryCompany.zodu_id, branch_id: 'B1' } }
      );
      if (empRes.success) employeeInfo = empRes.data;
    }
  } catch (_) {}

  const companies = await Promise.all(
    userCompanies.map(async (uc) => {
      const [companyInfo, branches] = await Promise.all([
        businessRepo.getCompany(uc.zodu_id).catch(() => null),
        businessRepo.getBranches(uc.zodu_id).catch(() => []),
      ]);

      return {
        zodu_id:          uc.zodu_id,
        is_primary:       uc.is_primary,
        store_name:       companyInfo?.business_name    ?? null,
        company_name:     companyInfo?.business_name    ?? null,
        owner_admin_name: companyInfo?.owner_admin_name ?? null,
        gst_no:           companyInfo?.gst_no           ?? null,
        address_line_1:   companyInfo?.address_line_1   ?? null,
        address_line_2:   companyInfo?.address_line_2   ?? null,
        city:             companyInfo?.city              ?? null,
        district:         companyInfo?.district          ?? null,
        state:            companyInfo?.state             ?? null,
        pincode:          companyInfo?.pincode           ?? null,
        account_number:   companyInfo?.account_number   ?? null,
        account_type:     companyInfo?.account_type     ?? null,
        ifsc_code: companyInfo?.ifsc_code ?? null,
        business_type: companyInfo?.type ?? null,
        branches, // each branch carries its own subscription_status / subscription_effective_status
      };
    })
  );

  return {
    user: {
      user_id:       user.user_id,
      zodu_id:       primaryOf(userCompanies)?.zodu_id ?? null,
      email:         user.email,
      phone:         user.phone,
      user_type: user.user_type,
      login_user: user.login_user,
      reporting_manager_id: employeeInfo?.reporting_manager_id ?? null,
      employee_id:   employeeInfo?.employee_id   ?? null,
      employee_code: employeeInfo?.employee_code ?? null,
      employee_name: employeeInfo?.employee_name ?? null,
      employee_branch : employeeInfo?.branch_id ?? null,
    },
    companies,
  };
}

// ── sessions ─────────────────────────────────────────────────────────────────

async function startSession({ user, ctx, platform, req }) {
  const { store, tokens } = auth();
  const fid = crypto.randomUUID();
  const { token, absoluteExpiry } = await store.createFamily({
    fid, userId: user.user_id, platform, zoduId: ctx.zoduId, branchId: ctx.branchId,
  });
  try {
    await sessionRepo.createSessionRow({
      session_id: fid, user_id: user.user_id, platform, ...requestMeta(req), expires_at: new Date(absoluteExpiry * 1000),
    });
  } catch (err) {
    await store.revokeFamily(fid).catch(() => {});
    throw err;
  }
  const access = await tokens.issue(tokenClaims(user, ctx, platform, fid));
  return { fid, access, refresh: { token, maxAge: idleSeconds() } };
}

const tokenClaims = (user, ctx, platform, sessionId) => ({
  userId: user.user_id,
  zoduId: ctx.zoduId,
  branchId: ctx.branchId,
  role: ctx.role,
  perms: ctx.perms,
  userType: user.user_type,
  platform,
  sessionId,
});

async function revokeSession(fid, reason) {
  await auth().store.revokeFamily(fid);
  await sessionRepo.revokeSessionRows([fid], reason);
}

// Every session of the user on every device: password change, deactivation,
// login disabled, role / access change, company or branch deletion, logout-all.
async function revokeAllForUser(userId, reason) {
  await auth().store.revokeAllForUser(userId);
  await sessionRepo.revokeUserSessionRows(userId, reason);
}

// Same, and never fails the change that triggered it (logged instead).
async function revokeAllForUsers(userIds, reason) {
  for (const id of new Set(userIds.filter(Boolean))) {
    await revokeAllForUser(id, reason).catch((err) => {
      logger.error({ err: err.message, user_id: id, reason }, 'session revocation failed');
    });
  }
}

const accountUsable = (u) => u && !u.is_deleted && u.is_active && u.login_user;

// 2FA extension point (TOTP, RFC 6238): to be required for the owner / Admin
// role. When it returns true, login must answer { requires_2fa: true } with a
// short-lived challenge instead of tokens. Not enabled yet.
function secondFactorRequired(/* user, ctx */) {
  return false;
}

// ── POST /api/login ──────────────────────────────────────────────────────────

async function login(input, { req, platform }) {
  const { lockout } = auth();
  const email = input.email?.toLowerCase() || null;
  const phone = input.phone_number || null;
  const identifier = email ? `email:${email}` : `phone:${phone}`;

  const wait = await lockout.retryAfter(identifier);
  if (wait) {
    recordEvent(req, 'login_blocked', { platform, details: { reason: 'locked' } });
    return fail(429, LOCKED, { retryAfter: wait });
  }

  // The hash runs whether or not the account exists (dummy argon2id hash).
  const user = await repo.findUserForLogin({ email, phone_number: phone });
  const { ok, needsRehash } = await verifyPassword(input.password, user?.password_hash);

  let reason = !user ? 'unknown_account'
    : !ok ? 'wrong_password'
    : user.is_deleted ? 'deleted'
    : !user.is_active ? 'inactive'
    : !user.login_user ? 'login_disabled'
    : null;
  let userCompanies = [];
  if (!reason) {
    userCompanies = await repo.getUserCompanies({ user_id: user.user_id });
    if (!userCompanies.length) reason = 'no_company';
  }

  if (reason) {
    const lock = await lockout.recordFailure(identifier);
    recordEvent(req, 'login_failed', { userId: user?.user_id, platform, details: { reason } });
    if (lock.locked) {
      recordEvent(req, 'lockout', { userId: user?.user_id, platform, details: { minutes: config.LOGIN_LOCKOUT_MINUTES } });
      return fail(429, LOCKED, { retryAfter: lock.retryAfter });
    }
    return fail(401, LOGIN_FAILED);
  }

  await lockout.recordSuccess(identifier);
  if (needsRehash) {
    try {
      await repo.updatePasswordHash({ user_id: user.user_id, password_hash: await hashPassword(input.password) });
    } catch (err) {
      logger.error({ err: err.message }, 'password rehash failed (login continues)');
    }
  }

  const ctx = await contextFor({ userId: user.user_id, zoduId: primaryOf(userCompanies).zodu_id });
  if (secondFactorRequired(user, ctx)) return { status: 200, data: { requires_2fa: true } };

  const session = await startSession({ user, ctx, platform, req });
  await repo.updateLastLogin({ user_id: user.user_id });
  const profile = await buildProfile(user, userCompanies);
  recordEvent(req, 'login_success', { userId: user.user_id, zoduId: ctx.zoduId, platform });

  return {
    status: 200,
    data: { message: 'Login successful', ...session.access, context: contextBody(ctx), ...profile },
    refresh: session.refresh,
  };
}

// ── POST /api/refresh-token ──────────────────────────────────────────────────

// Reloads the user and roles from the database, so deactivation, deletion,
// login_user=false and role changes apply at the next refresh at the latest.
async function issueForFamily({ family, platform, req, refreshToken }) {
  const { store, tokens } = auth();
  const user = await repo.findUserState({ user_id: family.userId });
  if (!accountUsable(user)) {
    await revokeSession(family.fid, 'account_disabled');
    recordEvent(req, 'refresh_refused', { userId: family.userId, platform, details: { reason: 'account_disabled' } });
    return fail(401, REFRESH_FAILED);
  }
  const userCompanies = await repo.getUserCompanies({ user_id: user.user_id });
  const stillMember = userCompanies.some((c) => c.zodu_id === family.zoduId);
  const zoduId = stillMember ? family.zoduId : primaryOf(userCompanies)?.zodu_id;
  if (!zoduId) {
    await revokeSession(family.fid, 'no_company');
    return fail(401, REFRESH_FAILED);
  }
  const ctx = await contextFor({ userId: user.user_id, zoduId, branchId: stillMember ? family.branchId : null });

  const sessionPlatform = family.platform === UNKNOWN_PLATFORM ? platform : family.platform;
  if (ctx.zoduId !== family.zoduId || ctx.branchId !== family.branchId || sessionPlatform !== family.platform) {
    await store.updateFamily(family.fid, { zoduId: ctx.zoduId, branchId: ctx.branchId, platform: sessionPlatform });
  }
  await sessionRepo.touchSessionRow({ session_id: family.fid, platform: sessionPlatform, ip_address: req.ip });

  const access = await tokens.issue(tokenClaims(user, ctx, sessionPlatform, family.fid));
  const profile = await buildProfile(user, userCompanies);
  return {
    status: 200,
    data: { message: 'Token refreshed', ...access, context: contextBody(ctx), ...profile },
    refresh: { token: refreshToken, maxAge: idleSeconds() },
  };
}

async function refresh({ req, platform }) {
  const { store } = auth();
  const token = readRefreshToken(req, platform);
  if (!token) return fail(400, 'refresh_token required');
  if (!looksOpaque(token)) return legacyRefresh(token, { req, platform });

  // The session's platform is fixed at login. Checked before rotating, so a
  // token presented the wrong way isn't burnt for its owner.
  const current = await store.peek(token);
  if (current && current.platform !== UNKNOWN_PLATFORM && current.platform !== platform) {
    recordEvent(req, 'refresh_refused', {
      userId: current.userId, platform, details: { reason: 'platform_mismatch', session_platform: current.platform },
    });
    return fail(401, REFRESH_FAILED);
  }

  const r = await store.rotate(token);
  if (r.status === 'reuse') {
    await sessionRepo.revokeSessionRows([r.family.fid], 'refresh_reuse');
    recordEvent(req, 'refresh_reuse_detected', {
      userId: r.family.userId, zoduId: r.family.zoduId, platform, details: { session_id: r.family.fid },
    });
    return fail(401, REFRESH_FAILED);
  }
  if (r.status === 'expired') {
    await sessionRepo.revokeSessionRows([r.family.fid], 'max_age');
    return fail(401, 'Session expired. Please sign in again.');
  }
  if (r.status !== 'ok') return fail(401, REFRESH_FAILED);
  if (r.family.platform !== UNKNOWN_PLATFORM && r.family.platform !== platform) return fail(401, REFRESH_FAILED);

  return issueForFamily({ family: r.family, platform, req, refreshToken: r.token });
}

// Refresh JWTs from before the switch (HS256, APP_SECRET, row in
// tbl_user_sessions): exchanged once for a new session, the old row revoked.
// Removed after LEGACY_REFRESH_CUTOFF.
async function legacyRefresh(token, { req, platform }) {
  const { store } = auth();
  const cutoff = config.LEGACY_REFRESH_CUTOFF ? Date.parse(config.LEGACY_REFRESH_CUTOFF) : NaN;
  if (Date.now() >= cutoff || !config.APP_SECRET) return fail(401, REFRESH_FAILED);

  let decoded;
  try {
    decoded = jwt.verify(token, config.APP_SECRET, { algorithms: ['HS256'] });
  } catch {
    return fail(401, REFRESH_FAILED);
  }

  const replay = await store.replayLegacyExchange(token);
  if (replay) return issueForFamily({ family: replay.family, platform, req, refreshToken: replay.token });

  const row = await sessionRepo.findLegacySession({ refresh_token: token });
  if (!row || row.user_id !== decoded.sub || new Date(row.expires_at) < new Date()) return fail(401, REFRESH_FAILED);
  if (row.is_revoked) {
    recordEvent(req, 'refresh_reuse_detected', { userId: row.user_id, platform, details: { legacy: true } });
    return fail(401, REFRESH_FAILED);
  }
  // Claim the row atomically: of two parallel exchanges only one proceeds.
  const claimed = await sessionRepo.claimLegacySession({ session_id: row.session_id });
  if (!claimed) {
    // A parallel request is exchanging this token right now: use its session.
    for (let i = 0; i < 30; i++) {
      const again = await store.replayLegacyExchange(token);
      if (again) return issueForFamily({ family: again.family, platform, req, refreshToken: again.token });
      await new Promise((r) => setTimeout(r, 100));
    }
    return fail(401, REFRESH_FAILED);
  }

  const user = await repo.findUserState({ user_id: row.user_id });
  const userCompanies = accountUsable(user) ? await repo.getUserCompanies({ user_id: row.user_id }) : [];
  if (!userCompanies.length) return fail(401, REFRESH_FAILED);

  const ctx = await contextFor({ userId: user.user_id, zoduId: primaryOf(userCompanies).zodu_id });
  const session = await startSession({ user, ctx, platform, req });
  await store.rememberLegacyExchange(token, session.fid, session.refresh.token);
  recordEvent(req, 'legacy_refresh_migrated', { userId: user.user_id, zoduId: ctx.zoduId, platform });

  const profile = await buildProfile(user, userCompanies);
  return {
    status: 200,
    data: { message: 'Token refreshed', ...session.access, context: contextBody(ctx), ...profile },
    refresh: session.refresh,
  };
}

// ── POST /api/logout, /api/logout-all, /api/sessions ─────────────────────────

async function logout({ req, platform }) {
  const { store } = auth();
  const token = readRefreshToken(req, platform);
  if (!token) return { status: 200, data: { message: 'Already logged out' } };

  if (looksOpaque(token)) {
    const fid = await store.familyOf(token);
    if (!fid) return { status: 200, data: { message: 'Already logged out' } };
    await revokeSession(fid, 'logout');
    return { status: 200, data: { message: 'Logged out successfully' } };
  }

  const row = await sessionRepo.findLegacySession({ refresh_token: token });
  if (!row || row.is_revoked) return { status: 200, data: { message: 'Already logged out' } };
  await sessionRepo.revokeSessionRows([row.session_id], 'logout');
  return { status: 200, data: { message: 'Logged out successfully' } };
}

async function logoutAll(authCtx, req) {
  await revokeAllForUser(authCtx.userId, 'logout_all');
  recordEvent(req, 'logout_all', { userId: authCtx.userId, zoduId: authCtx.zoduId, platform: authCtx.platform });
  return { status: 200, data: { message: 'Logged out on every device' } };
}

async function listSessions(authCtx) {
  const rows = await sessionRepo.listActiveSessions({ user_id: authCtx.userId, idle_days: config.REFRESH_IDLE_DAYS });
  return {
    status: 200,
    data: {
      sessions: rows.map((r) => ({
        session_id: r.session_id,
        platform: r.platform,
        ip_address: r.ip_address,
        user_agent: r.user_agent,
        created_at: r.created_at,
        last_used_at: r.last_used_at,
        current: r.session_id === authCtx.sessionId,
      })),
    },
  };
}

async function revokeOwnSession(authCtx, sessionId, req) {
  const row = await sessionRepo.findUserSession({ user_id: authCtx.userId, session_id: sessionId });
  if (!row) return fail(404, 'Session not found');
  await revokeSession(sessionId, 'revoked_by_user');
  recordEvent(req, 'session_revoked', {
    userId: authCtx.userId, zoduId: authCtx.zoduId, platform: authCtx.platform, details: { session_id: sessionId },
  });
  return { status: 200, data: { message: 'Session revoked' } };
}

// ── POST /api/switch-context ─────────────────────────────────────────────────

async function switchContext(authCtx, { zodu_id, branch_id }, req) {
  const { store, tokens } = auth();
  const user = await repo.findUserState({ user_id: authCtx.userId });
  if (!accountUsable(user)) return fail(401, 'Session is no longer valid');

  const companies = await repo.getUserCompanies({ user_id: authCtx.userId });
  const ctx = companies.some((c) => c.zodu_id === zodu_id)
    ? await contextFor({ userId: authCtx.userId, zoduId: zodu_id, branchId: branch_id || null, strictBranch: Boolean(branch_id) })
    : null;
  if (!ctx) {
    recordEvent(req, 'cross_tenant_attempt', {
      userId: authCtx.userId, zoduId: authCtx.zoduId, platform: authCtx.platform,
      details: { route: 'switch-context', requested_zodu_id: zodu_id, requested_branch_id: branch_id || null },
    });
    return fail(404, 'Not found');
  }

  const family = await store.getFamily(authCtx.sessionId);
  if (!family) return fail(401, 'Session is no longer valid');
  await store.updateFamily(authCtx.sessionId, { zoduId: ctx.zoduId, branchId: ctx.branchId });

  const access = await tokens.issue(tokenClaims(user, ctx, authCtx.platform, authCtx.sessionId));
  return { status: 200, data: { ...access, context: contextBody(ctx) } };
}

module.exports = {
  login,
  refresh,
  logout,
  logoutAll,
  listSessions,
  revokeOwnSession,
  switchContext,
  revokeAllForUser,
  revokeAllForUsers,
  contextFor,
};
