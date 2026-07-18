const bcrypt = require('bcryptjs');
const repo   = require('../repository/role-repo');
const { withTransaction } = require('../utils/transaction');

// ── CREATE ROLE ───────────────────────────────────────────────────────────────

exports.createRole = async ({ zodu_id, branch_id, role_name, description, permissions }) => {
  const role = await withTransaction(async (client) => {
    const newRole = await repo.createRole(client, { zodu_id, branch_id, role_name, description });

    await repo.deleteAccessByRole(client, newRole.role_id);

    for (const p of permissions) {
      await repo.upsertAccessControl(client, {
        role_id:    newRole.role_id,
        zodu_id,
        branch_id,
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

    if (permissions && permissions.length > 0) {
      await repo.deleteAccessByRole(client, role_id);

      for (const p of permissions) {
        await repo.upsertAccessControl(client, {
          role_id,
          zodu_id,
          branch_id,
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

  return { success: true, data: updated };
};

// ── DELETE ROLE ───────────────────────────────────────────────────────────────

exports.deleteRole = async (role_id, { zodu_id, branch_id }) => {
  await withTransaction(async (client) => {
    await repo.deleteAccessByRole(client, role_id);

    const deleted = await repo.deleteRole(client, role_id, { zodu_id, branch_id });
    if (!deleted) throw new Error('Role not found');
  });

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

exports.createEmployeeUser = async ({ email, phone, zodu_id, branch_id, role_id, access_level, reporting_manager_id, password }) => {
  const user_id = await withTransaction(async (client) => {
    const emailExists = email ? await repo.checkEmailExists(client, email) : false;
    if (emailExists) throw new Error('Email already registered');

    const phoneExists = await repo.checkPhoneExists(client, phone);
    if (phoneExists) throw new Error('Phone already registered');

    const salt          = await bcrypt.genSalt(10);
    const rawPassword   = password || `${phone.slice(-4)}@Zodu`;
    const password_hash = await bcrypt.hash(rawPassword, salt);

    const id = await repo.createEmployeeUser(client, { email, phone, zodu_id, password_hash });

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

  return { success: true };
};

// ── INTERNAL — deactivate employee ───────────────────────────────────────────

exports.deactivateEmployee = async (user_id) => {
  await repo.deactivateEmployeeUser(user_id);
  return { success: true };
};

exports.updateEmployeeUser = async (user_id, { email, phone, password }) => {
  if (password) {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);
    await repo.updateUserPassword(user_id, hash);
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
