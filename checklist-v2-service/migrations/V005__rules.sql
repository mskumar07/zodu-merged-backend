-- checklist-v2-service · time rules and the run trigger
-- Design: docs/checklist-v2/ARCHITECTURE.md §5.5. Re-runnable.

-- Time-driven rules. Exactly once per (rule, run) thanks to the rule_firings PK.
-- A run created after its trigger point (e.g. generated late, or created today for an
-- earlier time) never gets a reminder/overdue/escalation, so nobody is spammed.
CREATE OR REPLACE FUNCTION ckl.fn_evaluate_time_rules(p_limit int DEFAULT 2000)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  rec     record;
  v_count integer := 0;
BEGIN
  FOR rec IN
    SELECT ru.id AS rule_id, ru.rule_type, ru.target, ru.target_employee_ids, ru.channels, rn.id AS run_id
    FROM ckl.runs rn
    JOIN ckl.checklist_rules ru ON ru.checklist_id = rn.checklist_id AND ru.is_active
    WHERE rn.status IN ('TODO','IN_PROGRESS')
      AND rn.due_at BETWEEN now() - interval '3 days' AND now() + interval '1 day'
      AND ru.rule_type IN ('REMIND_BEFORE_DUE','NOTIFY_ON_OVERDUE','ESCALATE_AFTER_OVERDUE','AUTO_CLOSE')
      AND CASE ru.rule_type
            WHEN 'REMIND_BEFORE_DUE' THEN
                 now() >= rn.due_at - make_interval(mins => ru.offset_min)
             AND now() <  rn.due_at
             AND rn.created_at <= rn.due_at - make_interval(mins => ru.offset_min)
            WHEN 'NOTIFY_ON_OVERDUE' THEN
                 now() >= rn.due_at AND rn.created_at < rn.due_at
            WHEN 'ESCALATE_AFTER_OVERDUE' THEN
                 now() >= rn.due_at + make_interval(mins => ru.offset_min) AND rn.created_at < rn.due_at
            WHEN 'AUTO_CLOSE' THEN
                 now() >= rn.due_at + make_interval(mins => ru.offset_min)
          END
      AND NOT EXISTS (SELECT 1 FROM ckl.rule_firings f WHERE f.rule_id = ru.id AND f.run_id = rn.id)
    ORDER BY rn.due_at
    LIMIT p_limit
  LOOP
    INSERT INTO ckl.rule_firings (rule_id, run_id) VALUES (rec.rule_id, rec.run_id) ON CONFLICT DO NOTHING;
    CONTINUE WHEN NOT FOUND;                     -- another worker fired it

    BEGIN                                        -- one bad run must not block the batch
      IF rec.rule_type = 'AUTO_CLOSE' THEN
        UPDATE ckl.runs SET status = 'MISSED', row_version = row_version + 1
         WHERE id = rec.run_id AND status IN ('TODO','IN_PROGRESS');
      ELSE
        PERFORM ckl.fn_notify_run(
          rec.run_id,
          CASE rec.rule_type WHEN 'REMIND_BEFORE_DUE' THEN 'RUN_REMINDER'
                             WHEN 'NOTIFY_ON_OVERDUE' THEN 'RUN_OVERDUE'
                             ELSE 'RUN_ESCALATED' END,
          rec.target, rec.target_employee_ids, rec.channels, rec.rule_id::text);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      UPDATE ckl.rule_firings SET error = SQLERRM WHERE rule_id = rec.rule_id AND run_id = rec.run_id;
      INSERT INTO ckl.job_errors (job, entity_id, error) VALUES ('rule:' || rec.rule_type, rec.run_id, SQLERRM);
    END;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;

-- Event-driven rules + built-in notifications + audit, on every status/assignee change.
CREATE OR REPLACE FUNCTION ckl.trg_runs_after_update() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_actor  uuid := NULLIF(current_setting('ckl.actor_user_id', true), '')::uuid;
  ru       ckl.checklist_rules;
  v_streak integer;
