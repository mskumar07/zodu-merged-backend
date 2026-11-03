// Forgot-password codes and reset tokens, in Redis so every replica agrees.
// Keys hold a hash of the identifier (email / phone), never the value itself.
//
//   pwreset:cool:<id>    resend cooldown, set on every request (account or not)
//   pwreset:sends:<id>   requests in the last hour
//   pwreset:code:<id>    { user_id, salt, hash, attempts } for the latest code;
//                        a new request replaces it, MAX_ATTEMPTS wrong tries delete it
//   pwreset:token:<sha>  user_id, for one password change (GETDEL)
//
// Counters run whether or not the account exists, so the answers (and their
// timing) don't tell anyone which emails / phones are registered.

const crypto = require('node:crypto');

const hash = (v) => crypto.createHash('sha256').update(v).digest('base64url');

function createPasswordReset({
  redis, codeTtlSeconds, resendSeconds, maxSendsPerHour, maxAttempts, tokenTtlSeconds,
}) {
  const id = (identifier) => hash(String(identifier).toLowerCase());
  const coolKey = (identifier) => `pwreset:cool:${id(identifier)}`;
  const sendsKey = (identifier) => `pwreset:sends:${id(identifier)}`;
  const codeKey = (identifier) => `pwreset:code:${id(identifier)}`;
  const tokenKey = (token) => `pwreset:token:${hash(token)}`;
  const codeHash = (salt, code) => hash(`${salt}:${code}`);

  // { status: 'sent', code } | { status: 'no_account' } | { status: 'wait', retryAfter }
  async function requestCode(identifier, userId) {
    const cooling = await redis.set(coolKey(identifier), '1', 'EX', resendSeconds, 'NX');
    if (!cooling) return { status: 'wait', retryAfter: Math.max(1, await redis.ttl(coolKey(identifier))) };
    const [[, sends]] = await redis.multi()
      .incr(sendsKey(identifier))
      .expire(sendsKey(identifier), 3600, 'NX')
      .exec();
    if (sends > maxSendsPerHour) return { status: 'wait', retryAfter: Math.max(1, await redis.ttl(sendsKey(identifier))) };
    if (!userId) return { status: 'no_account' };

    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const salt = crypto.randomBytes(16).toString('base64url');
    await redis.multi()
      .del(codeKey(identifier))
      .hset(codeKey(identifier), { user_id: userId, salt, hash: codeHash(salt, code), attempts: 0 })
      .expire(codeKey(identifier), codeTtlSeconds)
      .exec();
    return { status: 'sent', code };
  }

  // { status: 'ok', token, userId } | { status: 'invalid' }
  async function verifyCode(identifier, code) {
    const key = codeKey(identifier);
    const stored = await redis.hgetall(key);
    if (!stored?.hash) return { status: 'invalid' };
    const attempts = await redis.hincrby(key, 'attempts', 1);
    if (attempts > maxAttempts) {
      await redis.del(key);
      return { status: 'invalid' };
    }
    const want = Buffer.from(stored.hash);
    const got = Buffer.from(codeHash(stored.salt, String(code)));
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) {
      if (attempts >= maxAttempts) await redis.del(key);
      return { status: 'invalid' };
    }
    // One use: whoever deletes the code first gets the token.
    if (!(await redis.del(key))) return { status: 'invalid' };
    const token = crypto.randomBytes(32).toString('base64url');
    await redis.set(tokenKey(token), stored.user_id, 'EX', tokenTtlSeconds);
    return { status: 'ok', token, userId: stored.user_id };
  }

  // The user a reset token belongs to, without using it up (to check the new
  // password first), or null.
  const peekToken = (token) => redis.get(tokenKey(token));
  // Uses the token up; null if it was already used or expired.
  const consumeToken = (token) => redis.getdel(tokenKey(token));

  return { requestCode, verifyCode, peekToken, consumeToken };
}

module.exports = { createPasswordReset };
