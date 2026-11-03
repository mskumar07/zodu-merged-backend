// Forgot password: code by email / SMS, verify, reset.
const {
  setup, teardown, owner, user, api, login, refresh, events, settle, conn,
} = require('./helpers');
const { setSender, toE164 } = require('../src/notify');
const { getRedis } = require('../src/auth');

// Codes are captured here instead of being sent.
const outbox = [];
beforeAll(async () => {
  await setup();
  setSender({ async sendPasswordResetCode(msg) { outbox.push(msg); } });
});
afterAll(async () => {
  setSender(null);
  await teardown();
});

const forgot = (body) => api().post('/api/forgot-password').send(body);
const verify = (body) => api().post('/api/forgot-password/verify').send(body);
const reset = (body) => api().post('/api/reset-password').send(body);
const lastCodeFor = (to) => [...outbox].reverse().find((m) => m.to === to)?.code;
const NEW_PASSWORD = 'a brand new passphrase';

test('email: code → reset token → new password works, old one does not', async () => {
  const o = await owner();
  const sent = await forgot({ email: o.email.toUpperCase() });
  expect(sent.status).toBe(200);
  expect(sent.body.data).toEqual({
    message: expect.stringMatching(/a code has been sent/), expires_in: 600, resend_after: 60,
  });
  expect(sent.headers['cache-control']).toBe('no-store');
  await settle();
  const msg = outbox.find((m) => m.to === o.email);
  expect(msg).toMatchObject({ channel: 'email', minutes: 10 });
  expect(msg.code).toMatch(/^\d{6}$/);

  const ok = await verify({ email: o.email, otp: msg.code });
  expect(ok.status).toBe(200);
  expect(ok.body.data.reset_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(ok.body.data.expires_in).toBe(600);

  const done = await reset({ reset_token: ok.body.data.reset_token, new_password: NEW_PASSWORD });
  expect(done.status).toBe(200);
  expect((await login(o)).status).toBe(401);
  expect((await login(o, { password: NEW_PASSWORD })).status).toBe(200);
  const { rows: [u] } = await conn.query('SELECT password_hash FROM tbl_users WHERE user_id = $1', [o.user_id]);
  expect(u.password_hash).toMatch(/^\$argon2id\$/);

  await settle();
  expect((await events(o.user_id)).map((e) => e.event)).toEqual(expect.arrayContaining([
    'password_reset_requested', 'password_reset_code_verified', 'password_reset',
  ]));
});

test('phone: the code goes by SMS to the number given', async () => {
  const o = await owner();
  expect((await forgot({ phone_number: o.phone })).status).toBe(200);
  await settle();
  expect(outbox.find((m) => m.to === o.phone)).toMatchObject({ channel: 'sms' });
  expect(toE164(o.phone)).toBe(`+91${o.phone}`);
  const ok = await verify({ phone_number: o.phone, otp: lastCodeFor(o.phone) });
  expect(ok.status).toBe(200);
});

test('unknown and disabled accounts get the same answer, and nothing is sent', async () => {
  const off = await user({ login_user: false });
  const before = outbox.length;
  const unknown = await forgot({ email: 'nobody-here@example.com' });
  const disabled = await forgot({ email: off.email });
  for (const res of [unknown, disabled]) {
    expect(res.status).toBe(200);
    expect(res.body.data.message).toMatch(/a code has been sent/);
  }
  await settle();
  expect(outbox.length).toBe(before);
  // a made-up code for them never works
  expect((await verify({ email: 'nobody-here@example.com', otp: '123456' })).status).toBe(400);
});

test('resend cooldown and hourly cap: 429 with Retry-After, for unknown accounts too', async () => {
  const o = await owner();
  expect((await forgot({ email: o.email })).status).toBe(200);
  const again = await forgot({ email: o.email });
  expect(again.status).toBe(429);
  expect(Number(again.headers['retry-after'])).toBeGreaterThan(0);

  expect((await forgot({ email: 'ghost@example.com' })).status).toBe(200);
  expect((await forgot({ email: 'ghost@example.com' })).status).toBe(429);

  // after 5 sends in an hour, waiting out the cooldown is not enough
  const redis = getRedis();
  const crypto = require('crypto');
  const id = crypto.createHash('sha256').update(`email:${o.email}`).digest('base64url');
  await redis.set(`pwreset:sends:${id}`, '5', 'EX', 3600);
  await redis.del(`pwreset:cool:${id}`);
  const capped = await forgot({ email: o.email });
  expect(capped.status).toBe(429);
  expect(Number(capped.headers['retry-after'])).toBeGreaterThan(60);
});

test('wrong codes: 5 tries, then even the right code is refused', async () => {
  const o = await owner();
  await forgot({ email: o.email });
  await settle();
  const code = lastCodeFor(o.email);
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) {
    const res = await verify({ email: o.email, otp: wrong });
    expect(res.status).toBe(400);
    expect(res.body.data.error).toBe('Invalid or expired code');
  }
  expect((await verify({ email: o.email, otp: code })).status).toBe(400);
});

