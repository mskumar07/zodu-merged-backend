-- checklist-v2-service · reference files on each task
-- A task can carry up to 5 files (photos, PDF, Word, Excel) that show how to do it.
-- Files are uploaded first (POST /api/checklists/task-files → ckl.task_files, one
-- row per upload, owned by the tenant), then a checklist save lists them on its tasks.
-- checklist_tasks.attachments / run_items.attachments hold a snapshot
--   [{ id, file_id, file_name, content_type }]
-- so tasks (replaced on every edit) and runs (copied from tasks) keep them.
-- Re-runnable.

CREATE TABLE IF NOT EXISTS ckl.task_files (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zodu_id              varchar(50)  NOT NULL,
  branch_id            varchar(50)  NOT NULL,
  file_id              varchar(100) NOT NULL,
  file_name            varchar(255) NOT NULL,
  content_type         varchar(120) NOT NULL,
  size_bytes           integer,
  uploaded_by_user_id  uuid NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_files_tenant ON ckl.task_files (zodu_id, branch_id);

ALTER TABLE ckl.checklist_tasks ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE ckl.run_items       ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Generation copies the task's files onto each run item (V003, plus attachments).
CREATE OR REPLACE FUNCTION ckl.fn_generate_for_schedule(p_checklist_id uuid, p_until timestamptz)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  s             ckl.checklist_schedules;
  c             ckl.checklists;
  v_today_start timestamptz;
  v_day         date;
  v_last        date;
  v_t           time;
  v_slot        timestamptz;
  v_available   timestamptz;
  v_seq         integer;
  v_total       smallint;
  v_cat         text;
  v_freq        text;
  v_n           integer;
  v_inserted    integer := 0;
  v_exhausted   boolean := false;
BEGIN
  SELECT * INTO s FROM ckl.checklist_schedules WHERE checklist_id = p_checklist_id FOR UPDATE SKIP LOCKED;
  IF NOT FOUND OR s.is_exhausted THEN RETURN 0; END IF;
  IF s.generated_until IS NOT NULL AND s.generated_until >= p_until THEN RETURN 0; END IF;

  SELECT * INTO c FROM ckl.checklists WHERE id = p_checklist_id;
  IF NOT FOUND OR c.status <> 'ACTIVE' OR c.deleted_at IS NOT NULL THEN RETURN 0; END IF;

  IF NOT EXISTS (SELECT 1 FROM ckl.directory_sync_state d
                 WHERE d.zodu_id = c.zodu_id AND d.branch_id = c.branch_id AND d.last_success_at IS NOT NULL) THEN
    RETURN 0;                                   -- retried on the next tick
  END IF;

  v_today_start := ((now() AT TIME ZONE c.timezone)::date)::timestamp AT TIME ZONE c.timezone;
  v_day  := GREATEST(COALESCE((s.generated_until AT TIME ZONE c.timezone)::date, s.start_date), s.start_date);
  v_last := (p_until AT TIME ZONE c.timezone)::date;
  v_seq  := s.occurrences_generated;
  SELECT count(*) INTO v_total FROM ckl.checklist_tasks WHERE checklist_id = c.id;
  SELECT name INTO v_cat FROM ckl.categories WHERE id = c.category_id;
  v_freq := CASE WHEN s.task_type = 'ONCE' THEN 'ONE_TIME' ELSE s.frequency END;

  <<days>>
  WHILE v_day <= v_last LOOP
    IF (s.task_type = 'ONCE' AND v_day > s.start_date) OR (s.ends = 'ON_DATE' AND v_day > s.end_date) THEN
      v_exhausted := true;
      EXIT days;
    END IF;

    IF ckl.fn_pattern_on(s, v_day) THEN
      FOR v_t IN SELECT t FROM ckl.fn_slot_times(s) AS t ORDER BY t LOOP
        v_slot := (v_day + v_t) AT TIME ZONE c.timezone;
        CONTINUE WHEN s.generated_until IS NOT NULL AND v_slot <= s.generated_until;
        EXIT days WHEN v_slot > p_until;

        IF NOT EXISTS (SELECT 1 FROM ckl.runs WHERE checklist_id = c.id AND slot_at = v_slot) THEN
          IF s.ends = 'AFTER' AND v_seq >= s.max_occurrences THEN
            v_exhausted := true;
            EXIT days;
          END IF;
          v_seq := v_seq + 1;
        END IF;

        CONTINUE WHEN v_slot < v_today_start;   -- counted, never materialised in the past

        v_available := CASE WHEN s.task_type = 'RECURRING' AND s.frequency = 'HOURLY'
                            THEN v_slot - make_interval(hours => s.every_n)
                            ELSE v_day::timestamp AT TIME ZONE c.timezone END;

        -- ALL: one shared run (assignee NULL) any active employee can work on, as long as
        -- the branch has one. SPECIFIC: one run per active assignee. A slot that already
        -- holds runs of the other kind (the mode changed after someone started) gets none.
        WITH a AS (
          SELECT NULL::uuid AS employee_id, 'All employees'::varchar AS employee_name
          WHERE c.assign_mode = 'ALL'
            AND EXISTS (SELECT 1 FROM ckl.employee_directory d
                         WHERE d.zodu_id = c.zodu_id AND d.branch_id = c.branch_id AND d.is_active)
          UNION ALL
          SELECT d.employee_id, d.employee_name
          FROM ckl.employee_directory d
          WHERE c.assign_mode = 'SPECIFIC'
            AND d.zodu_id = c.zodu_id AND d.branch_id = c.branch_id AND d.is_active
            AND EXISTS (SELECT 1 FROM ckl.checklist_assignees ca
                        WHERE ca.checklist_id = c.id AND ca.employee_id = d.employee_id)
        ), r AS (
          INSERT INTO ckl.runs (zodu_id, branch_id, checklist_id, slot_at, run_date, sequence_no,
                                assignee_employee_id, assignee_name, title, description,
                                category_id, category_name, priority, frequency,
                                reviewer_employee_id, requires_review, allow_partial,
                                available_at, due_at, total_items)
          SELECT c.zodu_id, c.branch_id, c.id, v_slot, v_day, v_seq,
                 a.employee_id, a.employee_name, c.name, c.description,
                 c.category_id, v_cat, c.priority, v_freq,
                 c.reviewer_employee_id, c.reviewer_employee_id IS NOT NULL, c.allow_partial,
                 v_available, v_slot, v_total
          FROM a
          WHERE NOT EXISTS (SELECT 1 FROM ckl.runs x
                             WHERE x.checklist_id = c.id AND x.slot_at = v_slot
                               AND (a.employee_id IS NULL OR x.assignee_employee_id IS NULL))
          ON CONFLICT (checklist_id, slot_at, assignee_employee_id) DO NOTHING
          RETURNING id
        ), i AS (
          INSERT INTO ckl.run_items (run_id, position, title, instructions, require_photo, allow_notes, attachments)
          SELECT r.id, tk.position, tk.title, tk.instructions,
                 tk.require_photo AND c.require_photo, tk.allow_notes AND c.allow_notes, tk.attachments
          FROM r CROSS JOIN ckl.checklist_tasks tk
          WHERE tk.checklist_id = c.id
        )
        SELECT count(*) INTO v_n FROM r;
        v_inserted := v_inserted + v_n;
      END LOOP;
    END IF;
    v_day := v_day + 1;
  END LOOP days;

  IF s.ends = 'AFTER' AND v_seq >= s.max_occurrences THEN v_exhausted := true; END IF;

  UPDATE ckl.checklist_schedules
     SET generated_until       = GREATEST(COALESCE(generated_until, p_until), p_until),
         occurrences_generated = v_seq,
         is_exhausted          = v_exhausted,
         updated_at            = now()
   WHERE checklist_id = c.id;

  RETURN v_inserted;
END $$;


-- Branch / company purge: also the uploaded task files.
CREATE OR REPLACE FUNCTION ckl.fn_purge_branch(p_zodu_id text, p_branch_id text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_runs integer; v_checklists integer; v_directory integer; v_notifications integer;
BEGIN
  DELETE FROM ckl.runs WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
  GET DIAGNOSTICS v_runs = ROW_COUNT;
  DELETE FROM ckl.checklists WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
  GET DIAGNOSTICS v_checklists = ROW_COUNT;
  DELETE FROM ckl.employee_directory WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
  GET DIAGNOSTICS v_directory = ROW_COUNT;
  DELETE FROM ckl.directory_sync_state WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
  DELETE FROM ckl.checklist_code_counters WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
  DELETE FROM ckl.notifications WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
  GET DIAGNOSTICS v_notifications = ROW_COUNT;
  DELETE FROM ckl.task_files WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
  RETURN jsonb_build_object('runs', v_runs, 'checklists', v_checklists,
                            'directory', v_directory, 'notifications', v_notifications);
END $$;

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
  DELETE FROM ckl.task_files WHERE zodu_id = p_zodu_id;
  DELETE FROM ckl.company_settings WHERE zodu_id = p_zodu_id;
  RETURN jsonb_build_object('runs', v_runs, 'checklists', v_checklists,
                            'directory', v_directory, 'notifications', v_notifications);
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ckl_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ckl.task_files TO ckl_app;
  END IF;
END $$;