BEGIN
  INSERT INTO ckl.run_events (run_id, zodu_id, branch_id, event_type, from_status, to_status, actor_user_id, payload)
  VALUES (NEW.id, NEW.zodu_id, NEW.branch_id,
          CASE WHEN NEW.assignee_employee_id IS DISTINCT FROM OLD.assignee_employee_id THEN 'REASSIGNED' ELSE 'STATUS_CHANGED' END,
          OLD.status, NEW.status, v_actor,
          jsonb_strip_nulls(jsonb_build_object(
            'from_assignee', CASE WHEN NEW.assignee_employee_id IS DISTINCT FROM OLD.assignee_employee_id THEN OLD.assignee_name END,
            'to_assignee',   CASE WHEN NEW.assignee_employee_id IS DISTINCT FROM OLD.assignee_employee_id THEN NEW.assignee_name END,
            'comment',       CASE WHEN NEW.review_comment IS DISTINCT FROM OLD.review_comment THEN NEW.review_comment END)));

  IF NEW.assignee_employee_id IS DISTINCT FROM OLD.assignee_employee_id THEN
    PERFORM ckl.fn_notify_run(NEW.id, 'RUN_REASSIGNED', 'ASSIGNEE', NULL, '{IN_APP,WEB_PUSH}', NEW.row_version::text);
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- built-in review outcomes (always on)
    IF OLD.status = 'PENDING_REVIEW' AND NEW.status = 'COMPLETED' THEN
      PERFORM ckl.fn_notify_run(NEW.id, 'RUN_APPROVED', 'ASSIGNEE', NULL, '{IN_APP,WEB_PUSH}', 'once');
    ELSIF OLD.status = 'PENDING_REVIEW' AND NEW.status = 'IN_PROGRESS' THEN
      PERFORM ckl.fn_notify_run(NEW.id, 'RUN_REJECTED', 'ASSIGNEE', NULL, '{IN_APP,WEB_PUSH}', NEW.row_version::text);
    END IF;

    -- configured event rules
    FOR ru IN
      SELECT * FROM ckl.checklist_rules
       WHERE checklist_id = NEW.checklist_id AND is_active
         AND rule_type = CASE NEW.status WHEN 'PENDING_REVIEW' THEN 'NOTIFY_REVIEWER_ON_SUBMIT'
                                         WHEN 'COMPLETED'      THEN 'NOTIFY_ON_COMPLETE'
                                         WHEN 'MISSED'         THEN 'MISSED_STREAK' END
    LOOP
      IF ru.rule_type = 'NOTIFY_REVIEWER_ON_SUBMIT' THEN
        PERFORM ckl.fn_notify_run(NEW.id, 'RUN_SUBMITTED', ru.target, ru.target_employee_ids, ru.channels, NEW.row_version::text);
      ELSIF ru.rule_type = 'NOTIFY_ON_COMPLETE' THEN
        PERFORM ckl.fn_notify_run(NEW.id, 'RUN_COMPLETED', ru.target, ru.target_employee_ids, ru.channels, 'once');
      ELSIF ru.rule_type = 'MISSED_STREAK' THEN
        SELECT count(*) INTO v_streak FROM (
          SELECT status FROM ckl.runs
           WHERE checklist_id = NEW.checklist_id
             AND assignee_employee_id IS NOT DISTINCT FROM NEW.assignee_employee_id   -- NULL: shared runs
             AND slot_at <= NEW.slot_at AND status <> 'CANCELLED'
           ORDER BY slot_at DESC LIMIT ru.threshold) x
        WHERE x.status = 'MISSED';
        IF v_streak >= ru.threshold THEN
          PERFORM ckl.fn_notify_run(NEW.id, 'MISSED_STREAK', ru.target, ru.target_employee_ids, ru.channels, 'streak');
        END IF;
      END IF;
    END LOOP;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_runs_after_update ON ckl.runs;
CREATE TRIGGER trg_runs_after_update
AFTER UPDATE ON ckl.runs
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.assignee_employee_id IS DISTINCT FROM NEW.assignee_employee_id)
EXECUTE FUNCTION ckl.trg_runs_after_update();