test('a code works once; a newer code replaces the older one', async () => {
  const o = await owner();
  await forgot({ email: o.email });
  await settle();
  const first = lastCodeFor(o.email);
  const crypto = require('crypto');
  await getRedis().del(`pwreset:cool:${crypto.createHash('sha256').update(`email:${o.email}`).digest('base64url')}`);
  await forgot({ email: o.email });
  await settle();
  const second = lastCodeFor(o.email);
  if (first !== second) expect((await verify({ email: o.email, otp: first })).status).toBe(400);
  expect((await verify({ email: o.email, otp: second })).status).toBe(200);
  expect((await verify({ email: o.email, otp: second })).status).toBe(400);
});

test('the reset token: one use, password policy checked before it is used up', async () => {
  const o = await owner();
  await forgot({ email: o.email });
  await settle();
  const { reset_token } = (await verify({ email: o.email, otp: lastCodeFor(o.email) })).body.data;

  const short = await reset({ reset_token, new_password: 'short' });
  expect(short.status).toBe(400);
  expect(short.body.data.error).toBe('Password must be at least 8 characters');
  const common = await reset({ reset_token, new_password: 'password123' });
  expect(common.body.data.error).toMatch(/too common/);

  expect((await reset({ reset_token, new_password: NEW_PASSWORD })).status).toBe(200);
  const reused = await reset({ reset_token, new_password: 'another long passphrase' });
  expect(reused.status).toBe(400);
  expect(reused.body.data.error).toMatch(/expired/);
  expect((await reset({ reset_token: 'x'.repeat(43), new_password: NEW_PASSWORD })).status).toBe(400);
  expect((await reset({ reset_token: 'bad', new_password: NEW_PASSWORD })).status).toBe(400);
});

test('reset signs out every session and clears the login lockout', async () => {
  const o = await owner();
  const { refresh_token } = (await login(o)).body.data;
  for (let i = 0; i < 5; i++) await login(o, { password: 'wrong password!' });
  expect((await login(o)).status).toBe(429);

  await forgot({ email: o.email });
  await settle();
  const { reset_token } = (await verify({ email: o.email, otp: lastCodeFor(o.email) })).body.data;
  expect((await reset({ reset_token, new_password: NEW_PASSWORD })).status).toBe(200);

  expect((await refresh(refresh_token)).status).toBe(401);
  expect((await login(o, { password: NEW_PASSWORD })).status).toBe(200);
});

test('requests are validated', async () => {
  expect((await forgot({})).status).toBe(400);
  expect((await forgot({ email: 'a@b.co', phone_number: '9999999999' })).status).toBe(400);
  expect((await forgot({ phone_number: '12345' })).status).toBe(400);
  expect((await verify({ email: 'a@b.co', otp: '12ab56' })).status).toBe(400);
  expect((await reset({ new_password: NEW_PASSWORD })).status).toBe(400);
});
