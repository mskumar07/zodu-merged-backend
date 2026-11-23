-- Shift Allocation Engine → Schedule Shifts (Console): who works which shift on which day, the grid of
-- employees x dates ("Rahul Menon, Mon Nov 23 = N").
--
-- One row per employee per day (the roster itself, not a rule that is worked out on the fly), so attendance, payroll
-- and history read what was really scheduled, and editing a rotation later never rewrites the past.
--
--   employee_id        the employee in employee-service (no foreign key: employees live in another database)
--   work_date          the calendar day (DATE, India time)
--   shift_template_id  the shift worked that day; NULL = OFF / rest day. No row at all = nothing scheduled yet
--   source             MANUAL (Assign Shifts) now; ROTATION (Auto Schedule) and COPY (Copy Schedule) are for later
--   rotation_id        the rotation that produced the row (Auto Schedule, later); NULL otherwise
--   version            every change adds 1. Assign Shifts sends the version it loaded for each cell; a cell changed
--                      by someone else in between is refused (409), so two admins never overwrite each other
--
-- The primary key (zodu_id, branch_id, employee_id, work_date) is also the index of every query: the weekly grid
-- ("these employees, these dates") is a range scan on it, and Assign Shifts upserts on it.
-- A shift template that has assignments can't be removed (RESTRICT); switching it off is fine.
-- Idempotent: safe to re-run. Needs shift_templates.sql and shift_rotations.sql first.

CREATE TABLE IF NOT EXISTS tbl_shift_assignments (
    zodu_id           VARCHAR(50)  NOT NULL,
    branch_id         VARCHAR(50)  NOT NULL,
    employee_id       UUID         NOT NULL,
    work_date         DATE         NOT NULL,
    shift_template_id UUID                  REFERENCES tbl_shift_templates (shift_template_id) ON DELETE RESTRICT,
    source            VARCHAR(10)  NOT NULL DEFAULT 'MANUAL',
    rotation_id       UUID                  REFERENCES tbl_shift_rotations (rotation_id) ON DELETE SET NULL,
    version           INTEGER      NOT NULL DEFAULT 1,
    updated_by        VARCHAR(64),
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    PRIMARY KEY (zodu_id, branch_id, employee_id, work_date),
    CONSTRAINT chk_shift_assignments_source CHECK (source IN ('MANUAL', 'ROTATION', 'COPY'))
);

-- "Who is on this shift?" and the shift template's side of the foreign key.
CREATE INDEX IF NOT EXISTS idx_shift_assignments_template
    ON tbl_shift_assignments (shift_template_id)
    WHERE shift_template_id IS NOT NULL;
