const { v4: uuidv4 } = require('uuid');
const axios  = require('axios');
const { createInternalHttp } = require('@zodu/security');
const db     = require('../database/connection');
const repo   = require('../repository/employee-repo');
const files  = require('../utils/file-client');
const { AUTH_SERVICE_URL, PAYROLL_SERVICE_URL } = require('../config');

// Calls to auth-service / payroll-service /internal routes carry this service's token.
const internalHttp = createInternalHttp(axios, { timeout: 10_000 });

// ── CREATE ────────────────────────────────────────────────────────────────────

exports.createEmployee = async (data, created_by) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const employee_id   = uuidv4();
    const employee_code = await repo.generateEmployeeCode(client, data.zodu_id, data.branch_id);

    // Employee-service only: no tbl_users row is created here. A user_id is
    // reserved on the employee; the auth-service creates the login user with
    // this same id when "Set User" (PUT /:id/login-details) is first called.
    const user_id = uuidv4();

    // 1. Insert employee
    const employee = await repo.createEmployee(client, {
      ...data, employee_id, employee_code, user_id, created_by,
    });

    // 2. Emergency contact
    if (data.emergency_contact_name && data.emergency_mobile) {
      await repo.upsertEmergencyContact(client, {
        employee_id, zodu_id: data.zodu_id, branch_id: data.branch_id,
        contact_name:  data.emergency_contact_name,
        relationship:  data.emergency_relationship || null,
        mobile_number: data.emergency_mobile,
      });
    }

    await client.query('COMMIT');

    // 3. Salary in payroll-service (non-blocking)
    if (data.basic_salary != null) {
      internalHttp.post(`${PAYROLL_SERVICE_URL}/internal/salary/create`, {
        employee_id, user_id,
        zodu_id: data.zodu_id, branch_id: data.branch_id,
        basic_salary: data.basic_salary, allowances: data.allowances || 0,
        payment_type: data.payment_type || 'Monthly',
        bank_account_number: data.bank_account_number || null,
        bank_name: data.bank_name || null, ifsc_code: data.ifsc_code || null,
        created_by,
      }).catch(err => console.error('[payroll] salary create failed:', err.message));
    }

    return { success: true, data: { employee_id, employee_code, user_id } };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── LOGIN STATUS (auth-service) ──────────────────────────────────────────────
// Returns { [user_id]: { has_password, has_role } }. If auth-service is down the
// map is empty and callers report null ("unknown") rather than a wrong false.

// Full login-status response: { data: {[user_id]: flags}, login_user_count }.
// with_count asks auth-service to also count the branch's login_user = true users
// (the list's pagination needs it; detail/set-login callers don't).
async function callLoginStatus(user_ids, { zodu_id, branch_id }, with_count = false) {
  const ids = [...new Set(user_ids.filter(Boolean))];
  if (!ids.length && !with_count) return {};
  try {
    const { data } = await internalHttp.post(
      `${AUTH_SERVICE_URL}/internal/employee/login-status`,
      { user_ids: ids, zodu_id, branch_id, with_count }
    );
    return data;
  } catch (err) {
    console.error('[auth] login-status failed:', err.message);
    return {};
  }
}

const fetchLoginStatus = async (user_ids, scope) => (await callLoginStatus(user_ids, scope)).data || {};

// ── LIST ──────────────────────────────────────────────────────────────────────

exports.getEmployees = async ({ zodu_id, branch_id, status, page = 1, limit = 10, search }) => {
  const parsedLimit  = Math.min(parseInt(limit, 10) || 10, 100);
  const parsedOffset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * parsedLimit;

  const [rows, total] = await Promise.all([
    repo.findAll({ zodu_id, branch_id, status, search, limit: parsedLimit, offset: parsedOffset }),
    repo.countAll({ zodu_id, branch_id, status, search }),
  ]);

  // login_user_count is null (unknown) if auth-service is unreachable.
  const { data: loginStatus = {}, login_user_count = null } =
    await callLoginStatus(rows.map((r) => r.user_id), { zodu_id, branch_id }, true);
  const data = rows.map(({ user_id, ...emp }) => ({
    ...emp,
    has_password: loginStatus[user_id]?.has_password ?? null,
    has_role:     loginStatus[user_id]?.has_role     ?? null,
    login_user: loginStatus[user_id]?.login_user ?? null,
    role_name: loginStatus[user_id]?.role_name ?? null,
  }));

  return {
    success: true,
    data,
    pagination: { total, page: +page, limit: parsedLimit, pages: Math.ceil(total / parsedLimit), login_user_count },
  };
};

// ── DETAIL ────────────────────────────────────────────────────────────────────

