const {
  FormateData,
  GeneratePassword,
  GenerateSalt,
  GenerateSignature,
  ValidatePassword,
} = require('../utils');

const repository = require('../repository/auth-repo');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { JWT_REFRESH_SECRET } = require('../config');

const REFRESH_SECRET  = JWT_REFRESH_SECRET;
const REFRESH_EXPIRY_DAYS = 7;

// ── helpers ───────────────────────────────────────────────────────────────────

function generateRefreshToken(user_id) {
  if (!REFRESH_SECRET) {
    throw new Error('JWT refresh secret is not configured');
  }
  return jwt.sign(
    { sub: user_id },
    REFRESH_SECRET,
    { expiresIn: `${REFRESH_EXPIRY_DAYS}d` }
  );
}

function refreshTokenExpiresAt() {
  const d = new Date();
  d.setDate(d.getDate() + REFRESH_EXPIRY_DAYS);
  return d;
}

// ── CreateAccount ─────────────────────────────────────────────────────────────

async function CreateAccount(userInputs) {
  const { restaurant_name, phone_number, email, password } = userInputs;

  if (phone_number) {
    const phoneCheck = await repository.findPhnExist({ phone_number });
    if (phoneCheck.rowCount > 0) {
      return FormateData({ error: 'Phone number already exists' });
    }
  }

  if (email) {
    const emailCheck = await repository.findEmailExist({ email });
    if (emailCheck.rowCount > 0) {
      return FormateData({ error: 'Email already exists' });
    }
  }

  const salt          = await GenerateSalt();
  const password_hash = await GeneratePassword(password, salt);
  const zodu_id       = await repository.getNextZoduId();

  let createdData;
  try {
    createdData = await repository.AccountCreationQuery({
      zodu_id, restaurant_name, phone_number, email, password_hash,
    });
  } catch (err) {
    if (err.code === '23505') {
      return FormateData({ error: 'Email or phone already registered' });
    }
    throw err;
  }

  try {
    await axios.post('http://restaurant-service:4001/api/createcompany', {
      zodu_id,
      restaurant_name,
      mobile_no: phone_number,
      mail_id: email,
    });
  } catch (err) {
    console.error('restaurant-service failed — rolling back:', err.message);
    await repository.deleteAccountByZoduId(zodu_id).catch(() => {});
    return FormateData({ error: 'Registration failed. Please try again.' });
  }

  return FormateData({ insertData: createdData.account });
}

// ── AccountLogin ──────────────────────────────────────────────────────────────

async function AccountLogin(userInputs, meta = {}) {
  const { email, phone_number, password } = userInputs;
  // meta = { ip_address, user_agent } — passed in from the route

  if ((!email && !phone_number) || !password) {
    return FormateData({ error: 'Email/Phone and password are required' });
  }

  // 1. Fetch user — NOW includes password_hash, zodu_id, user_id, is_active
  let result;
  if (email) {
    result = await repository.findEmailExist({ email });
  } else {
    result = await repository.findPhnExist({ phone_number });
  }

  const dummyHash = '$2b$12$invalidhashusedtopreventtimingattack0000000000000000';
  const user      = result?.rows?.[0];
  const isValid   = await ValidatePassword(password, user?.password_hash || dummyHash);
  console.log(isValid)

  if (!user || !isValid) {
    return FormateData({ error: 'Invalid credentials' });
  }
  if (user.is_deleted) {
    return FormateData({ error: 'Account has been deactivated' });
  }
  if (!user.is_active) {
    return FormateData({ error: 'Account is inactive' });
  }

  // 2. Issue access token (short-lived)
  const accessToken = await GenerateSignature({
    user_id:   user.user_id,
    zodu_id:   user.zodu_id,
    user_type: user.user_type,
    email:     user.email,
    phone_number: user.phone_number,
    branch_id: user.branch_id,
  });

  // 3. Issue refresh token + persist session to tbl_user_sessions
  const refreshToken = generateRefreshToken(user.user_id);
  const expiresAt    = refreshTokenExpiresAt();

  await repository.createSession({
    user_id:       user.user_id,
    refresh_token: refreshToken,
    ip_address:    meta.ip_address,
    user_agent:    meta.user_agent,
    expires_at:    expiresAt,
  });

  // 4. Update last_login_at
  await repository.updateLastLogin({ user_id: user.user_id });

  return FormateData({
    message: 'Login successful',
    access_token:  accessToken,
    refresh_token: refreshToken,
    user: {
      user_id:         user.user_id,
      zodu_id:         user.zodu_id,
      restaurant_name: user.restaurant_name,
      email:           user.email,
      phone_number:    user.phone_number,
      user_type:       user.user_type,
      branch_id:       user.branch_id,
    },
  });
}

// ── RefreshToken ──────────────────────────────────────────────────────────────

async function RefreshToken({ refresh_token }) {
  if (!refresh_token) {
    return FormateData({ error: 'Refresh token required' });
  }

  if (!REFRESH_SECRET) {
    throw new Error('JWT refresh secret is not configured');
  }

  // 1. Verify JWT signature + expiry first (cheap, no DB hit)
  let decoded;
  try {
    decoded = jwt.verify(refresh_token, REFRESH_SECRET);
  } catch (err) {
    return FormateData({ error: 'Invalid or expired refresh token' });
  }

  // 2. Check it exists in DB and is not revoked
  const session = await repository.findSessionByRefreshToken({ refresh_token });
  if (!session) {
    return FormateData({ error: 'Session not found' });
  }
  if (session.is_revoked) {
    return FormateData({ error: 'Session has been revoked' });
  }
  if (new Date(session.expires_at) < new Date()) {
    return FormateData({ error: 'Session expired' });
  }
  if (!session.is_active || session.is_deleted) {
    return FormateData({ error: 'Account inactive' });
  }

  // 3. Rotate — revoke old session, issue new tokens
  await repository.revokeSession({ session_id: session.session_id });

  const newAccessToken  = await GenerateSignature({
    user_id:   session.user_id,
    zodu_id:   session.zodu_id,
    user_type: session.user_type,
  });
  const newRefreshToken = generateRefreshToken(session.user_id);
  const expiresAt       = refreshTokenExpiresAt();

  await repository.createSession({
    user_id:       session.user_id,
    refresh_token: newRefreshToken,
    expires_at:    expiresAt,
  });

  return FormateData({
    access_token:  newAccessToken,
    refresh_token: newRefreshToken,
  });
}

// ── Logout ────────────────────────────────────────────────────────────────────

async function Logout({ refresh_token }) {
  if (!refresh_token) {
    return FormateData({ error: 'Refresh token required' });
  }

  const session = await repository.findSessionByRefreshToken({ refresh_token });
  if (!session || session.is_revoked) {
    return FormateData({ message: 'Already logged out' });
  }

  await repository.revokeSession({ session_id: session.session_id });
  return FormateData({ message: 'Logged out successfully' });
}

module.exports = {
  CreateAccount,
  AccountLogin,
  RefreshToken,
  Logout,
};
