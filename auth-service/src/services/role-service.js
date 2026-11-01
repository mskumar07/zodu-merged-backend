const repo   = require('../repository/role-repo');
const authRepo = require('../repository/auth-repo');
const { withTransaction } = require('../utils/transaction');
const { hashPassword, assertPasswordPolicy } = require('../auth/password');
const { revokeAllForUser, revokeAllForUsers } = require('./session-service');

// Sessions are revoked after the change commits (access tokens carry the
// permissions, so a role change must force a fresh token): password change,
// login disabled, deactivation, role or access change.

// Owner / Admin passwords need 12 characters, everyone else's 8.
async function isOwnerLogin({ role_id, zodu_id, branch_id, is_first_employee }) {
  if (is_first_employee) return true;
  if (!role_id) return false;
  const role = await repo.findRoleById(role_id, { zodu_id, branch_id });
  return role?.role_name === 'Admin';
}

// ── CREATE ROLE ───────────────────────────────────────────────────────────────

exports.createRole = async ({ zodu_id, branch_id, role_name, description, permissions }) => {
  // Admin role is always global — never scope it (or its permissions) to a branch
  const roleBranchId = role_name === 'Admin' ? null : branch_id;

  const role = await withTransaction(async (client) => {
    const newRole = await repo.createRole(client, { zodu_id, branch_id: roleBranchId, role_name, description });

    await repo.deleteAccessByRole(client, newRole.role_id);

    for (const p of permissions) {
      await repo.upsertAccessControl(client, {
        role_id:    newRole.role_id,
        zodu_id,
        branch_id:  roleBranchId,
        module_id:  p.module_id,
        can_read:   p.can_read   ?? false,
        can_create: p.can_create ?? false,
        can_edit:   p.can_edit   ?? false,
        can_delete: p.can_delete ?? false,
      });
    }

    return newRole;
  });

  return { success: true, data: role };
};

// ── GET ALL ROLES ─────────────────────────────────────────────────────────────

exports.getRoles = async ({ zodu_id, branch_id }) => {
  const data = await repo.findRoles({ zodu_id, branch_id });
  return { success: true, data };
};

// ── GET ROLE WITH PERMISSIONS ─────────────────────────────────────────────────

exports.getRoleWithPermissions = async (role_id, { zodu_id, branch_id }) => {
  const [role, permissions] = await Promise.all([
    repo.findRoleById(role_id, { zodu_id, branch_id }),
    repo.findAccessByRole(role_id),
  ]);

  if (!role) return { success: false, error: 'Role not found' };

  // Build parent → sub-module tree
  const parentMap = {};
  for (const p of permissions) {
    if (!p.parent_module_id) parentMap[p.module_id] = { ...p, sub_modules: [] };
  }
  for (const p of permissions) {
    if (p.parent_module_id && parentMap[p.parent_module_id]) {
      parentMap[p.parent_module_id].sub_modules.push(p);
    }
  }

  return { success: true, data: { ...role, permissions: Object.values(parentMap) } };
};

// ── UPDATE ROLE ───────────────────────────────────────────────────────────────

exports.updateRole = async (role_id, { zodu_id, branch_id, role_name, description, permissions }) => {
  const updated = await withTransaction(async (client) => {
    const role = await repo.updateRole(client, role_id, { zodu_id, branch_id, role_name, description });
    if (!role) throw new Error('Role not found');

    // Admin role stays global — never let access_control rows get pinned to a branch
    const accessBranchId = role.role_name === 'Admin' ? null : branch_id;

    if (permissions && permissions.length > 0) {
      await repo.deleteAccessByRole(client, role_id);

      for (const p of permissions) {
        await repo.upsertAccessControl(client, {
          role_id,
          zodu_id,
          branch_id: accessBranchId,
          module_id:  p.module_id,
          can_read:   p.can_read   ?? false,
          can_create: p.can_create ?? false,
          can_edit:   p.can_edit   ?? false,
          can_delete: p.can_delete ?? false,
        });
      }
    }

    return role;
  });

  await revokeAllForUsers(await authRepo.getRoleUserIds({ role_id }), 'role_changed');
  return { success: true, data: updated };
};

