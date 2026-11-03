// Forgot password (docs/security/auth.md):
//   1. POST /api/forgot-password   { email } | { phone_number }
//      → a 6-digit code to that email (noreply@zodu.in) or phone (Twilio SMS)
//   2. POST /api/forgot-password/verify   { email | phone_number, otp }
//      → reset_token (single use, 10 minutes)
//   3. POST /api/reset-password   { reset_token, new_password }
//      → password changed, every session signed out, login lockout cleared
//
// Step 1 answers the same whether or not the account exists. Every function
// returns { status, data, retryAfter? } like session-service.

const config = require('../config');
const { logger } = require('../utils/logger');
const repo = require('../repository/auth-repo');
const { auth } = require('../auth');
const { hashPassword, passwordProblem } = require('../auth/password');
const { recordEvent } = require('../auth/request');
const { notifier } = require('../notify');
const { accountUsable, revokeAllForUser } = require('./session-service');

const SENT = 'If an account uses this email or phone number, a code has been sent to it.';
const BAD_CODE = 'Invalid or expired code';
const BAD_TOKEN = 'This reset has expired. Request a new code.';
const WAIT = 'Please wait before requesting another code.';

const fail = (status, error, extra = {}) => ({ status, data: { error }, ...extra });

function target(input) {
  const email = input.email?.toLowerCase() || null;
  return email
    ? { channel: 'email', to: email, identifier: `email:${email}`, lookup: { email } }
    : { channel: 'sms', to: input.phone_number, identifier: `phone:${input.phone_number}`, lookup: { phone_number: input.phone_number } };
}

// ── 1. request a code ────────────────────────────────────────────────────────
async function requestReset(input, { req }) {
  const { passwordReset } = auth();
  const t = target(input);
  const user = await repo.findUserForLogin(t.lookup);
  const usable = accountUsable(user);

  const r = await passwordReset.requestCode(t.identifier, usable ? user.user_id : null);
  if (r.status === 'wait') return fail(429, WAIT, { retryAfter: r.retryAfter });

  recordEvent(req, 'password_reset_requested', {
    userId: user?.user_id, details: { channel: t.channel, ...(usable ? {} : { reason: user ? 'account_disabled' : 'unknown_account' }) },
  });
  if (r.status === 'sent') {
    // Not awaited: the answer must not take longer when the account exists.
    notifier().sendPasswordResetCode({
      channel: t.channel, to: t.to, code: r.code, minutes: Math.round(config.PASSWORD_RESET_CODE_TTL_SECONDS / 60),
    }).catch((err) => {
      logger.error({ err: err.message, channel: t.channel, user_id: user.user_id }, 'password reset code not delivered');
      recordEvent(req, 'password_reset_delivery_failed', { userId: user.user_id, details: { channel: t.channel } });
    });
  }
  return {
    status: 200,
    data: {
      message: SENT,
      expires_in: config.PASSWORD_RESET_CODE_TTL_SECONDS,
      resend_after: config.PASSWORD_RESET_RESEND_SECONDS,
    },
  };
}

// ── 2. check the code ────────────────────────────────────────────────────────
async function verifyCode(input, { req }) {
  const t = target(input);
  const r = await auth().passwordReset.verifyCode(t.identifier, input.otp);
  if (r.status !== 'ok') {
    recordEvent(req, 'password_reset_code_failed', { details: { channel: t.channel } });
    return fail(400, BAD_CODE);
  }
  recordEvent(req, 'password_reset_code_verified', { userId: r.userId, details: { channel: t.channel } });
  return {
    status: 200,
    data: { reset_token: r.token, expires_in: config.PASSWORD_RESET_TOKEN_TTL_SECONDS },
  };
}

// ── 3. set the new password ──────────────────────────────────────────────────
async function resetPassword(input, { req }) {
  const { passwordReset, lockout } = auth();
  // Checked before the token is used up, so a too-short password can be retried.
  const userId = await passwordReset.peekToken(input.reset_token);
  const user = userId && await repo.findUserState({ user_id: userId });
  if (!accountUsable(user)) return fail(400, BAD_TOKEN);

  const weak = passwordProblem(input.new_password, { owner: user.user_type === 'super_admin' });
  if (weak) return fail(400, weak);

  if ((await passwordReset.consumeToken(input.reset_token)) !== userId) return fail(400, BAD_TOKEN);

  await repo.updatePasswordHash({ user_id: userId, password_hash: await hashPassword(input.new_password) });
  // Whoever knew the old password is signed out everywhere.
  await revokeAllForUser(userId, 'password_reset');
  await Promise.all([
    user.email && lockout.clear(`email:${user.email.toLowerCase()}`),
    user.phone && lockout.clear(`phone:${user.phone}`),
  ]);
  recordEvent(req, 'password_reset', { userId });
  return { status: 200, data: { message: 'Password changed. Sign in with your new password.' } };
}

module.exports = { requestReset, verifyCode, resetPassword };
