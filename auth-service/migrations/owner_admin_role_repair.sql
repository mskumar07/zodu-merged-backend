-- Owners (user_type super_admin) linked to a company in tbl_user_companies but
-- with no role there. The old code let any linked user in; access now comes
-- from roles only (switch-context, login context), so these owners were refused
-- their own company. Cause: createcompany's default-role step is non-fatal and
-- had failed or the role was removed later.
--
-- Each such owner gets the company's 'Admin' role (the owner role: passes every
-- permission check inside its company). A company with no 'Admin' role gets one,
-- company-wide with every module granted, as createDefaultRoleForCompany makes it.
-- Employees without a role are left as they are: they need a role assigned.
-- Idempotent: a second run finds nothing to do.

BEGIN;

CREATE TEMP TABLE owners_without_role ON COMMIT DROP AS
SELECT DISTINCT uc.user_id, uc.zodu_id
  FROM tbl_user_companies uc
  JOIN tbl_users u     ON u.user_id = uc.user_id
  JOIN tbl_business b  ON b.zodu_id = uc.zodu_id
 WHERE u.user_type = 'super_admin'
   AND COALESCE(u.is_deleted, false) = false
   AND NOT EXISTS (SELECT 1 FROM tbl_user_roles ur
                    WHERE ur.user_id = uc.user_id AND ur.zodu_id = uc.zodu_id);

-- 1. An 'Admin' role for companies that have none.
WITH created AS (
  INSERT INTO tbl_roles (zodu_id, branch_id, role_name, description)
  SELECT DISTINCT o.zodu_id, NULL, 'Admin', 'Full access — restored for the company owner'
    FROM owners_without_role o
   WHERE NOT EXISTS (SELECT 1 FROM tbl_roles r WHERE r.zodu_id = o.zodu_id AND r.role_name = 'Admin')
  ON CONFLICT (zodu_id, role_name) DO NOTHING
  RETURNING role_id, zodu_id
)
INSERT INTO tbl_access_control (role_id, zodu_id, module_id, can_read, can_create, can_edit, can_delete)
SELECT c.role_id, c.zodu_id, m.module_id, true, true, true, true
  FROM created c CROSS JOIN tbl_modules m;

-- 2. Bind each owner to it.
INSERT INTO tbl_user_roles (user_id, role_id, zodu_id)
SELECT o.user_id, r.role_id, o.zodu_id
  FROM owners_without_role o
  JOIN tbl_roles r ON r.zodu_id = o.zodu_id AND r.role_name = 'Admin'
ON CONFLICT DO NOTHING;

COMMIT;
