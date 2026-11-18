-- checklist-v2-service · one shared run per slot for "Assign To All" checklists
-- A checklist assigned to All used to get one run per active employee per slot.
-- Now it gets ONE run per slot with assignee_employee_id NULL: any active
-- employee of the branch can work on it, and ticking an item ticks it for all.
-- SPECIFIC checklists still get one run per assignee. Re-runnable.

-- NULL assignee = the whole branch (assign_mode ALL); assignee_name 'All employees'.
ALTER TABLE ckl.runs ALTER COLUMN assignee_employee_id DROP NOT NULL;

-- Who handed the run in (completed it, or submitted it for review). On a shared
-- run this is the person notifications name and the approve / reject goes to.
ALTER TABLE ckl.runs ADD COLUMN IF NOT EXISTS submitted_by_employee_id uuid;
ALTER TABLE ckl.runs ADD COLUMN IF NOT EXISTS submitted_by_name        varchar(100);

-- One shared run per slot: NULLs must collide in the unique key.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class x ON x.oid = i.indexrelid
                  WHERE x.relname = 'uq_run_slot' AND i.indnullsnotdistinct) THEN
    ALTER TABLE ckl.runs DROP CONSTRAINT IF EXISTS uq_run_slot;
    ALTER TABLE ckl.runs ADD CONSTRAINT uq_run_slot
      UNIQUE NULLS NOT DISTINCT (checklist_id, slot_at, assignee_employee_id);
  END IF;
END $$;

-- Existing per-employee runs of ALL checklists: a slot nobody has touched yet
-- (every run TODO, nothing ticked, no events) becomes one shared run. Slots
-- someone already worked on keep their per-employee runs as history.
-- The run trigger is off meanwhile: this is not a reassignment, nobody is notified.
-- One transaction, so a failure can't leave the trigger disabled.
BEGIN;
CREATE TEMP TABLE v008_slots ON COMMIT DROP AS
  SELECT r.checklist_id, r.slot_at, (array_agg(r.id ORDER BY r.id))[1] AS keep_id
    FROM ckl.runs r JOIN ckl.checklists c ON c.id = r.checklist_id
   WHERE c.assign_mode = 'ALL' AND r.assignee_employee_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM ckl.runs s WHERE s.checklist_id = r.checklist_id
                        AND s.slot_at = r.slot_at AND s.assignee_employee_id IS NULL)
   GROUP BY r.checklist_id, r.slot_at
  HAVING bool_and(r.status = 'TODO' AND r.done_items = 0
                  AND NOT EXISTS (SELECT 1 FROM ckl.run_events e WHERE e.run_id = r.id));

ALTER TABLE ckl.runs DISABLE TRIGGER trg_runs_after_update;

DELETE FROM ckl.runs r USING v008_slots s
 WHERE r.checklist_id = s.checklist_id AND r.slot_at = s.slot_at AND r.id <> s.keep_id;

UPDATE ckl.runs r
   SET assignee_employee_id = NULL, assignee_name = 'All employees'
  FROM v008_slots s
 WHERE r.id = s.keep_id;

ALTER TABLE ckl.runs ENABLE TRIGGER trg_runs_after_update;
COMMIT;
