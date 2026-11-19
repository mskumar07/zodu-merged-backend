-- A task can be closed without doing it: "Can't do", with a reason
-- (not applicable today, equipment not working, out of stock, ...).
-- A run is complete only when every task is closed: done or can't do.
--
-- runs.done_items now counts CLOSED tasks (done + can't do), so progress,
-- reminders ("2 of 5 left") and the untouched-run checks keep working;
-- runs.skipped_items says how many of those were closed as can't do.
-- runs.allow_partial (and the company setting of the same name) now means
-- "tasks may be marked can't do"; partial submission is gone.

ALTER TABLE ckl.run_items
  ADD COLUMN IF NOT EXISTS is_skipped             boolean      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS skip_reason            varchar(300),
  ADD COLUMN IF NOT EXISTS skipped_at             timestamptz,
  ADD COLUMN IF NOT EXISTS skipped_by_employee_id uuid;

ALTER TABLE ckl.run_items DROP CONSTRAINT IF EXISTS ck_run_item_one_outcome;
ALTER TABLE ckl.run_items ADD CONSTRAINT ck_run_item_one_outcome CHECK (NOT (is_done AND is_skipped));

ALTER TABLE ckl.run_items DROP CONSTRAINT IF EXISTS ck_run_item_skip_reason;
ALTER TABLE ckl.run_items ADD CONSTRAINT ck_run_item_skip_reason CHECK (NOT is_skipped OR skip_reason IS NOT NULL);

ALTER TABLE ckl.runs
  ADD COLUMN IF NOT EXISTS skipped_items smallint NOT NULL DEFAULT 0 CHECK (skipped_items >= 0);

COMMENT ON COLUMN ckl.runs.done_items IS 'Closed tasks: done or can''t do';
COMMENT ON COLUMN ckl.runs.skipped_items IS 'Tasks closed as can''t do (included in done_items)';
COMMENT ON COLUMN ckl.runs.allow_partial IS 'Tasks may be closed as can''t do, with a reason';
