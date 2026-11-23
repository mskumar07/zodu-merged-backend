-- Shift Allocation Engine → Shift Rotation (Console): a repeating pattern of shifts, e.g. "Support Rotation: M M M E E OFF OFF".
--
-- Two tables: tbl_shift_rotations (one row per rotation: what the Add / Edit Rotation form's left side saves) and
-- tbl_shift_rotation_days (one row per day of the cycle: the Day 1 … Day N chips on the right).
--
-- tbl_shift_rotations
--   rotation_type       'FIXED_CYCLE' (Rotational) or 'CUSTOM' (Custom Pattern: the admin types any cycle length)
--   cycle_length        number of days in the pattern (7, 14, 10, 30 …). Days beyond 7 show as Week 2, Week 3 …
--   effective_from      the date the rotation starts applying (a DATE; the screen shows it as DD-MM-YYYY).
--                       The API only accepts today or later
--   applicable_to / department_ids
--                       'ALL' (All Employees) or 'DEPARTMENTS'. Same convention as leave policies and shift templates:
--                       there is no departments table yet, so only ALL is accepted for now; the columns are ready
--   is_active           the Active toggle. "Delete" switches it off; nothing is removed (a name stays taken)
--   version             every save adds 1; an edit only succeeds if the version it loaded is still current, so two
--                       admins editing one rotation can't overwrite each other
--
-- tbl_shift_rotation_days
--   day_no              1 … cycle_length
--   shift_template_id   the shift worked that day; NULL = OFF / rest day. A template that is switched off stays here
--                       (the screen warns on the rotation); a template that is referenced can't be removed (RESTRICT)
--
-- The list shows newest first (created_at), so there is no sort_order column.
-- Concurrency is enforced by the database and not only by the API: uq_shift_rotations_branch_name (two admins saving
-- the same name at once) and the version check above.
-- Idempotent: safe to re-run. Needs shift_templates.sql first.

CREATE TABLE IF NOT EXISTS tbl_shift_rotations (
    rotation_id     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    zodu_id         VARCHAR(50)  NOT NULL,
    branch_id       VARCHAR(50)  NOT NULL,

    name            VARCHAR(100) NOT NULL,
    description     VARCHAR(255) NOT NULL DEFAULT '',
    rotation_type   VARCHAR(12)  NOT NULL DEFAULT 'FIXED_CYCLE',
    cycle_length    SMALLINT     NOT NULL,
    applicable_to   VARCHAR(12)  NOT NULL DEFAULT 'ALL',
    department_ids  TEXT[]       NOT NULL DEFAULT '{}',
    effective_from  DATE         NOT NULL,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,

    version         INTEGER      NOT NULL DEFAULT 1,
    created_by      VARCHAR(64),
    updated_by      VARCHAR(64),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_shift_rotations_type       CHECK (rotation_type IN ('FIXED_CYCLE', 'CUSTOM')),
    CONSTRAINT chk_shift_rotations_cycle      CHECK (cycle_length BETWEEN 1 AND 365),
    CONSTRAINT chk_shift_rotations_applicable CHECK (
        (applicable_to = 'ALL'         AND cardinality(department_ids) = 0) OR
        (applicable_to = 'DEPARTMENTS' AND cardinality(department_ids) > 0)
    )
);

-- The list: a branch's rotations, newest first. Every query leads with (zodu_id, branch_id).
CREATE INDEX IF NOT EXISTS idx_shift_rotations_branch_created
    ON tbl_shift_rotations (zodu_id, branch_id, created_at DESC, rotation_id DESC);

-- One rotation per name (any letter case) in a branch.
CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_rotations_branch_name
    ON tbl_shift_rotations (zodu_id, branch_id, lower(name));

CREATE TABLE IF NOT EXISTS tbl_shift_rotation_days (
    rotation_id       UUID     NOT NULL REFERENCES tbl_shift_rotations (rotation_id) ON DELETE CASCADE,
    day_no            SMALLINT NOT NULL,
    shift_template_id UUID              REFERENCES tbl_shift_templates (shift_template_id) ON DELETE RESTRICT,

    PRIMARY KEY (rotation_id, day_no),
    CONSTRAINT chk_shift_rotation_days_day CHECK (day_no BETWEEN 1 AND 365)
);

-- "Which rotations use this shift template?" (the template's side of the foreign key).
CREATE INDEX IF NOT EXISTS idx_shift_rotation_days_template
    ON tbl_shift_rotation_days (shift_template_id)
    WHERE shift_template_id IS NOT NULL;
