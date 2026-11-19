-- Leave → Leave Policy (Console / Attendance app): tbl_leave_policies, a branch's leave policies.
--
-- What the Add / Edit Policy form saves:
--   name, description, is_active                    Policy Details (the Active toggle is is_active)
--   applicable_to / department_ids                  'ALL' (All Employees) or 'DEPARTMENTS' (Selected Departments).
--                                                   Same convention as holidays and leave types: there is no
--                                                   departments table yet, so the ids are kept as sent, not enforced
--   annual_entitlement + leave_year_start_month     "Apply leave entitlement annually" and its Leave Year
--                                                   (1 = Jan - Dec, 4 = Apr - Mar ...)
--   carry_forward + carry_forward_max_days          "Allow carry forward" and its Maximum Carry Forward Days
--   encashment + encashment_limit_days              "Allow leave encashment" and its Encashment Limit
--
-- These are settings only for now: the leave balance does not read them yet (it still uses each leave
-- type's annual_days).
--
-- Delete removes the policy from the list (deleted_at); the row is kept, so a name can be reused afterwards.
-- No policy is created for a branch automatically: the first one is whatever the admin adds.
--
-- Concurrency, enforced by the database and not only by the API:
--   version                         every save adds 1, and an edit only succeeds if the version it loaded is still
--                                   the current one, so two admins editing one policy can't overwrite each other
--   uq_leave_policies_branch_name   two policies of a branch can't share a name (any letter case), even when two
--                                   admins save at the same moment
--   uq_leave_policies_one_default   a branch has at most one ACTIVE policy for All Employees (the form's note: it
--                                   applies to everyone unless another specific policy is assigned)
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS tbl_leave_policies (
    policy_id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    zodu_id                 VARCHAR(50)   NOT NULL,
    branch_id               VARCHAR(50)   NOT NULL,

    name                    VARCHAR(100)  NOT NULL,
    description             VARCHAR(200),
    is_active               BOOLEAN       NOT NULL DEFAULT TRUE,
    applicable_to           VARCHAR(12)   NOT NULL DEFAULT 'ALL',
    department_ids          TEXT[]        NOT NULL DEFAULT '{}',

    annual_entitlement      BOOLEAN       NOT NULL DEFAULT TRUE,
    leave_year_start_month  SMALLINT      NOT NULL DEFAULT 1,
    carry_forward           BOOLEAN       NOT NULL DEFAULT FALSE,
    carry_forward_max_days  NUMERIC(4,1)  NOT NULL DEFAULT 0,
    encashment              BOOLEAN       NOT NULL DEFAULT FALSE,
    encashment_limit_days   NUMERIC(4,1)  NOT NULL DEFAULT 0,

    version                 INTEGER       NOT NULL DEFAULT 1,
    created_by              UUID,
    created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    deleted_at              TIMESTAMPTZ,

    -- The database refuses combinations the form can't produce, so no client can store them.
    CONSTRAINT chk_leave_policies_year_month   CHECK (leave_year_start_month BETWEEN 1 AND 12),
    CONSTRAINT chk_leave_policies_carry_forward
        CHECK (carry_forward_max_days >= 0 AND (carry_forward OR carry_forward_max_days = 0)),
    CONSTRAINT chk_leave_policies_encashment
        CHECK (encashment_limit_days >= 0 AND (encashment OR encashment_limit_days = 0)),
    CONSTRAINT chk_leave_policies_applicable
        CHECK (
            (applicable_to = 'ALL'         AND cardinality(department_ids) = 0) OR
            (applicable_to = 'DEPARTMENTS' AND cardinality(department_ids) > 0)
        )
);

-- The list: a branch's live policies, newest first. Every query leads with (zodu_id, branch_id).
CREATE INDEX IF NOT EXISTS idx_leave_policies_branch_created
    ON tbl_leave_policies (zodu_id, branch_id, created_at DESC, policy_id DESC)
    WHERE deleted_at IS NULL;

-- One live policy per name (any letter case) in a branch.
CREATE UNIQUE INDEX IF NOT EXISTS uq_leave_policies_branch_name
    ON tbl_leave_policies (zodu_id, branch_id, lower(name))
    WHERE deleted_at IS NULL;

-- At most one active "All Employees" policy per branch.
CREATE UNIQUE INDEX IF NOT EXISTS uq_leave_policies_one_default
    ON tbl_leave_policies (zodu_id, branch_id)
    WHERE applicable_to = 'ALL' AND is_active AND deleted_at IS NULL;