exports.getEmployeeById = async (employee_id, { zodu_id, branch_id }) => {
  const employee = await repo.findById(employee_id, { zodu_id, branch_id });
  if (!employee) return null;

  const [[docsResult, authResult, salaryResult], loginStatus] = await Promise.all([
    Promise.allSettled([
      repo.findDocuments(employee_id),
      internalHttp.get(`${AUTH_SERVICE_URL}/internal/employee/${employee.user_id}/role`),
      internalHttp.get(`${PAYROLL_SERVICE_URL}/internal/salary/${employee_id}`),
    ]),
    fetchLoginStatus([employee.user_id], { zodu_id, branch_id }),
  ]);
  const ls = loginStatus[employee.user_id];

  return {
    success: true,
    data: {
      ...employee,
      has_password: ls?.has_password ?? null,
      has_role:     ls?.has_role     ?? null,
      login_user:   ls?.login_user   ?? null,
      documents: docsResult.status  === 'fulfilled' ? docsResult.value.map((d) => files.ref(d)) : [],
      role_info: authResult.status   === 'fulfilled' ? authResult.value.data.data   : null,
      salary:    salaryResult.status === 'fulfilled' ? salaryResult.value.data.data : null,
    },
  };
};

// ── SET LOGIN DETAILS (role / password) ──────────────────────────────────────
// Used by the "Set User / Login Details" modal. Sets only what is sent. The
// employee already holds a reserved user_id; on the first call the auth-service
// creates the tbl_users row with that id (from the employee's email / phone),
// plus the company link and role. Later calls only update role / password.

// The owner's login (the first employee, EMP001) is changed by the owner only:
// otherwise anyone with employee:edit could take the account over.
function assertMayChangeLogin(employee, caller) {
  if (employee.employee_code === 'EMP001' && !caller?.isOwner) {
    const e = new Error("Only the owner can change the owner's login");
    e.status = 403;
    throw e;
  }
}

exports.setLoginDetails = async (employee_id, { zodu_id, branch_id, role_id, password, login_user }, caller) => {
  const employee = await repo.findById(employee_id, { zodu_id, branch_id });
  if (!employee) throw new Error('Employee not found');
  assertMayChangeLogin(employee, caller);

  try {
    await internalHttp.put(
      `${AUTH_SERVICE_URL}/internal/employee/login-details`,
      {
        user_id: employee.user_id,
        zodu_id, branch_id, role_id, password, login_user,
        reporting_manager_id: employee.reporting_manager_id || null,
        email: employee.email || null,
        phone: employee.phone || null,
        is_first_employee: employee.employee_code === 'EMP001',
      }
    );
  } catch (err) {
    const code = err.response?.status;
    const e = new Error(err.response?.data?.error || 'Failed to update login details');
    e.status = [400, 404, 409].includes(code) ? code : 500;
    throw e;
  }

  const status = (await fetchLoginStatus([employee.user_id], { zodu_id, branch_id }))[employee.user_id];
  return {
    success: true,
    data: {
      employee_id,
      user_id:      employee.user_id,
      has_password: status?.has_password ?? null,
      has_role:     status?.has_role     ?? null,
      login_user:   status?.login_user   ?? null,
    },
  };
};

// ── UPDATE ────────────────────────────────────────────────────────────────────

