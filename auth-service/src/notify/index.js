// Sends one-time codes: email over SMTP (from noreply@zodu.in), SMS through
// Twilio's Messages API. The code itself is never logged, except locally
// (NODE_ENV not production) when the channel isn't configured, so the flow
// can be tried without SMTP / Twilio accounts.

const axios = require('axios');
const nodemailer = require('nodemailer');
const config = require('../config');
const { logger } = require('../utils/logger');

const TWILIO_TIMEOUT_MS = 10_000;

let transport;
function mailTransport() {
  transport ??= nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    requireTLS: !config.SMTP_SECURE,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  return transport;
}

const mailConfigured = () => Boolean(config.SMTP_HOST);
const smsConfigured = () => Boolean(config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN
  && (config.TWILIO_FROM_NUMBER || config.TWILIO_MESSAGING_SERVICE_SID));

// 10-digit number as stored → E.164; numbers already starting with + are kept.
const toE164 = (phone) => {
  const p = String(phone).replace(/[\s-]/g, '');
  return p.startsWith('+') ? p : `${config.SMS_COUNTRY_CODE}${p}`;
};

function notConfigured(channel, to, code) {
  if (config.NODE_ENV === 'production') throw new Error(`${channel} delivery is not configured`);
  logger.warn({ channel, to, code }, `${channel} not configured: one-time code logged instead (local use only)`);
}

async function sendEmail({ to, subject, text, html, code }) {
  if (!mailConfigured()) return notConfigured('email', to, code);
  await mailTransport().sendMail({ from: config.MAIL_FROM, to, subject, text, html });
}

async function sendSms({ to, body, code }) {
  if (!smsConfigured()) return notConfigured('sms', to, code);
  const form = new URLSearchParams({ To: toE164(to), Body: body });
  if (config.TWILIO_MESSAGING_SERVICE_SID) form.set('MessagingServiceSid', config.TWILIO_MESSAGING_SERVICE_SID);
  else form.set('From', config.TWILIO_FROM_NUMBER);
  await axios.post(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.TWILIO_ACCOUNT_SID)}/Messages.json`,
    form.toString(),
    {
      auth: { username: config.TWILIO_ACCOUNT_SID, password: config.TWILIO_AUTH_TOKEN },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: TWILIO_TIMEOUT_MS,
    },
  );
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// channel: 'email' | 'sms'; to: the email address or 10-digit phone the user gave.
async function sendPasswordResetCode({ channel, to, code, minutes }) {
  if (channel === 'sms') {
    return sendSms({
      to,
      code,
      body: `${code} is your Zodu password reset code. It expires in ${minutes} minutes. Do not share it with anyone.`,
    });
  }
  const text = [
    `Your Zodu password reset code is ${code}.`,
    '',
    `It expires in ${minutes} minutes. If you didn't ask to reset your password, ignore this email: your password stays the same.`,
    '',
    'Never share this code. Zodu staff will never ask for it.',
  ].join('\n');
  const html = `<p>Your Zodu password reset code is</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:6px;margin:16px 0">${escapeHtml(code)}</p>
<p>It expires in ${minutes} minutes. If you didn't ask to reset your password, ignore this email: your password stays the same.</p>
<p style="color:#666">Never share this code. Zodu staff will never ask for it.</p>`;
  return sendEmail({ to, subject: `${code} is your Zodu password reset code`, text, html, code });
}

// Tests replace the sender (setSender) to capture codes instead of sending them.
let sender = { sendPasswordResetCode };
const notifier = () => sender;
const setSender = (s) => { sender = s || { sendPasswordResetCode }; };

module.exports = { notifier, setSender, toE164 };
