-- checklist-v2-service · tenant purge + grants for the service login
-- Design: docs/checklist-v2/ARCHITECTURE.md §10.3 (purge) and §4.1 (roles). Re-runnable.

-- Branch purge (auth-service's delete-branch orchestrator). Idempotent: a second
-- call deletes 0 rows. Runs first (they reference checklists without a cascade),
-- then checklists (cascades tasks, schedules, assignees, rules, images), then the
-- branch's read model, counters and inbox rows. Preferences and settings are per
-- company and stay until the company is purged.
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
  RETURN jsonb_build_object('runs', v_runs, 'checklists', v_checklists,
                            'directory', v_directory, 'notifications', v_notifications);
END $$;

-- Company purge: every branch, plus the company-level rows.
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
  RETURN jsonb_build_object('runs', v_runs, 'checklists', v_checklists,
                            'directory', v_directory, 'notifications', v_notifications);
END $$;

-- The service login (ckl_app): DML and EXECUTE only, no DDL. The role is created
-- by hand once per server (checklist-v2-service/db/bootstrap.sql); where it does
-- not exist yet (local setups that log in as postgres) this block does nothing.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ckl_app') THEN
    GRANT USAGE ON SCHEMA ckl TO ckl_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ckl TO ckl_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ckl TO ckl_app;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ckl TO ckl_app;
    GRANT EXECUTE ON ALL PROCEDURES IN SCHEMA ckl TO ckl_app;
  END IF;
END $$;
