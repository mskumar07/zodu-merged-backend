-- Shift Allocation Engine → Shift Templates (Console): the templates a branch defines, e.g. "Morning Shift / M / 09:00–17:00".
--
--   code               the short letter(s) shown in the chip (M, E, N, G); unique per branch
--   start_time/end_time  wall-clock times (no date). end <= start means the shift ends the next day, and then
--                      is_cross_day must be TRUE ("Cross Day Shift") — the database refuses any other mix
--   break_start        optional: when the break begins, so the list can show "01:00 PM – 02:00 PM".
--                      The form only asks for the duration, so it may be NULL
--   break_minutes      the break length ("01:00" = 60)
--   working_minutes    (end - start) - break, worked out once on save so the list never calculates anything
--   applicable_to/department_ids  same idea as leave types: stored as sent, not enforced until departments exist
--   ot_eligible        overtime allowed on this shift
--
-- A template is never deleted: "Delete" switches it off (is_active = false), because rosters will point at it.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS tbl_shift_templates (
    shift_template_id UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    zodu_id           VARCHAR(50)  NOT NULL,
    branch_id         VARCHAR(50)  NOT NULL,
    name              VARCHAR(60)  NOT NULL,
    code              VARCHAR(10)  NOT NULL,
    description       VARCHAR(255) NOT NULL DEFAULT '',
    start_time        TIME         NOT NULL,
    end_time          TIME         NOT NULL,
    is_cross_day      BOOLEAN      NOT NULL DEFAULT FALSE,
    break_start       TIME,
    break_minutes     SMALLINT     NOT NULL DEFAULT 0,
    working_minutes   SMALLINT     NOT NULL,
    applicable_to     VARCHAR(12)  NOT NULL DEFAULT 'ALL',
    department_ids    TEXT[]       NOT NULL DEFAULT '{}',
    ot_eligible       BOOLEAN      NOT NULL DEFAULT FALSE,
    is_active         BOOLEAN      NOT NULL DEFAULT TRUE,
    sort_order        INTEGER      NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_shift_cross_day  CHECK ((is_cross_day AND end_time < start_time) OR (NOT is_cross_day AND end_time > start_time)),
    CONSTRAINT chk_shift_break      CHECK (break_minutes >= 0 AND (break_start IS NULL OR break_minutes > 0)),
    CONSTRAINT chk_shift_working    CHECK (working_minutes > 0),
    CONSTRAINT chk_shift_applicable CHECK (
        (applicable_to = 'ALL'         AND cardinality(department_ids) = 0) OR
        (applicable_to = 'DEPARTMENTS' AND cardinality(department_ids) > 0)
    )
);

-- One code and one name per branch. The code index also serves every "this branch's templates" query
-- (they all lead with zodu_id, branch_id).
CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_templates_branch_code
    ON tbl_shift_templates (zodu_id, branch_id, code);
CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_templates_branch_name
    ON tbl_shift_templates (zodu_id, branch_id, lower(name));
