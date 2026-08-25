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
const { APP_SECRET, EMPLOYEE_SERVICE_URL, RESTAURANT_SERVICE_URL, RETAIL_SERVICE_URL } = require('../config');

const REFRESH_SECRET  = APP_SECRET;
const REFRESH_EXPIRY_DAYS = 7;

// business_type → which service owns that company's units/GST/menu/inventory data
function businessServiceUrlFor(business_type) {
  return String(business_type).toLowerCase() === 'retail' ? RETAIL_SERVICE_URL : RESTAURANT_SERVICE_URL;
}

// Non-blocking — seeding defaults must never fail a signup that already succeeded.
function seedBranchDefaults(business_type, zodu_id, branch_id) {
  axios.post(`${businessServiceUrlFor(business_type)}/internal/seed-defaults`, { zodu_id, branch_id })
    .catch(err => console.error('[seed-defaults] failed (non-fatal):', err.message));
}

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

  // Whole signup (user, roles, access, company, default branch) is one
  // all-or-nothing transaction — any failure rolls back every table together,
  // instead of leaving partial state (e.g. a user with no company).
  const client = await repository.conn.connect();
  let createdData;
  try {
    await client.query('BEGIN');

    createdData = await repository.AccountCreationQuery(client, {
      zodu_id, phone_number, email, password_hash,
    });

    await businessRepo.createCompany({
      zodu_id,
      restaurant_name,
      mobile_no: phone_number,
      mail_id: email,
      business_type: business_type || null,
    }, client);

    if (same_for_branch === true) {
      await businessRepo.createDefaultBranch({
        branch_id: 'B1',
        zodu_id,
        branch_name: restaurant_name,
        branch_mobile_no: phone_number,
        branch_mail_id: email,
      }, client);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return FormateData({ error: 'Email or phone already registered' });
    }
    console.error('Account creation failed — rolled back:', err.message);
    return FormateData({ error: 'Registration failed. Please try again.' });
  } finally {
    client.release();
  }

  // Seed Admin employee in employee-service (non-blocking — failure must not break signup)
  axios.post(`${EMPLOYEE_SERVICE_URL}/internal/employee/create-admin`, {
    zodu_id,
    branch_id: 'B1',
    user_id:   createdData.user_id,
    phone:     phone_number || null,
    email:     email        || null,
  }).catch(err => console.error('[employee-service] create-admin failed (non-fatal):', err.message));

  if (same_for_branch === true) {
    seedBranchDefaults(business_type, zodu_id, 'B1');
  }

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
        is_subscripted:            companyInfo?.is_subscripted            ?? null,
        subscription_start_date:   companyInfo?.subscription_start_date   ?? null,
        subscription_expiry_date:  companyInfo?.subscription_expiry_date  ?? null,
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
      employee_branch : employeeInfo?.branch_id ?? null,
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
    type,
    same_for_branch = true,
  } = userInputs;

  const zodu_id = await repository.getNextZoduId();

  try {
    await businessRepo.createCompany({
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
      type
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
      await businessRepo.createDefaultBranch({
        branch_id: 'B1',
        zodu_id,
        branch_name: restaurant_name,
        branch_mobile_no: phone_number,
        branch_mail_id: email,
      });
      seedBranchDefaults(type, zodu_id, 'B1');
    } catch (err) {
      console.error('Default branch creation failed (non-fatal):', err.message);
    }
  }

  // Seed Admin employee in employee-service (non-blocking — failure must not break company creation)
  axios.post(`${EMPLOYEE_SERVICE_URL}/internal/employee/create-admin`, {
    zodu_id,
    branch_id: 'B1',
    user_id,
    phone:     phone_number || null,
    email:     email        || null,
  }).catch(err => console.error('[employee-service] create-admin failed (non-fatal):', err.message));

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
    const branch = await businessRepo.createBranch(userInputs);
    const company = await businessRepo.getCompany(zodu_id).catch(() => null);
    seedBranchDefaults(company?.business_type, zodu_id, branch.branch_id);
    return FormateData({
      message: 'Branch created successfully',
      branch,
    });
  } catch (err) {
    console.error('add branch failed:', err.message);
    return FormateData({ error: 'Failed to create branch. Please try again.' });
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
    const company = await businessRepo.updateCompany(zodu_id, {
      ...rest,
      ...(phone_number !== undefined ? { mobile_no: phone_number } : {}),
      ...(email !== undefined ? { mail_id: email } : {}),
      ...(type !== undefined ? { type } : {}),
    });

    return FormateData({
      message: 'Company updated successfully',
      company,
    });
  } catch (err) {
    console.error('edit company failed:', err.message);
    return FormateData({ error: 'Failed to update company. Please try again.' });
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
    const branch = await businessRepo.updateBranch(zodu_id, branch_id, rest);
    return FormateData({
      message: 'Branch updated successfully',
      branch,
    });
  } catch (err) {
    console.error('edit branch failed:', err.message);
    return FormateData({ error: 'Failed to update branch. Please try again.' });
  }
}

// ── Invoice Settings ──────────────────────────────────────────────────────────

async function GetInvoiceSettings({ user_id, zodu_id, branch_id }) {
  const userCompanies = await repository.getUserCompanies({ user_id });
  const hasAccess = userCompanies.some((company) => company.zodu_id === zodu_id);

  if (!hasAccess) {
    return FormateData({ error: 'You do not have access to view settings for this company' });
  }

  const settings = await businessRepo.getInvoiceSettings(zodu_id, branch_id);
  if (!settings) {
    return FormateData({ error: 'Invoice settings not found' });
  }
  return FormateData({ settings });
}

async function EditInvoiceSettings({ user_id, zodu_id, branch_id, ...fields }) {
  const userCompanies = await repository.getUserCompanies({ user_id });
  const hasAccess = userCompanies.some((company) => company.zodu_id === zodu_id);

  if (!hasAccess) {
    return FormateData({ error: 'You do not have access to edit settings for this company' });
  }

  try {
    const settings = await businessRepo.upsertInvoiceSettings(zodu_id, branch_id, fields);
    return FormateData({ message: 'Invoice settings updated successfully', settings });
  } catch (err) {
    console.error('update invoice settings failed:', err.message);
    return FormateData({ error: 'Failed to update invoice settings. Please try again.' });
  }
}

// ── GetAllSettings ────────────────────────────────────────────────────────────
// Aggregates every settings category for a branch into one response.
// Add a new category here (e.g. notification, receipt) as those tables land —
// the route/URL never has to change for the frontend.
async function GetAllSettings({ user_id, zodu_id, branch_id }) {
  const userCompanies = await repository.getUserCompanies({ user_id });
  const hasAccess = userCompanies.some((company) => company.zodu_id === zodu_id);

  if (!hasAccess) {
    return FormateData({ error: 'You do not have access to view settings for this company' });
  }

  const invoice = await businessRepo.getInvoiceSettings(zodu_id, branch_id);

  return FormateData({
    settings: {
      invoice: invoice || null,
    },
  });
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

// ── GetRoleAccess ─────────────────────────────────────────────────────────────
// Admin role → zodu_id-only (branch ignored). Any other role → zodu_id + branch_id.
async function GetRoleAccess({ user_id, zodu_id, branch_id }) {
  if (!user_id || !zodu_id) {
    return FormateData({ error: 'user_id and zodu_id are required' });
  }

  const role_access = await repository.getUserRoleAccess({ user_id, zodu_id, branch_id });
  return FormateData({ role_access });
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
  GetRoleAccess,
  GetInvoiceSettings,
  EditInvoiceSettings,
  GetAllSettings,
};
