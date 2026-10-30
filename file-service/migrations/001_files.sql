-- file-service — every stored file, and an audit trail of private downloads and deletes.
--
-- Owning services keep only file_id (or a JSONB array of file_ids); URLs are
-- built when a response is sent, never stored. Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS tbl_files (
    file_id        UUID PRIMARY KEY,
    zodu_id        VARCHAR(64)  NOT NULL,
    branch_id      VARCHAR(64),                       -- NULL for tenant-scope (_shared) modules
    module         VARCHAR(40)  NOT NULL,
    category       VARCHAR(40),
    entity_id      VARCHAR(64)  NOT NULL,
    object_key     VARCHAR(512) NOT NULL,
    mime_type      VARCHAR(100) NOT NULL,
    size_bytes     BIGINT       NOT NULL CHECK (size_bytes >= 0),
    original_name  VARCHAR(255) NOT NULL,             -- safeFileName()-sanitised, display only
    uploaded_by    VARCHAR(64),
    status         VARCHAR(10)  NOT NULL DEFAULT 'ready',
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    deleted_at     TIMESTAMPTZ,
    purged_at      TIMESTAMPTZ,                       -- object removed from storage by the purge job
    legacy_url     TEXT,                              -- old PUBLIC_FILE_BASE_URL/... URL (Phase 3 data migration)
    CONSTRAINT tbl_files_object_key_key UNIQUE (object_key),
    CONSTRAINT tbl_files_status_chk CHECK (status IN ('ready', 'deleted'))
);

CREATE INDEX IF NOT EXISTS idx_files_entity
    ON tbl_files (zodu_id, branch_id, module, entity_id);
CREATE INDEX IF NOT EXISTS idx_files_zodu_created
    ON tbl_files (zodu_id, created_at);
-- Purge job: soft-deleted rows whose object is still in storage.
CREATE INDEX IF NOT EXISTS idx_files_purge
    ON tbl_files (deleted_at) WHERE status = 'deleted' AND purged_at IS NULL;
-- Phase 3 legacy-URL fallback looks rows up by their old URL.
CREATE INDEX IF NOT EXISTS idx_files_legacy_url
    ON tbl_files (legacy_url) WHERE legacy_url IS NOT NULL;

CREATE TABLE IF NOT EXISTS tbl_file_access_log (
    id        BIGSERIAL PRIMARY KEY,
    file_id   UUID         NOT NULL,
    user_id   VARCHAR(64),
    zodu_id   VARCHAR(64)  NOT NULL,
    action    VARCHAR(20)  NOT NULL,                  -- url | content | resolve | delete
    ip        VARCHAR(64),
    at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_file_access_log_file ON tbl_file_access_log (file_id, at);
CREATE INDEX IF NOT EXISTS idx_file_access_log_zodu ON tbl_file_access_log (zodu_id, at);