// ── DELETE ROLE ───────────────────────────────────────────────────────────────

exports.deleteRole = async (role_id, { zodu_id, branch_id }) => {
  const affected = await authRepo.getRoleUserIds({ role_id });
  await withTransaction(async (client) => {
    await repo.deleteAccessByRole(client, role_id);

    const deleted = await repo.deleteRole(client, role_id, { zodu_id, branch_id });
    if (!deleted) throw new Error('Role not found');
  });

  await revokeAllForUsers(affected, 'role_deleted');
  return { success: true };
};

// ── GET MODULES ───────────────────────────────────────────────────────────────

exports.getModules = async () => {
  const modules   = await repo.findAllModules();
  const parentMap = {};
  const children  = [];

  for (const m of modules) {
    if (!m.parent_module_id) parentMap[m.module_id] = { ...m, sub_modules: [] };
    else children.push(m);
  }
  for (const c of children) {
    if (parentMap[c.parent_module_id]) parentMap[c.parent_module_id].sub_modules.push(c);
  }

  return { success: true, data: Object.values(parentMap) };
};

// ── INTERNAL — create employee login ──────────────────────────────────────────

exports.createEmployeeUser = async ({ email, phone, zodu_id, branch_id, role_id, access_level, reporting_manager_id, password, is_first_employee }) => {
  if (password) assertPasswordPolicy(password, { owner: await isOwnerLogin({ role_id, zodu_id, branch_id, is_first_employee }) });
  const user_id = await withTransaction(async (client) => {
    const emailExists = email ? await repo.checkEmailExists(client, email) : false;
    if (emailExists) throw new Error('Email already registered');

    const phoneExists = await repo.checkPhoneExists(client, phone);
    if (phoneExists) throw new Error('Phone already registered');

    // tbl_users.password_hash is NOT NULL — a login cannot be created without a password.
    if (!password) throw new Error('Password is required to create the login');
    const password_hash = await hashPassword(password);

    const user_type = is_first_employee ? 'super_admin' : 'employee';
    const id = await repo.createEmployeeUser(client, { email, phone, zodu_id, password_hash, user_type });

    if (role_id) {
      await repo.assignEmployeeRole(client, {
        user_id: id, role_id, zodu_id, branch_id,
        reporting_manager_id: reporting_manager_id || null,
        access_level:         access_level || 'Full Access',
      });
    }

    return id;
  });

  return { success: true, user_id };
};

// ── INTERNAL — get employee role ──────────────────────────────────────────────

exports.getEmployeeRole = async (user_id) => {
  const roleInfo = await repo.findEmployeeRole(user_id);
  if (!roleInfo) return { success: true, data: null };

  const permissions = await repo.findAccessByRole(roleInfo.role_id);
  return { success: true, data: { ...roleInfo, permissions } };
};

// ── INTERNAL — update employee role ──────────────────────────────────────────

exports.updateEmployeeRole = async (user_id, { role_id, access_level, zodu_id, branch_id, reporting_manager_id }) => {
  await withTransaction(async (client) => {
    await repo.assignEmployeeRole(client, {
      user_id, role_id, zodu_id, branch_id,
      reporting_manager_id: reporting_manager_id || null,
      access_level:         access_level || 'Full Access',
    });
  });

  await revokeAllForUser(user_id, 'role_changed');
  return { success: true };
};

// ── INTERNAL — deactivate employee ───────────────────────────────────────────

exports.deactivateEmployee = async (user_id) => {
  await repo.deactivateEmployeeUser(user_id);
  await revokeAllForUser(user_id, 'deactivated');
  return { success: true };
};

