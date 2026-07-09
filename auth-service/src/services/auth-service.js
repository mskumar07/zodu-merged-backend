const {
  FormateData,
  GeneratePassword,
  GenerateSalt,
  GenerateSignature,
  ValidatePassword,
} = require('../utils');

const repository = require('../repository/auth-repo');
const businessRepo = require('../repository/business-repo');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { APP_SECRET, RESTAURANT_SERVICE_URL, EMPLOYEE_SERVICE_URL } = require('../config');

const REFRESH_SECRET  = APP_SECRET;
const REFRESH_EXPIRY_DAYS = 7;

console.log(RESTAURANT_SERVICE_URL)

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
  const { restaurant_name, phone_number, email, password, same_for_branch, business_type } = userInputs;

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
      zodu_id, phone_number, email, password_hash,
    });
  } catch (err) {
    if (err.code === '23505') {
      return FormateData({ error: 'Email or phone already registered' });
    }
    throw err;
  }

  try {
    await axios.post(`${RESTAURANT_SERVICE_URL}/api/createcompany`, {
      zodu_id,
      restaurant_name,
      mobile_no: phone_number,
      mail_id: email,
      business_type: business_type || null,
    });
  } catch (err) {
    console.error('restaurant-service failed — rolling back:', err.message);
    await repository.deleteAccountByZoduId(zodu_id).catch(() => {});
    return FormateData({ error: 'Registration failed. Please try again.' });
  }
