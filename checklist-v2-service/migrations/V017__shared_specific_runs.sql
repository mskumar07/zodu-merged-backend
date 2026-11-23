-- checklist-v2-service · a checklist given to several people is ONE shared run
-- Before: SPECIFIC checklists got one run per assignee, so "New Inventory" for 7 people
-- was 7 copies of the same 2 tasks. Now several assignees share ONE run per slot: any of
-- them can tick its tasks, and they are done once. Only they see it and can work on it
-- (the pool); "All employees" (pool NULL) is unchanged. One assignee: their own run, as before.
-- Re-runnable.

-- Shared run's pool: who may work on it. NULL = the whole branch (assign_mode ALL).
ALTER TABLE ckl.runs ADD COLUMN IF NOT EXISTS pool_employee_ids uuid[];
CREATE INDEX IF NOT EXISTS idx_runs_pool ON ckl.runs USING gin (pool_employee_ids) WHERE pool_employee_ids IS NOT NULL;

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

        -- ALL: one shared run (assignee NULL, no pool) any active employee can work on, as
        -- long as the branch has one. SPECIFIC with one active assignee: their own run.
        -- SPECIFIC with several: ONE shared run (assignee NULL) that only they (the pool)
        -- can work on; the tasks are done once, by whichever of them gets to it.
        -- A slot that already holds runs of the other kind gets none.
        WITH ppl AS (
          SELECT d.employee_id, d.employee_name
          FROM ckl.employee_directory d
          WHERE c.assign_mode = 'SPECIFIC'
            AND d.zodu_id = c.zodu_id AND d.branch_id = c.branch_id AND d.is_active
            AND EXISTS (SELECT 1 FROM ckl.checklist_assignees ca
                        WHERE ca.checklist_id = c.id AND ca.employee_id = d.employee_id)
        ), a AS (
          SELECT NULL::uuid AS employee_id, 'All employees'::varchar AS employee_name, NULL::uuid[] AS pool
          WHERE c.assign_mode = 'ALL'
            AND EXISTS (SELECT 1 FROM ckl.employee_directory d
                         WHERE d.zodu_id = c.zodu_id AND d.branch_id = c.branch_id AND d.is_active)
          UNION ALL
          SELECT p.employee_id, p.employee_name, NULL::uuid[]
          FROM ppl p WHERE (SELECT count(*) FROM ppl) = 1
          UNION ALL
          SELECT NULL::uuid, (count(*) || ' people')::varchar, array_agg(p.employee_id ORDER BY p.employee_name)
          FROM ppl p HAVING count(*) > 1
        ), r AS (
          INSERT INTO ckl.runs (zodu_id, branch_id, checklist_id, slot_at, run_date, sequence_no,
                                assignee_employee_id, assignee_name, pool_employee_ids, title, description,
                                category_id, category_name, priority, frequency,
                                reviewer_employee_id, requires_review, allow_partial,
                                available_at, due_at, total_items)
          SELECT c.zodu_id, c.branch_id, c.id, v_slot, v_day, v_seq,
                 a.employee_id, a.employee_name, a.pool, c.name, c.description,
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

-- Notifications for a shared run with a pool go to the pool, not the whole branch.
CREATE OR REPLACE FUNCTION ckl.fn_notify_run(
  p_run_id uuid, p_type text, p_target text, p_custom uuid[], p_channels text[], p_dedupe text)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  r       ckl.runs;
  c       ckl.checklists;
  v_users uuid[];
  v_title text; v_body text; v_sev text;
  v_group boolean := p_type IN ('RUN_ESCALATED','MISSED_STREAK');   -- manager-facing, can burst
BEGIN
  SELECT * INTO r FROM ckl.runs WHERE id = p_run_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  SELECT * INTO c FROM ckl.checklists WHERE id = r.checklist_id;

  -- ASSIGNEE on a shared run (assignee NULL): its pool, or every active employee of the branch,
  -- except approve / reject, which go to whoever handed it in.
  v_users := CASE p_target
    WHEN 'ASSIGNEE' THEN ARRAY(SELECT d.user_id FROM ckl.employee_directory d
                               WHERE d.zodu_id = r.zodu_id AND d.branch_id = r.branch_id AND d.user_id IS NOT NULL
                                 AND CASE WHEN r.assignee_employee_id IS NOT NULL
                                            THEN d.employee_id = r.assignee_employee_id
                                          WHEN p_type IN ('RUN_APPROVED','RUN_REJECTED') AND r.submitted_by_employee_id IS NOT NULL
                                            THEN d.employee_id = r.submitted_by_employee_id
                                          -- shared: the pool if it has one, else the whole branch
                                          ELSE d.is_active AND (r.pool_employee_ids IS NULL OR d.employee_id = ANY (r.pool_employee_ids)) END)
    WHEN 'REVIEWER' THEN CASE WHEN r.reviewer_employee_id IS NULL THEN ARRAY[c.created_by_user_id]
                              ELSE ARRAY(SELECT d.user_id FROM ckl.employee_directory d
                                         WHERE d.zodu_id = r.zodu_id AND d.branch_id = r.branch_id
                                           AND d.employee_id = r.reviewer_employee_id AND d.user_id IS NOT NULL) END
    WHEN 'CREATOR'  THEN ARRAY[c.created_by_user_id]
    WHEN 'CUSTOM'   THEN ARRAY(SELECT d.user_id FROM ckl.employee_directory d
                               WHERE d.zodu_id = r.zodu_id AND d.branch_id = r.branch_id
                                 AND d.employee_id = ANY (p_custom) AND d.user_id IS NOT NULL)
  END;

  SELECT t.title, t.body, t.severity INTO v_title, v_body, v_sev
  FROM ckl.fn_render_notification(
         -- "Priya completed X"; a shared run nobody handed in: "The team hasn't completed X"
         p_type, r.title,
         COALESCE(r.submitted_by_name, CASE WHEN r.assignee_employee_id IS NULL THEN 'The team' ELSE r.assignee_name END),
         to_char(r.due_at AT TIME ZONE c.timezone, 'HH12:MI AM'),
         r.done_items, r.total_items,
         GREATEST(0, floor(EXTRACT(EPOCH FROM now() - r.due_at) / 60))::int,
         r.review_comment) AS t;
  IF v_title IS NULL THEN RAISE EXCEPTION 'unknown notification type %', p_type; END IF;

  RETURN ckl.fn_notify(
    r.zodu_id, r.branch_id, v_users, p_type, v_sev, v_title, v_body,
    'RUN', r.id, '/checklists?date=' || r.run_date || '&run=' || r.id,
    jsonb_build_object('checklist_id', r.checklist_id, 'checklist_title', r.title,
                       'run_date', r.run_date, 'priority', r.priority),
    CASE WHEN v_group   -- one row per checklist per recipient per clock hour
         THEN p_type || ':' || r.checklist_id || ':' || to_char(now() AT TIME ZONE c.timezone, 'YYYYMMDDHH24')
         ELSE p_type || ':' || r.id || ':' || p_dedupe END,
    p_channels, v_group);
END $$;

-- Existing per-person runs of checklists given to several people: a slot nobody has
-- touched yet (every run TODO, nothing ticked, no events) becomes one shared run for
-- those people. Slots someone already worked on keep their runs as history.
-- The run trigger is off meanwhile: this is not a reassignment, nobody is notified.
BEGIN;
CREATE TEMP TABLE v017_slots ON COMMIT DROP AS
  SELECT r.checklist_id, r.slot_at,
         (array_agg(r.id ORDER BY r.id))[1] AS keep_id,
         array_agg(r.assignee_employee_id ORDER BY r.assignee_name) AS pool,
         count(*) AS n
    FROM ckl.runs r JOIN ckl.checklists c ON c.id = r.checklist_id
   WHERE c.assign_mode = 'SPECIFIC' AND r.assignee_employee_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM ckl.runs s WHERE s.checklist_id = r.checklist_id
                        AND s.slot_at = r.slot_at AND s.assignee_employee_id IS NULL)
   GROUP BY r.checklist_id, r.slot_at
  HAVING count(*) > 1
     AND bool_and(r.status = 'TODO' AND r.done_items = 0
                  AND NOT EXISTS (SELECT 1 FROM ckl.run_events e WHERE e.run_id = r.id));

ALTER TABLE ckl.runs DISABLE TRIGGER trg_runs_after_update;

DELETE FROM ckl.runs r USING v017_slots s
 WHERE r.checklist_id = s.checklist_id AND r.slot_at = s.slot_at AND r.id <> s.keep_id;

UPDATE ckl.runs r
   SET assignee_employee_id = NULL, assignee_name = s.n || ' people', pool_employee_ids = s.pool
  FROM v017_slots s
 WHERE r.id = s.keep_id;

ALTER TABLE ckl.runs ENABLE TRIGGER trg_runs_after_update;
COMMIT;
