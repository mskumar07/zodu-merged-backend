-- Leave Settings → Leave Types (Console): the rest of what the screen edits, on tbl_leave_types.
--
--   is_paid                 Paid / Unpaid
--   carry_forward           "Allow carry forward", with carry_forward_max_days as its "Maximum Days"
--   encashment              "Allow encashment"
--   applicable_to           'ALL' (All Employees) or 'DEPARTMENTS' (Selected Departments)
--   department_ids          the selected departments. There is no departments table in this database yet,
--                           so the ids are kept as the caller sent them and not enforced: every employee of
--                           the branch still gets the type until departments exist
--   effective_from          the day the type takes effect
--
-- A leave type is never deleted: "Delete" in the screen switches it off (is_active = false). Requests
-- already made keep pointing at it, so history and balances never break, and a new request can only be
-- made against an active type (see insertRequest in leave-repo.js).
--
-- Existing rows get the defaults below: paid, no carry forward, no encashment, all employees,
-- effective from the start of the year (IST).
-- Idempotent: safe to re-run.

ALTER TABLE tbl_leave_types
    ADD COLUMN IF NOT EXISTS is_paid                BOOLEAN       NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS carry_forward          BOOLEAN       NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS carry_forward_max_days NUMERIC(4,1)  NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS encashment             BOOLEAN       NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS applicable_to          VARCHAR(12)   NOT NULL DEFAULT 'ALL',
    ADD COLUMN IF NOT EXISTS department_ids         TEXT[]        NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS effective_from         DATE          NOT NULL DEFAULT (date_trunc('year', now() AT TIME ZONE 'Asia/Kolkata'))::date;

-- The database refuses combinations the screen can't produce, so no client can store them.
ALTER TABLE tbl_leave_types DROP CONSTRAINT IF EXISTS chk_leave_types_carry_forward;
ALTER TABLE tbl_leave_types ADD CONSTRAINT chk_leave_types_carry_forward
    CHECK (carry_forward_max_days >= 0 AND (carry_forward OR carry_forward_max_days = 0));

ALTER TABLE tbl_leave_types DROP CONSTRAINT IF EXISTS chk_leave_types_applicable;
ALTER TABLE tbl_leave_types ADD CONSTRAINT chk_leave_types_applicable
    CHECK (
        (applicable_to = 'ALL'         AND cardinality(department_ids) = 0) OR
        (applicable_to = 'DEPARTMENTS' AND cardinality(department_ids) > 0)
    );
