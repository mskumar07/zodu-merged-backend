-- checklist-v2-service · task sub-statuses replace "Can't do"
-- Each company keeps its own list of sub-statuses (Settings → Checklist settings),
-- e.g. "Waiting for stock", "On hold", "Not applicable". Whoever works on a task
-- can give it one. A status either closes the task (it counts towards completing
-- the checklist, as "Can't do" did) or is only a label (the task still has to be
-- ticked done).
--
-- On a task the status is a snapshot (name, colour, closes), like a run's category:
-- deleting or changing the list later doesn't rewrite tasks already marked
-- (a rename does update the name, see the service).
-- A closing status keeps using is_skipped (and skip_reason = its name), so the
-- run counts (done_items = done or closed, skipped_items = closed by a status) and
-- every check built on them are unchanged.
-- Existing "Can't do" tasks become a closing "Can't do" status. Re-runnable.

CREATE TABLE IF NOT EXISTS ckl.task_statuses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zodu_id      varchar(50) NOT NULL,
  name         varchar(40) NOT NULL,
  color        varchar(7)  NOT NULL DEFAULT '#2563EB' CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  closes_task  boolean     NOT NULL DEFAULT false,
  sort_order   integer     NOT NULL DEFAULT 100,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_statuses_name ON ckl.task_statuses (zodu_id, lower(name));

DROP TRIGGER IF EXISTS trg_task_statuses_touch ON ckl.task_statuses;
CREATE TRIGGER trg_task_statuses_touch BEFORE UPDATE ON ckl.task_statuses
  FOR EACH ROW EXECUTE FUNCTION ckl.trg_touch_updated_at();

ALTER TABLE ckl.run_items
  ADD COLUMN IF NOT EXISTS sub_status_id             uuid,
  ADD COLUMN IF NOT EXISTS sub_status_name           varchar(40),
  ADD COLUMN IF NOT EXISTS sub_status_color          varchar(7),
  ADD COLUMN IF NOT EXISTS sub_status_closes         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sub_status_at             timestamptz,
  ADD COLUMN IF NOT EXISTS sub_status_by_employee_id uuid;

-- "Can't do" tasks → a closing status of that name (the reason stays in skip_reason).
UPDATE ckl.run_items
   SET sub_status_name = 'Can''t do', sub_status_color = '#B45309', sub_status_closes = true,
       sub_status_at = skipped_at, sub_status_by_employee_id = skipped_by_employee_id
 WHERE is_skipped AND sub_status_name IS NULL;

-- Closed by a status ⇔ is_skipped; a status always has a name.
ALTER TABLE ckl.run_items DROP CONSTRAINT IF EXISTS ck_run_item_sub_status;
ALTER TABLE ckl.run_items ADD CONSTRAINT ck_run_item_sub_status
  CHECK (is_skipped = (sub_status_name IS NOT NULL AND sub_status_closes));

COMMENT ON COLUMN ckl.runs.done_items IS 'Closed tasks: done, or given a sub-status that closes it';
COMMENT ON COLUMN ckl.runs.skipped_items IS 'Tasks closed by a sub-status (included in done_items)';
COMMENT ON COLUMN ckl.runs.allow_partial IS 'Tasks may be closed by a sub-status instead of being done';

-- Company purge: also its sub-statuses and checklist settings.
CREATE OR REPLACE FUNCTION ckl.fn_purge_company(p_zodu_id text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_runs integer; v_checklists integer; v_directory integer; v_notifications integer;
BEGIN
  DELETE FROM ckl.runs WHERE zodu_id = p_zodu_id;
  GET DIAGNOSTICS v_runs = ROW_COUNT;
  DELETE FROM ckl.checklists WHERE zodu_id = p_zodu_id;
  GET DIAGNOSTICS v_checklists = ROW_COUNT;
  DELETE FROM ckl.employee_directory WHERE zodu_id = p_zodu_id;
  GET DIAGNOSTICS v_directory = ROW_COUNT;
  DELETE FROM ckl.directory_sync_state WHERE zodu_id = p_zodu_id;
  DELETE FROM ckl.checklist_code_counters WHERE zodu_id = p_zodu_id;
  DELETE FROM ckl.notifications WHERE zodu_id = p_zodu_id;
  GET DIAGNOSTICS v_notifications = ROW_COUNT;
  DELETE FROM ckl.notification_preferences WHERE zodu_id = p_zodu_id;
  DELETE FROM ckl.notification_settings WHERE zodu_id = p_zodu_id;
  DELETE FROM ckl.push_subscriptions WHERE zodu_id = p_zodu_id;
  DELETE FROM ckl.categories WHERE zodu_id = p_zodu_id;
  DELETE FROM ckl.task_statuses WHERE zodu_id = p_zodu_id;
  DELETE FROM ckl.company_settings WHERE zodu_id = p_zodu_id;
  RETURN jsonb_build_object('runs', v_runs, 'checklists', v_checklists,
                            'directory', v_directory, 'notifications', v_notifications);
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ckl_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ckl.task_statuses TO ckl_app;
  END IF;
END $$;
