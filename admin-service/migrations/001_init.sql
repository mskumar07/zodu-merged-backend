-- Admin console's own schema. Lives in the `admin_service` database —
-- completely separate from every product DB (retail_auth_service,
-- retail_service, employee-service, ...). This backend never writes to
-- those; it only calls their APIs (see src/clients/).
--
-- Keeping this minimal for now: just what's needed to log in and run the
-- dashboard. Audit log / roles-permissions table etc. can be added as their
-- own later migration once that feature is actually being built.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── ADMIN USERS ──────────────────────────────────────────────────────────
-- Admin console operators — distinct from Zodu's customer/business users in
-- retail_auth_service.tbl_account_creation. Different audience, different
-- login, different session lifetime.
CREATE TABLE IF NOT EXISTS tbl_admin_users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          VARCHAR(120) NOT NULL,
    email         VARCHAR(150) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          VARCHAR(30) NOT NULL DEFAULT 'viewer',
        -- 'super_admin' | 'support' | 'finance' | 'viewer'
    is_active     BOOLEAN NOT NULL DEFAULT true,
    last_login_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_users_email ON tbl_admin_users(email);
