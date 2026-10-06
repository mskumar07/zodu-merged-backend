-- tbl_users.login_user — set by the "Set User / Login Details" API
-- (PUT /employee/api/employees/:id/login-details, body field `login_user`).
-- Defaults to true so every existing user keeps their current state.
--
-- Run once against the retail_auth_service database. Safe to re-run.

ALTER TABLE tbl_users ADD COLUMN IF NOT EXISTS login_user BOOLEAN NOT NULL DEFAULT true;
