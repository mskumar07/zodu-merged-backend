-- checklist-v2-service · reminders for runs created inside their reminder window
-- A run created (or generated) after its reminder point but before it is due used to
-- get no reminder at all: e.g. created at 08:53, due 09:00, "remind 15 min before" →
-- nothing until it was overdue. Now the reminder goes out on the next tick, once, as
-- long as the run is still open and not yet due. Overdue / escalation keep the
-- "created before the trigger point" guard (no alerts for runs that were born late).
-- Reminders also share one dedupe key per run and lead time, so "also remind me"
-- (a CREATOR reminder next to the ASSIGNEE one) never doubles up for the same person.
-- Replaces fn_evaluate_time_rules from V005. Re-runnable.

CREATE OR REPLACE FUNCTION ckl.fn_evaluate_time_rules(p_limit int DEFAULT 2000)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  rec     record;
  v_count integer := 0;
BEGIN
  FOR rec IN
    SELECT ru.id AS rule_id, ru.rule_type, ru.offset_min, ru.target, ru.target_employee_ids, ru.channels, rn.id AS run_id
    FROM ckl.runs rn
    JOIN ckl.checklist_rules ru ON ru.checklist_id = rn.checklist_id AND ru.is_active
    WHERE rn.status IN ('TODO','IN_PROGRESS')
      AND rn.due_at BETWEEN now() - interval '3 days' AND now() + interval '1 day'
      AND ru.rule_type IN ('REMIND_BEFORE_DUE','NOTIFY_ON_OVERDUE','ESCALATE_AFTER_OVERDUE','AUTO_CLOSE')
      AND CASE ru.rule_type
            WHEN 'REMIND_BEFORE_DUE' THEN
                 now() >= rn.due_at - make_interval(mins => ru.offset_min)
             AND now() <  rn.due_at
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
          rec.target, rec.target_employee_ids, rec.channels,
          -- Reminders with the same lead time share one key per run: someone who is both
          -- the creator ("also remind me") and an assignee gets ONE reminder, not two.
          CASE WHEN rec.rule_type = 'REMIND_BEFORE_DUE' THEN 'remind:' || rec.offset_min ELSE rec.rule_id::text END);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      UPDATE ckl.rule_firings SET error = SQLERRM WHERE rule_id = rec.rule_id AND run_id = rec.run_id;
      INSERT INTO ckl.job_errors (job, entity_id, error) VALUES ('rule:' || rec.rule_type, rec.run_id, SQLERRM);
    END;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;
