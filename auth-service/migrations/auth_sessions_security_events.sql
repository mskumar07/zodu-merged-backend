-- auth-service — ES256 tokens and refresh-token families (security Phase 2).
--
-- tbl_user_sessions keeps one row per session family (device login) for
-- listing and auditing; the refresh token itself lives only in Redis, hashed.
-- New rows have refresh_token NULL; the column still holds the plaintext of
-- pre-switch sessions until LEGACY_REFRESH_CUTOFF, then is dropped (Phase 4).
-- Idempotent.

ALTER TABLE tbl_user_sessions
    ALTER COLUMN refresh_token DROP NOT NULL;

ALTER TABLE tbl_user_sessions
    ADD COLUMN IF NOT EXISTS platform      VARCHAR(16),
    ADD COLUMN IF NOT EXISTS last_used_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS revoked_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS revoke_reason VARCHAR(40);

-- Security event log. Never passwords, tokens or request bodies.
CREATE TABLE IF NOT EXISTS tbl_security_events (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID,
    zodu_id     VARCHAR(50),
    event       VARCHAR(64) NOT NULL,
    ip          VARCHAR(64),
    user_agent  TEXT,
    platform    VARCHAR(16),
    details     JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_events_user    ON tbl_security_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_event   ON tbl_security_events (event, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_company ON tbl_security_events (zodu_id, created_at DESC);