exports.updateEmployee = async (employee_id, data, updated_by, caller) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Get current employee to find user_id for exclude check
    const current = await repo.findById(employee_id, { zodu_id: data.zodu_id, branch_id: data.branch_id });
    if (!current) throw new Error('Employee not found');
    // email / phone are the owner's sign-in identifiers
    if (data.email !== undefined || data.phone !== undefined || data.status !== undefined) assertMayChangeLogin(current, caller);

    // Check email + phone duplicate in tbl_users (auth-service) excluding current user
    const emailToCheck = data.email || null;
    const phoneToCheck = data.phone || null;
    if (emailToCheck || phoneToCheck) {
      const { data: dupCheck } = await internalHttp.post(
        `${AUTH_SERVICE_URL}/internal/employee/check-duplicate`,
        { email: emailToCheck, phone: phoneToCheck, exclude_user_id: current.user_id }
      );
      if (dupCheck.email_taken) throw new Error('Email already used by another employee');
      if (dupCheck.phone_taken) throw new Error('Phone already used by another employee');
    }

    // Sync email / phone to tbl_users (no-op until Set User has created the login)
    if (emailToCheck || phoneToCheck) {
      try {
        await internalHttp.put(
          `${AUTH_SERVICE_URL}/internal/employee/${current.user_id}/update-user`,
          { email: data.email, phone: data.phone }
        );
      } catch (err) {
        throw new Error(err.response?.data?.error || 'Failed to update user credentials');
      }
    }

    const updated = await repo.updateEmployee(client, employee_id, {
      ...data, updated_by,
    });
    // null means no updatable employee fields were sent (e.g. only salary fields) — use current
    const result = updated || current;

    if (data.emergency_contact_name !== undefined || data.emergency_mobile !== undefined || data.emergency_relationship !== undefined) {
      await repo.upsertEmergencyContact(client, {
        employee_id, zodu_id: data.zodu_id, branch_id: data.branch_id,
        contact_name:  data.emergency_contact_name,
        relationship:  data.emergency_relationship,
        mobile_number: data.emergency_mobile,
      });
    }

    await client.query('COMMIT');

    // Sync salary — only send fields actually present in request
    const salaryFields = ['basic_salary','allowances','payment_type','bank_name','ifsc_code','bank_account_number'];
    const hasSalaryChange = salaryFields.some(f => data[f] !== undefined);
    const isMasked = data.bank_account_number?.includes('X');

    if (hasSalaryChange) {
      const salaryPayload = {
        user_id: result.user_id, zodu_id: data.zodu_id,
        branch_id: data.branch_id, updated_by,
      };
      if (data.basic_salary !== undefined) salaryPayload.basic_salary = data.basic_salary;
      if (data.allowances   !== undefined) salaryPayload.allowances   = data.allowances;
      if (data.payment_type !== undefined) salaryPayload.payment_type = data.payment_type;
      if (data.bank_name    !== undefined) salaryPayload.bank_name    = data.bank_name;
      if (data.ifsc_code    !== undefined) salaryPayload.ifsc_code    = data.ifsc_code;
      if (!isMasked && data.bank_account_number !== undefined)
        salaryPayload.bank_account_number = data.bank_account_number;

      internalHttp.put(`${PAYROLL_SERVICE_URL}/internal/salary/${employee_id}`, salaryPayload)
        .catch(err => console.error('[payroll] salary update failed:', err.message));
    }

    return { success: true, data: result };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── DELETE ────────────────────────────────────────────────────────────────────

exports.deleteEmployee = async (employee_id, { zodu_id, branch_id, status }, caller) => {
  const employee = await repo.findById(employee_id, { zodu_id, branch_id });
  if (!employee) throw new Error('Employee not found');
  assertMayChangeLogin(employee, caller);

  await repo.softDelete(employee_id, { zodu_id, branch_id, status });

  internalHttp.put(`${AUTH_SERVICE_URL}/internal/employee/${employee.user_id}/deactivate`)
    .catch(err => console.error('[auth] deactivate failed:', err.message));

  return { success: true };
};

// ── DOCUMENTS ─────────────────────────────────────────────────────────────────

// The file goes to file-service under this employee (Aadhaar, PAN, ...:
// "documents"; the avatar: "profile"); the row keeps only its file_id. If the
// row can't be saved, the uploaded file is removed again.
exports.uploadDocument = async (employee_id, fileData, uploaded_by, ctx) => {
  const employee = await repo.findById(employee_id, {
    zodu_id: fileData.zodu_id, branch_id: fileData.branch_id,
  });
  if (!employee) throw new Error('Employee not found');

  const [stored] = await files.upload(ctx, {
    module:   'employee',
    entityId: employee_id,
    category: fileData.document_type === 'Profile Photo' ? 'profile' : 'documents',
    files:    [fileData.file],
  });

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const doc = await repo.insertDocument(client, {
      employee_id, zodu_id: fileData.zodu_id, branch_id: fileData.branch_id,
      document_type: fileData.document_type,
      file_name:     stored.original_name,
      file_id:       stored.file_id,
      uploaded_by,
    });
    await client.query('COMMIT');
    return { success: true, data: files.ref(doc) };
  } catch (err) {
    await client.query('ROLLBACK');
    await files.quietly(files.remove(ctx, [stored.file_id]));
    throw err;
  } finally {
    client.release();
  }
};

exports.deleteDocument = async (doc_id, employee_id, { zodu_id, branch_id }, ctx) => {
  const employee = await repo.findById(employee_id, { zodu_id, branch_id });
  if (!employee) throw new Error('Employee not found');

  const doc = await repo.deleteDocument(doc_id, employee_id);
  if (!doc) throw new Error('Document not found');

  // Files from before file-service (file_url only) stay in the old bucket
  // until the Phase 3 migration; it never deletes there.
  if (doc.file_id) await files.quietly(files.remove(ctx, [doc.file_id]));

  return { success: true };
};