console.log(same_for_branch)
  if (same_for_branch === true) {
    try {
      await axios.post(`${RESTAURANT_SERVICE_URL}/api/branch/signup-default`, {
        zodu_id,
        branch_name: restaurant_name,
        branch_mobile_no: phone_number,
        branch_mail_id: email,
      });
    } catch (err) {
      console.log(err)
      console.error('Default branch creation failed (non-fatal):', err.message);
    }
  }

  // Seed Admin employee in employee-service (non-blocking — failure must not break signup)
  axios.post(`${EMPLOYEE_SERVICE_URL}/internal/employee/create-admin`, {
    zodu_id,
    branch_id: 'B1',
    user_id:   createdData.user_id,
    phone:     phone_number || null,
    email:     email        || null,
  }).catch(err => console.error('[employee-service] create-admin failed (non-fatal):', err.message));

  return FormateData({ insertData: { user_id: createdData.user_id } });
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
    phone:     user.phone,
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

  // 5. Fetch all companies the user belongs to
  const userCompanies = await repository.getUserCompanies({ user_id: user.user_id });

  // 5a. Fetch employee_id + employee_code from employee-service (non-fatal)
  let employeeInfo = null;
  try {
    const primaryCompany = userCompanies.find(c => c.is_primary) || userCompanies[0];
    if (primaryCompany) {
      const { data: empRes } = await axios.get(
        `${EMPLOYEE_SERVICE_URL}/internal/employee/by-user`,
        { params: { user_id: user.user_id, zodu_id: primaryCompany.zodu_id, branch_id: 'B1' } }
      );
      if (empRes.success) employeeInfo = empRes.data;
    }
  } catch (_) {}

  // 6. For each company, fetch company details + branches from own DB
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
        branches,
      };
    })
  );

  return FormateData({
    message: 'Login successful',
    access_token:  accessToken,
    refresh_token: refreshToken,
    user: {
      user_id:       user.user_id,
      zodu_id:       user.zodu_id,
      email:         user.email,
      phone:         user.phone,
      user_type: user.user_type,
      reporting_manager_id: employeeInfo?.reporting_manager_id ?? null,
      employee_id:   employeeInfo?.employee_id   ?? null,
      employee_code: employeeInfo?.employee_code ?? null,
      employee_name: employeeInfo?.employee_name ?? null,
    },
    companies,
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

// ── AddCompany ────────────────────────────────────────────────────────────────

async function AddCompany(userInputs, user_id) {
  const {
    restaurant_name,
    owner_admin_name,
    gst_no,
    phone_number,
    email,
    pincode,
    city,
    district,
    state,
    address_line_1,
    address_line_2,
    building_no,
    area_street_name,
    account_number,
    account_type,
    ifsc_code,
    holder_name,
    bank_name,
    bank_branch,
    same_for_branch = true,
  } = userInputs;

  const zodu_id = await repository.getNextZoduId();

  try {
    await axios.post(`${RESTAURANT_SERVICE_URL}/api/createcompany`, {
      zodu_id,
      restaurant_name,
      owner_admin_name,
      mobile_no: phone_number,
      mail_id: email,
      gst_no,
      pincode,
      city,
      district,
      state,
      address_line_1: address_line_1 ?? building_no,
      address_line_2: address_line_2,
      account_number,
      account_type,
      ifsc_code,
      holder_name,
      bank_name,
      bank_branch,
      can_use_for_branch: same_for_branch,
    });
  } catch (err) {
    console.error('createcompany failed:', err.message);
    return FormateData({ error: 'Failed to create company. Please try again.' });
  }

  await repository.addUserCompany({ user_id, zodu_id, is_primary: false });

  // Create default role for the company if user is super_admin
  try {
    await repository.createDefaultRoleForCompany({ user_id, zodu_id });
  } catch (err) {
    console.error('Default role creation failed (non-fatal):', err.message);
    // Non-fatal error - company was created successfully, role creation failure shouldn't block
  }

  if (same_for_branch === true) {
    try {
      await axios.post(`${RESTAURANT_SERVICE_URL}/api/branch/signup-default`, {
        zodu_id,
        branch_name: restaurant_name,
        branch_mobile_no: phone_number,
        branch_mail_id: email,
      });
    } catch (err) {
      console.error('Default branch creation failed (non-fatal):', err.message);
    }
  }

  return FormateData({ zodu_id, restaurant_name });
}

async function AddBranch(userInputs, user_id) {
  const { zodu_id } = userInputs;

  const userCompanies = await repository.getUserCompanies({ user_id });
  const hasAccess = userCompanies.some((company) => company.zodu_id === zodu_id);

  if (!hasAccess) {
    return FormateData({ error: 'You do not have access to add a branch for this company' });
  }

  try {
    const response = await axios.post(`${RESTAURANT_SERVICE_URL}/add/branch`, userInputs);
    return FormateData({
      message: 'Branch created successfully',
      branch: response.data?.Data?.data ?? response.data?.data ?? response.data,
    });
  } catch (err) {
    console.error('add branch failed:', err.message);
    return FormateData({
      error: err.response?.data?.message || err.response?.data?.error || 'Failed to create branch. Please try again.',
    });
  }
}

async function EditCompany(userInputs, user_id) {
  const {
    zodu_id,
    phone_number,
    email,
    type,
    ...rest
  } = userInputs;

  const userCompanies = await repository.getUserCompanies({ user_id });
  const hasAccess = userCompanies.some((company) => company.zodu_id === zodu_id);

  if (!hasAccess) {
    return FormateData({ error: 'You do not have access to edit this company' });
  }

  try {
    const response = await axios.put(`${RESTAURANT_SERVICE_URL}/api/company/${zodu_id}`, {
      ...rest,
      ...(phone_number !== undefined ? { mobile_no: phone_number } : {}),
      ...(email !== undefined ? { mail_id: email } : {}),
      ...(type !== undefined ? { type } : {}),
    });

    return FormateData({
      message: 'Company updated successfully',
      company: response.data?.data ?? response.data,
    });
  } catch (err) {
    console.log(err)
    console.error('edit company failed:', err.message);
    return FormateData({
      error: err.response?.data?.message || err.response?.data?.error || 'Failed to update company. Please try again.',
    });
  }
}

async function EditBranch(userInputs, user_id) {
  const { zodu_id, branch_id, ...rest } = userInputs;

  console.log(rest)

  const userCompanies = await repository.getUserCompanies({ user_id });
  const hasAccess = userCompanies.some((company) => company.zodu_id === zodu_id);

  if (!hasAccess) {
    return FormateData({ error: 'You do not have access to edit a branch for this company' });
  }

  try {
    const response = await axios.put(`${RESTAURANT_SERVICE_URL}/api/branch/${zodu_id}/${branch_id}`, rest);
    return FormateData({
      message: 'Branch updated successfully',
      branch: response.data?.data ?? response.data,
    });
  } catch (err) {
    console.log(err)
    console.error('edit branch failed:', err.message);
    return FormateData({
      error: err.response?.data?.message || err.response?.data?.error || 'Failed to update branch. Please try again.',
    });
  }
}

// ── GetMyCompanies ────────────────────────────────────────────────────────────

async function GetMyCompanies(user_id) {
  const userCompanies = await repository.getUserCompanies({ user_id });

  if (!userCompanies.length) {
    return FormateData({ companies: [] });
  }

  const details = await Promise.all(
    userCompanies.map(async (uc) => {
      const [companyInfo, branches] = await Promise.all([
        businessRepo.getCompany(uc.zodu_id).catch(() => null),
        businessRepo.getBranches(uc.zodu_id).catch(() => []),
      ]);

      return {
        ...(companyInfo ?? {}),
        zodu_id:    companyInfo?.zodu_id ?? uc.zodu_id,
        is_primary: uc.is_primary,
        branches,
      };
    })
  );

  return FormateData({ companies: details });
}

module.exports = {
  CreateAccount,
  AccountLogin,
  RefreshToken,
  Logout,
  AddCompany,
  AddBranch,
  EditCompany,
  EditBranch,
  GetMyCompanies,
};
