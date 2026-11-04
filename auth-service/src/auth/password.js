// Password hashing and policy.
//
// Hashing (OWASP Password Storage Cheat Sheet): argon2id, m=19456 KiB, t=2, p=1.
// Existing bcrypt hashes keep working; the first successful login rehashes them
// to argon2id, so nobody is locked out by the migration.
//
// Policy (NIST SP 800-63B): at least 8 characters (12 for the company owner /
// Admin role), up to 128, no composition rules, and not one of the common /
// breached passwords in data/common-passwords.txt (offline list, see
// docs/security/auth.md; no external calls).

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const argon2 = require('argon2');
const bcrypt = require('bcrypt');

const ARGON2 = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
const MIN_LENGTH = 8;
const MIN_LENGTH_OWNER = 8;
const MAX_LENGTH = 128;
const BCRYPT = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

// A real hash of a random password: an unknown account costs the same hash
// as a wrong password, so response time doesn't reveal which accounts exist.
let dummyHash;
async function initPasswords() {
  dummyHash ??= await argon2.hash(crypto.randomBytes(24).toString('base64'), ARGON2);
}

const hashPassword = (password) => argon2.hash(password, ARGON2);

// { ok, needsRehash }. Never throws for a bad or missing stored hash.
async function verifyPassword(password, stored) {
  await initPasswords();
  if (typeof stored === 'string' && stored.startsWith('$argon2')) {
    const ok = await argon2.verify(stored, password).catch(() => false);
    return { ok, needsRehash: ok && argon2.needsRehash(stored, ARGON2) };
  }
  if (typeof stored === 'string' && BCRYPT.test(stored)) {
    const ok = await bcrypt.compare(password, stored).catch(() => false);
    return { ok, needsRehash: ok };
  }
  await argon2.verify(dummyHash, password).catch(() => false);
  return { ok: false, needsRehash: false };
}

let common;
function commonPasswords() {
  if (!common) {
    const file = path.join(__dirname, '..', '..', 'data', 'common-passwords.txt');
    // \r?\n: a Windows checkout (git autocrlf) gives the file CRLF line endings;
    // splitting on \n alone left a \r on every entry and nothing ever matched.
    common = new Set(fs.readFileSync(file, 'utf8').split(/\r?\n/).map((p) => p.trim()).filter(Boolean));
  }
  return common;
}

// null when acceptable, otherwise the reason to show the user.
function passwordProblem(password, { owner = false } = {}) {
  if (typeof password !== 'string') return 'Password is required';
  const length = [...password].length;   // characters, not UTF-16 units
  const min = owner ? MIN_LENGTH_OWNER : MIN_LENGTH;
  if (length < min) return `Password must be at least ${min} characters`;
  if (length > MAX_LENGTH) return `Password must be at most ${MAX_LENGTH} characters`;
  if (commonPasswords().has(password.toLowerCase())) {
    return 'This password is too common. Choose a different one';
  }
  return null;
}

class PasswordPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PasswordPolicyError';
    this.status = 400;
  }
}

function assertPasswordPolicy(password, options) {
  const problem = passwordProblem(password, options);
  if (problem) throw new PasswordPolicyError(problem);
}

module.exports = {
  initPasswords, hashPassword, verifyPassword, passwordProblem, assertPasswordPolicy,
  PasswordPolicyError, MAX_LENGTH, ARGON2,
};