exports.updateEmployeeUser = async (user_id, { email, phone, password }) => {
  if (password) {
    const user = await authRepo.findUserState({ user_id });
    assertPasswordPolicy(password, { owner: user?.user_type === 'super_admin' });
    await repo.updateUserPassword(user_id, await hashPassword(password));
    await revokeAllForUser(user_id, 'password_changed');
  }
  if (email || phone) {
    await repo.updateUserEmailPhone(user_id, { email, phone });
  }
  return { success: true };
};

exports.checkDuplicate = async ({ email, phone, exclude_user_id }) => {
  const result = { success: true, email_taken: false, phone_taken: false };

  if (email) {
    result.email_taken = await repo.checkEmailExistsExcluding(email, exclude_user_id);
  }
  if (phone) {
    result.phone_taken = await repo.checkPhoneExistsExcluding(phone, exclude_user_id);
  }

  return result;
};

// ── INTERNAL — login status (has_password / has_role) for many users ─────────

exports.getLoginStatus = async ({ user_ids, zodu_id, branch_id, with_count = false }) => {
  const [rows, login_user_count] = await Promise.all([
    user_ids.length ? repo.findLoginStatus(user_ids, { zodu_id, branch_id }) : [],
    with_count ? repo.countLoginUsers({ zodu_id, branch_id }) : undefined,
  ]);
  // An employee whose login has not been set up yet has no tbl_users row → false / false.
  const data = {};
  for (const id of user_ids) data[id] = { has_password: false, has_role: false, login_user: false };
  for (const r of rows) data[r.user_id] = { has_password: r.has_password, has_role: r.has_role, login_user: r.login_user, role_name: r.role_name };
  // login_user_count: users with login_user = true holding a role in this
  // company + branch — a branch-wide figure, independent of user_ids.
  return { success: true, data, login_user_count };
};

// ── INTERNAL — set role and/or password (Set User / Login Details) ───────────

exports.setEmployeeLogin = async ({ user_id, role_id, password, login_user, zodu_id, branch_id, reporting_manager_id, email, phone, is_first_employee }) => {
  if (password) assertPasswordPolicy(password, { owner: await isOwnerLogin({ role_id, zodu_id, branch_id, is_first_employee }) });
  let existed = false;
  await withTransaction(async (client) => {
    // Serialize concurrent Set User calls for the same employee: the second one
    // waits here, then sees the user already exists and only updates.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`login:${user_id}`]);

    if (role_id) {
      const role = await repo.findRoleById(role_id, { zodu_id, branch_id });
      if (!role) throw new Error('Role not found');
    }

    const password_hash = password ? await hashPassword(password) : null;

    existed = await repo.userExists(client, user_id);
    if (!existed) {
      // First time this employee gets a login → create the tbl_users row (+ company link) now.
      // password_hash is NOT NULL, so the password must come with the first call.
      if (!password) throw new Error('Password is required to create the login');
      if (!phone) throw new Error('Employee phone is required to create the login');

      // Serialize check-then-insert for the same phone across different employees.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`phone:${phone}`]);
      if (email && await repo.checkEmailExists(client, email)) throw new Error('Email already registered');
      if (await repo.checkPhoneExists(client, phone))          throw new Error('Phone already registered');

      await repo.createEmployeeUser(client, {
        user_id, email, phone, zodu_id, password_hash,
        user_type: is_first_employee ? 'super_admin' : 'employee',
        login_user: login_user ?? true,
      });
    } else {
      if (password_hash)          await repo.setUserPassword(client, user_id, password_hash);
      if (login_user !== undefined) await repo.setLoginUser(client, user_id, login_user);
    }

    if (role_id) {
      await repo.setUserRole(client, { user_id, role_id, zodu_id, branch_id, reporting_manager_id });
    }
  });
  if (existed && (password || login_user === false || role_id)) {
    await revokeAllForUser(user_id, password ? 'password_changed' : login_user === false ? 'login_disabled' : 'role_changed');
  }
  return { success: true, user_id };
};
