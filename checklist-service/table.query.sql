-- ─────────────────────────────────────────────────────────────────────────────
-- CHECKLIST SERVICE  —  table.query.sql
-- Run in: checklist-service database
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION  —  run this against the EXISTING database (tbl_checklists already
-- has rows). Backfills checklist_code for old rows, then locks the column down.
-- ─────────────────────────────────────────────────────────────────────────────
-- ALTER TABLE tbl_checklists ADD COLUMN checklist_code VARCHAR(30);
--
-- WITH numbered AS (
--   SELECT id, zodu_id,
--          ROW_NUMBER() OVER (PARTITION BY zodu_id ORDER BY created_at) AS rn
--   FROM tbl_checklists
--   WHERE checklist_code IS NULL
-- )
-- UPDATE tbl_checklists c
-- SET checklist_code = 'CHECKLIST-' || LPAD(numbered.rn::text, 3, '0')
-- FROM numbered
-- WHERE c.id = numbered.id;
--
-- ALTER TABLE tbl_checklists ALTER COLUMN checklist_code SET NOT NULL;
-- CREATE UNIQUE INDEX uq_checklists_zodu_code ON tbl_checklists(zodu_id, checklist_code);
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION  —  adds shared status + remarks per checklist item (any assignee
-- can update; one state per item, not per-employee) for the "View/Update Task" screen.
-- status: 'Not Started', 'Completed', 'Not Completed', 'Cancelled'
-- ─────────────────────────────────────────────────────────────────────────────
-- ALTER TABLE tbl_checklist_items ADD COLUMN status  VARCHAR(20) NOT NULL DEFAULT 'Not Started';
-- ALTER TABLE tbl_checklist_items ADD COLUMN remarks TEXT;
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION  —  collapses tbl_checklist_attachments back to ONE ROW PER CHECKLIST
-- (file_url becomes an array again). Run only if attachments currently has
-- multiple rows per checklist_id from the one-row-per-file experiment.
-- ─────────────────────────────────────────────────────────────────────────────
-- WITH merged AS (
--   SELECT checklist_id,
--          jsonb_agg(jsonb_build_object(
--            'id', id, 'file_name', file_url->>'file_name', 'file_url', file_url->>'file_url',
--            'uploaded_by', uploaded_by, 'uploaded_by_name', uploaded_by_name
--          ) ORDER BY uploaded_at) AS file_url,
--          MAX(uploaded_by)      AS uploaded_by,
--          MAX(uploaded_by_name) AS uploaded_by_name,
--          MAX(uploaded_at)      AS uploaded_at
--   FROM tbl_checklist_attachments
--   GROUP BY checklist_id
-- )
-- DELETE FROM tbl_checklist_attachments;
-- INSERT INTO tbl_checklist_attachments (checklist_id, file_url, uploaded_by, uploaded_by_name, uploaded_at)
-- SELECT checklist_id, file_url, uploaded_by, uploaded_by_name, uploaded_at FROM merged;
--
-- ALTER TABLE tbl_checklist_attachments ADD CONSTRAINT uq_attachments_checklist UNIQUE (checklist_id);
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. MASTER CHECKLIST / TASK
CREATE TABLE tbl_checklists (
    id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    checklist_code   VARCHAR(30)  NOT NULL,
    -- per-zodu sequential code, e.g. CHECKLIST-001
    zodu_id          VARCHAR(50)  NOT NULL,
    branch_id        VARCHAR(50)  NOT NULL,
    title            VARCHAR(255) NOT NULL,
    description      TEXT,
    status           VARCHAR(30)  NOT NULL DEFAULT 'Not Started',
    -- values: 'Not Started', 'In Progress', 'Completed', 'Overdue'
    due_date         DATE,
    start_date       DATE,
    is_recurring     BOOLEAN      NOT NULL DEFAULT FALSE,
    recur_frequency  VARCHAR(20),
    -- values: 'Daily', 'Weekly', 'Monthly', 'Yearly'
    recur_every      INTEGER,
    -- repeat every N days/weeks/months
    recur_ends       VARCHAR(20),
    -- values: 'Never', 'On Date'
    recur_end_date   DATE,
    recur_start_date DATE,
    created_by       UUID         NOT NULL,
    created_by_name  VARCHAR(100) NOT NULL,
    updated_by       UUID,
    updated_by_name  VARCHAR(100),
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_checklists_zodu_code ON tbl_checklists(zodu_id, checklist_code);
CREATE INDEX idx_checklists_zodu_branch ON tbl_checklists(zodu_id, branch_id);
CREATE INDEX idx_checklists_status      ON tbl_checklists(status);
CREATE INDEX idx_checklists_due_date    ON tbl_checklists(due_date);
CREATE INDEX idx_checklists_created_by  ON tbl_checklists(created_by);
CREATE INDEX idx_checklists_recurring   ON tbl_checklists(is_recurring) WHERE is_recurring = TRUE;

-- ─────────────────────────────────────────────────────────────────────────────

-- 2. EMPLOYEES ASSIGNED TO A CHECKLIST
CREATE TABLE tbl_checklist_assignees (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    checklist_id   UUID         NOT NULL REFERENCES tbl_checklists(id) ON DELETE CASCADE,
    employee_id    UUID         NOT NULL,
    employee_name  VARCHAR(100) NOT NULL,
    status         VARCHAR(30)  NOT NULL DEFAULT 'Not Started',
    -- values: 'Not Started', 'In Progress', 'Completed', 'Overdue'
    assigned_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_checklist_employee UNIQUE (checklist_id, employee_id)
);

CREATE INDEX idx_assignees_checklist ON tbl_checklist_assignees(checklist_id);
CREATE INDEX idx_assignees_employee  ON tbl_checklist_assignees(employee_id);

-- ─────────────────────────────────────────────────────────────────────────────

-- 3. CHECKLIST LINE ITEMS  (section 3 in UI)
CREATE TABLE tbl_checklist_items (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    checklist_id  UUID         NOT NULL REFERENCES tbl_checklists(id) ON DELETE CASCADE,
    item_order    INTEGER      NOT NULL DEFAULT 1,
    item_title    VARCHAR(500) NOT NULL,
    description   TEXT,
    file_url      JSONB        NOT NULL DEFAULT '[]'::jsonb,
    -- array of { id, file_name, file_url, uploaded_by }
    -- admin uploads on create; employee uploads on completion
    status        VARCHAR(20)  NOT NULL DEFAULT 'Not Started',
    -- values: 'Not Started', 'Completed', 'Not Completed', 'Cancelled'
    -- shared across all assignees — whoever updates it sets it for everyone
    remarks       TEXT,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_checklist_items_checklist ON tbl_checklist_items(checklist_id);

-- ─────────────────────────────────────────────────────────────────────────────

-- 4. SCHEDULED INSTANCES  (pg_cron generates one row per day/week/month)
CREATE TABLE tbl_checklist_instances (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    checklist_id    UUID        NOT NULL REFERENCES tbl_checklists(id) ON DELETE CASCADE,
    zodu_id         VARCHAR(50) NOT NULL,
    branch_id       VARCHAR(50) NOT NULL,
    scheduled_date  DATE        NOT NULL,
    status          VARCHAR(30) NOT NULL DEFAULT 'Not Started',
    -- values: 'Not Started', 'In Progress', 'Completed', 'Overdue'
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_checklist_instance UNIQUE (checklist_id, scheduled_date)
);

CREATE INDEX idx_instances_checklist      ON tbl_checklist_instances(checklist_id);
CREATE INDEX idx_instances_scheduled_date ON tbl_checklist_instances(scheduled_date);
CREATE INDEX idx_instances_zodu_branch    ON tbl_checklist_instances(zodu_id, branch_id);
CREATE INDEX idx_instances_status         ON tbl_checklist_instances(status);

-- ─────────────────────────────────────────────────────────────────────────────

-- 5. PER-EMPLOYEE ITEM COMPLETION  (tracks "5/8" progress per instance)
CREATE TABLE tbl_checklist_item_progress (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id   UUID        NOT NULL REFERENCES tbl_checklist_instances(id) ON DELETE CASCADE,
    item_id       UUID        NOT NULL REFERENCES tbl_checklist_items(id) ON DELETE CASCADE,
    employee_id   UUID        NOT NULL,
    is_completed  BOOLEAN     NOT NULL DEFAULT FALSE,
    status        VARCHAR(20) NOT NULL DEFAULT 'Not Started',
    -- values: 'Not Started', 'Completed', 'Not Completed', 'Cancelled'
    remarks       TEXT,
    completed_at  TIMESTAMPTZ,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_instance_item_employee UNIQUE (instance_id, item_id, employee_id)
);

CREATE INDEX idx_item_progress_instance ON tbl_checklist_item_progress(instance_id);
CREATE INDEX idx_item_progress_employee ON tbl_checklist_item_progress(employee_id);
CREATE INDEX idx_item_progress_item     ON tbl_checklist_item_progress(item_id);

-- ─────────────────────────────────────────────────────────────────────────────

-- 6. ATTACHMENTS  (uploaded at task creation time only — max 5 files)
-- file_url is a JSONB array: [{ id, file_name, file_url, uploaded_by, uploaded_by_name }]
-- One row PER CHECKLIST — file_url is a JSONB array, new uploads append to it.
CREATE TABLE tbl_checklist_attachments (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    checklist_id     UUID        NOT NULL REFERENCES tbl_checklists(id) ON DELETE CASCADE,
    file_url         JSONB       NOT NULL DEFAULT '[]'::jsonb,
    -- array of { id, file_name, file_url, uploaded_by, uploaded_by_name }
    uploaded_by      UUID        NOT NULL,
    uploaded_by_name VARCHAR(100) NOT NULL,
    uploaded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_attachments_checklist UNIQUE (checklist_id)
);

CREATE INDEX idx_attachments_checklist ON tbl_checklist_attachments(checklist_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- pg_cron JOBS  (run once after extension is installed on the DB)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Job 1: Generate instances every day at 00:01 AM
SELECT cron.schedule(
    'generate-checklist-instances',
    '1 0 * * *',
    $$
    INSERT INTO tbl_checklist_instances (checklist_id, zodu_id, branch_id, scheduled_date, status)
    SELECT
        c.id,
        c.zodu_id,
        c.branch_id,
        CURRENT_DATE,
        'Not Started'
    FROM tbl_checklists c
    WHERE c.is_recurring = TRUE
      AND c.recur_start_date <= CURRENT_DATE
      AND (c.recur_ends = 'Never' OR c.recur_end_date >= CURRENT_DATE)
      AND (
            (c.recur_frequency = 'Daily'
             AND MOD(CURRENT_DATE - c.recur_start_date, c.recur_every) = 0)
        OR
            (c.recur_frequency = 'Weekly'
             AND EXTRACT(DOW FROM CURRENT_DATE) = EXTRACT(DOW FROM c.recur_start_date)
             AND MOD((CURRENT_DATE - c.recur_start_date) / 7, c.recur_every) = 0)
        OR
            (c.recur_frequency = 'Monthly'
             AND EXTRACT(DAY FROM CURRENT_DATE) = EXTRACT(DAY FROM c.recur_start_date)
             AND MOD(
                   (EXTRACT(YEAR FROM CURRENT_DATE)::INT * 12 + EXTRACT(MONTH FROM CURRENT_DATE)::INT)
                 - (EXTRACT(YEAR FROM c.recur_start_date)::INT * 12 + EXTRACT(MONTH FROM c.recur_start_date)::INT),
                   c.recur_every) = 0)
        OR
            (c.recur_frequency = 'Yearly'
             AND EXTRACT(DAY FROM CURRENT_DATE)   = EXTRACT(DAY FROM c.recur_start_date)
             AND EXTRACT(MONTH FROM CURRENT_DATE) = EXTRACT(MONTH FROM c.recur_start_date))
          )
    ON CONFLICT (checklist_id, scheduled_date) DO NOTHING;
    $$
);

-- Job 2: Mark overdue instances every day at 00:05 AM
SELECT cron.schedule(
    'mark-overdue-checklist-instances',
    '5 0 * * *',
    $$
    UPDATE tbl_checklist_instances
    SET status = 'Overdue'
    WHERE status = 'Not Started'
      AND scheduled_date < CURRENT_DATE;

    UPDATE tbl_checklist_assignees ca
    SET status = 'Overdue'
    FROM tbl_checklist_instances ci
    WHERE ci.checklist_id = ca.checklist_id
      AND ci.status = 'Overdue'
      AND ca.status = 'Not Started';
    $$
);
