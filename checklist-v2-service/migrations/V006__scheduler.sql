-- checklist-v2-service · scheduler tick and housekeeping
-- Design: docs/checklist-v2/ARCHITECTURE.md §5.6. Re-runnable.

-- Called by the worker every 60s under pg_try_advisory_lock. Must be called OUTSIDE an
-- explicit transaction (it COMMITs per checklist so one failure never rolls back the rest).
CREATE OR REPLACE PROCEDURE ckl.sp_scheduler_tick(
  p_horizon interval DEFAULT interval '36 hours', p_batch int DEFAULT 500)
LANGUAGE plpgsql AS $$
DECLARE
  r           record;
  v_started   timestamptz := clock_timestamp();
  v_generated integer := 0;
  v_rules     integer := 0;
  v_errors    integer := 0;
  v_n         integer;
BEGIN
  -- 1. generation (refresh roughly hourly per schedule, not every minute)
  FOR r IN
    SELECT sc.checklist_id
    FROM ckl.checklist_schedules sc
    JOIN ckl.checklists ch ON ch.id = sc.checklist_id
    WHERE ch.status = 'ACTIVE' AND ch.deleted_at IS NULL AND NOT sc.is_exhausted
      AND (sc.generated_until IS NULL OR sc.generated_until < now() + p_horizon - interval '1 hour')
    ORDER BY sc.generated_until NULLS FIRST
    LIMIT p_batch
  LOOP
    BEGIN
      v_n := ckl.fn_generate_for_schedule(r.checklist_id, now() + p_horizon);
      v_generated := v_generated + v_n;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      INSERT INTO ckl.job_errors (job, entity_id, error) VALUES ('generate', r.checklist_id, SQLERRM);
    END;
    COMMIT;
  END LOOP;

  -- 2. time rules (reminders, overdue, escalation, auto-close)
  BEGIN
    v_rules := ckl.fn_evaluate_time_rules(2000);
  EXCEPTION WHEN OTHERS THEN
    v_errors := v_errors + 1;
    INSERT INTO ckl.job_errors (job, error) VALUES ('rules', SQLERRM);
  END;
  COMMIT;

  -- 3. bookkeeping
  INSERT INTO ckl.job_state (job, last_run_at, last_duration_ms, stats)
  VALUES ('tick', now(), (EXTRACT(EPOCH FROM clock_timestamp() - v_started) * 1000)::int,
          jsonb_build_object('runs_generated', v_generated, 'rules_fired', v_rules, 'errors', v_errors))
  ON CONFLICT (job) DO UPDATE SET last_run_at = EXCLUDED.last_run_at,
                                  last_duration_ms = EXCLUDED.last_duration_ms,
                                  stats = EXCLUDED.stats;
  COMMIT;

  -- 4. housekeeping once a day
  IF NOT EXISTS (SELECT 1 FROM ckl.job_state WHERE job = 'housekeeping' AND last_run_at > now() - interval '1 day') THEN
    CALL ckl.sp_housekeeping();
  END IF;
END $$;

CREATE OR REPLACE PROCEDURE ckl.sp_housekeeping()
LANGUAGE plpgsql AS $$
DECLARE v_n integer;
BEGIN
  LOOP
    DELETE FROM ckl.notifications WHERE id IN (
      SELECT id FROM ckl.notifications WHERE expires_at < now() LIMIT 5000);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    COMMIT;
    EXIT WHEN v_n < 5000;
  END LOOP;
  DELETE FROM ckl.idempotency_keys WHERE created_at < now() - interval '24 hours';
  DELETE FROM ckl.notification_deliveries WHERE status IN ('SENT','DEAD') AND created_at < now() - interval '30 days';
  DELETE FROM ckl.job_errors WHERE created_at < now() - interval '30 days';
  COMMIT;
  INSERT INTO ckl.job_state (job, last_run_at) VALUES ('housekeeping', now())
  ON CONFLICT (job) DO UPDATE SET last_run_at = now();
  COMMIT;
END $$;
