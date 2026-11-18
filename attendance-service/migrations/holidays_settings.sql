-- Leave → Holidays (Console / Attendance app): what the Add / Edit Holiday form needs beyond tbl_holidays today.
--
--   holiday_type    no longer limited to a fixed list: whatever type the caller sends is stored (a holiday type
--                   master is coming, which will own the list). The old CHECK is dropped. Stored rows keep their
--                   values. A holiday is skipped when counting leave days whatever its type.
--   applicable_to   'ALL' (All Employees) or 'DEPARTMENTS' (Selected Departments)
--   department_ids  the selected departments. There is no departments table in this database yet, so the ids
--                   are kept as sent and not enforced: every employee of the branch gets the holiday.
--
-- Existing and imported rows become "All Employees". A branch still has one holiday per date
-- (uq_holidays_branch_date), which is also the index every holiday query uses.
-- Idempotent: safe to re-run.

ALTER TABLE tbl_holidays
    ADD COLUMN IF NOT EXISTS applicable_to  VARCHAR(12) NOT NULL DEFAULT 'ALL',
    ADD COLUMN IF NOT EXISTS department_ids TEXT[]      NOT NULL DEFAULT '{}';

ALTER TABLE tbl_holidays DROP CONSTRAINT IF EXISTS tbl_holidays_holiday_type_check;

ALTER TABLE tbl_holidays DROP CONSTRAINT IF EXISTS chk_holidays_applicable;
ALTER TABLE tbl_holidays ADD CONSTRAINT chk_holidays_applicable
    CHECK (
        (applicable_to = 'ALL'         AND cardinality(department_ids) = 0) OR
        (applicable_to = 'DEPARTMENTS' AND cardinality(department_ids) > 0)
    );
