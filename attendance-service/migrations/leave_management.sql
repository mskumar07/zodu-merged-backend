-- Leave management: leave types, leave requests and holidays, per branch.
--
--   tbl_leave_types     the leave types a branch offers and their yearly days (CL / SL / PL / EL)
--   tbl_leave_requests  one row per application: apply -> Pending -> Approved / Rejected / Cancelled
--   tbl_holidays        a branch's holidays (loaded from an Excel sheet). Holidays and Sundays are not
--                       counted as leave days
--
-- There is no balance table: availed / pending days are added up from tbl_leave_requests, so a
-- balance can never drift from the requests it is made of.
--
-- Approved leave is written to tbl_attendance as 'On Leave' rows (tbl_attendance.leave_request_id
-- remembers which leave they came from), so every attendance screen and count already includes it.
--
-- Every branch gets the default leave types automatically (trigger below). A new company or branch
-- always starts with its first employee (the Admin row auth-service seeds), so inserting an employee
-- for a (zodu_id, branch_id) that has no leave types yet creates them. Existing branches are
-- back-filled at the end of this file.
--
-- Needs the btree_gist extension (an exclusion constraint on "employee = AND dates overlap").
-- Idempotent: safe to re-run.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── 1. Leave types (per branch) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tbl_leave_types (
    leave_type_id  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    zodu_id        VARCHAR(50)   NOT NULL,
    branch_id      VARCHAR(50)   NOT NULL,
    code           VARCHAR(10)   NOT NULL,                       -- CL, SL, PL, EL
    name           VARCHAR(60)   NOT NULL,                       -- Casual Leave ...
    annual_days    NUMERIC(4,1)  NOT NULL DEFAULT 0 CHECK (annual_days >= 0),
    is_active      BOOLEAN       NOT NULL DEFAULT TRUE,          -- a type in use is switched off, never deleted
    sort_order     SMALLINT      NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_leave_types_branch_code UNIQUE (zodu_id, branch_id, code)
);

-- ── 2. Holidays (per branch) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tbl_holidays (
    holiday_id     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    zodu_id        VARCHAR(50)   NOT NULL,
    branch_id      VARCHAR(50)   NOT NULL,
    holiday_date   DATE          NOT NULL,
    name           VARCHAR(100)  NOT NULL,
    holiday_type   VARCHAR(20)   NOT NULL
                   CHECK (holiday_type IN ('Gazetted Holiday', 'Company Holiday')),
    created_by     UUID,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_holidays_branch_date UNIQUE (zodu_id, branch_id, holiday_date)
);

-- ── 3. Leave requests ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tbl_leave_requests (
    leave_request_id    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    zodu_id             VARCHAR(50)   NOT NULL,
    branch_id           VARCHAR(50)   NOT NULL,
    employee_id         UUID          NOT NULL REFERENCES tbl_employees(employee_id) ON DELETE CASCADE,
    leave_type_id       UUID          NOT NULL REFERENCES tbl_leave_types(leave_type_id),
    from_date           DATE          NOT NULL,
    to_date             DATE          NOT NULL,
    -- Working days (Sundays and holidays left out), worked out by the server when the request is made
    -- and kept as it was then, so adding a holiday later doesn't change a past request.
    days                NUMERIC(4,1)  NOT NULL CHECK (days > 0),
    reason              VARCHAR(200)  NOT NULL,
    attachment_file_id  VARCHAR(100),                            -- file-service id (optional attachment)
    status              VARCHAR(15)   NOT NULL DEFAULT 'Pending'
                        CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Cancelled')),
    applied_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    decided_by          UUID,                                    -- the approver's employee_id (or user id)
    decided_by_name     VARCHAR(100),
    decided_at          TIMESTAMPTZ,
    decision_note       VARCHAR(200),
    cancelled_at        TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_leave_dates CHECK (from_date <= to_date),
    -- One employee can't hold two live (Pending / Approved) requests that share a day. The database
    -- enforces it, so two taps or two devices can't both get in.
    CONSTRAINT ex_leave_no_overlap EXCLUDE USING gist (
        employee_id WITH =,
        daterange(from_date, to_date, '[]') WITH &&
    ) WHERE (status IN ('Pending', 'Approved'))
);

-- Pending list (by branch + status, soonest first) / "All Leaves" (latest applied) / "My Leaves".
CREATE INDEX IF NOT EXISTS idx_leave_requests_branch_status
    ON tbl_leave_requests (zodu_id, branch_id, status, from_date);
CREATE INDEX IF NOT EXISTS idx_leave_requests_branch_applied
    ON tbl_leave_requests (zodu_id, branch_id, applied_at DESC);
CREATE INDEX IF NOT EXISTS idx_leave_requests_employee
    ON tbl_leave_requests (employee_id, from_date DESC);

-- ── 4. Attendance rows that came from an approved leave ──────────────────────
ALTER TABLE tbl_attendance
    ADD COLUMN IF NOT EXISTS leave_request_id UUID REFERENCES tbl_leave_requests(leave_request_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_leave_request
    ON tbl_attendance (leave_request_id) WHERE leave_request_id IS NOT NULL;

-- ── 5. Default leave types for a branch ──────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_seed_default_leave_types(p_zodu_id VARCHAR, p_branch_id VARCHAR)
RETURNS VOID AS $$
    INSERT INTO tbl_leave_types (zodu_id, branch_id, code, name, annual_days, sort_order)
    VALUES (p_zodu_id, p_branch_id, 'CL', 'Casual Leave',    12, 1),
           (p_zodu_id, p_branch_id, 'SL', 'Sick Leave',      12, 2),
           (p_zodu_id, p_branch_id, 'PL', 'Privilege Leave', 24, 3),
           (p_zodu_id, p_branch_id, 'EL', 'Earned Leave',    18, 4)
    ON CONFLICT (zodu_id, branch_id, code) DO NOTHING;
$$ LANGUAGE sql;

-- The first employee of a new company / branch (its Admin) creates that branch's leave types. For
-- every later employee this is a single index lookup that finds them and does nothing.
CREATE OR REPLACE FUNCTION fn_employees_seed_leave_types()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM tbl_leave_types WHERE zodu_id = NEW.zodu_id AND branch_id = NEW.branch_id) THEN
        PERFORM fn_seed_default_leave_types(NEW.zodu_id, NEW.branch_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_employees_seed_leave_types ON tbl_employees;
CREATE TRIGGER trg_employees_seed_leave_types
    AFTER INSERT ON tbl_employees
    FOR EACH ROW EXECUTE FUNCTION fn_employees_seed_leave_types();

-- ── 6. Existing companies / branches ─────────────────────────────────────────
INSERT INTO tbl_leave_types (zodu_id, branch_id, code, name, annual_days, sort_order)
SELECT b.zodu_id, b.branch_id, d.code, d.name, d.annual_days, d.sort_order
FROM (SELECT DISTINCT zodu_id, branch_id FROM tbl_employees) b
CROSS JOIN (VALUES
    ('CL', 'Casual Leave',    12, 1),
    ('SL', 'Sick Leave',      12, 2),
    ('PL', 'Privilege Leave', 24, 3),
    ('EL', 'Earned Leave',    18, 4)
) AS d(code, name, annual_days, sort_order)
ON CONFLICT (zodu_id, branch_id, code) DO NOTHING;
