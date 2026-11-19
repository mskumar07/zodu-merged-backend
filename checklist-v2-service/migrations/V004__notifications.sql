-- checklist-v2-service · notifications
-- Design: docs/checklist-v2/ARCHITECTURE.md §5.4. Re-runnable.

-- Default when the user has no row: in-app ON; push/email OFF until the user opts in.
CREATE OR REPLACE FUNCTION ckl.fn_pref_enabled(p_zodu_id text, p_user_id uuid, p_type text, p_channel text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
           (SELECT enabled FROM ckl.notification_preferences
             WHERE zodu_id = p_zodu_id AND user_id = p_user_id AND type = p_type AND channel = p_channel),
           p_channel = 'IN_APP')
     AND (p_channel = 'IN_APP' OR NOT EXISTS (
           SELECT 1 FROM ckl.notification_settings
            WHERE zodu_id = p_zodu_id AND user_id = p_user_id AND muted_until > now()))
$$;

-- When an external delivery may go out: now, or the end of the user's quiet hours.
CREATE OR REPLACE FUNCTION ckl.fn_quiet_hours_end(p_zodu_id text, p_user_id uuid, p_at timestamptz)
RETURNS timestamptz LANGUAGE plpgsql STABLE AS $$
DECLARE
  st      ckl.notification_settings;
  v_local timestamp;
  v_t     time;
  v_end   timestamp;
BEGIN
  SELECT * INTO st FROM ckl.notification_settings WHERE zodu_id = p_zodu_id AND user_id = p_user_id;
  IF NOT FOUND OR st.quiet_start IS NULL OR st.quiet_end IS NULL OR st.quiet_start = st.quiet_end THEN
    RETURN p_at;
  END IF;
  v_local := p_at AT TIME ZONE st.timezone;
  v_t     := v_local::time;
  IF st.quiet_start < st.quiet_end THEN                      -- e.g. 13:00–14:00
    IF v_t >= st.quiet_start AND v_t < st.quiet_end THEN v_end := v_local::date + st.quiet_end;
    ELSE RETURN p_at; END IF;
  ELSE                                                       -- crosses midnight, e.g. 22:00–07:00
    IF v_t >= st.quiet_start THEN v_end := (v_local::date + 1) + st.quiet_end;
    ELSIF v_t < st.quiet_end THEN v_end := v_local::date + st.quiet_end;
    ELSE RETURN p_at; END IF;
  END IF;
  RETURN v_end AT TIME ZONE st.timezone;
END $$;

CREATE OR REPLACE FUNCTION ckl.fn_render_notification(
  p_type text, p_title text, p_assignee text, p_due text,
  p_done int, p_total int, p_late_min int, p_comment text)
RETURNS TABLE (title text, body text, severity text) LANGUAGE sql STABLE AS $$
  SELECT v.title, v.body, v.severity FROM (VALUES
    ('RUN_REMINDER',   'Reminder: ' || p_title,
                       format('Due at %s. %s of %s tasks done.', p_due, p_done, p_total), 'INFO'),
    ('RUN_OVERDUE',    'Overdue: ' || p_title,
                       format('It was due at %s. Please complete it now.', p_due), 'WARNING'),
    ('RUN_ESCALATED',  format('%s hasn''t completed %s', p_assignee, p_title),
                       format('Overdue by %s min (was due at %s).', p_late_min, p_due), 'CRITICAL'),
    ('RUN_SUBMITTED',  format('%s submitted %s for review', p_assignee, p_title),
                       format('%s of %s tasks done. Review it now.', p_done, p_total), 'INFO'),
    ('RUN_APPROVED',   'Approved: ' || p_title, 'Your checklist was approved.', 'INFO'),
    ('RUN_REJECTED',   'Sent back: ' || p_title,
                       COALESCE('Reviewer note: ' || p_comment, 'Please review and resubmit.'), 'WARNING'),
    ('RUN_COMPLETED',  format('%s completed %s', p_assignee, p_title),
                       format('%s of %s tasks done.', p_done, p_total), 'INFO'),
    ('RUN_REASSIGNED', 'Assigned to you: ' || p_title, format('Due at %s.', p_due), 'INFO'),
    ('MISSED_STREAK',  format('%s keeps missing %s', p_assignee, p_title),
                       'Missed several times in a row. Check in with them.', 'CRITICAL'),
    ('CHECKLIST_ASSIGNED', 'New checklist: ' || p_title, 'You have been assigned a new checklist.', 'INFO')
  ) AS v(type, title, body, severity)
  WHERE v.type = p_type
$$;

-- Core fan-out. Deduped per recipient by dedupe_key, so retries are harmless.
-- The acting user (SET LOCAL ckl.actor_user_id) is never notified about their own action.
CREATE OR REPLACE FUNCTION ckl.fn_notify(
  p_zodu_id text, p_branch_id text, p_user_ids uuid[], p_type text, p_severity text,
  p_title text, p_body text, p_entity_type text, p_entity_id uuid, p_action_url text,
  p_data jsonb, p_dedupe_key text, p_channels text[] DEFAULT '{IN_APP}', p_group boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('ckl.actor_user_id', true), '')::uuid;
  v_uid   uuid;
  v_id    uuid;
  v_inbox boolean;
  v_ch    text;
  v_ext   text[];
  v_n     integer := 0;
BEGIN
  FOREACH v_uid IN ARRAY ARRAY(SELECT DISTINCT u FROM unnest(COALESCE(p_user_ids, '{}')) AS u WHERE u IS NOT NULL) LOOP
    CONTINUE WHEN v_uid = v_actor;

    v_inbox := 'IN_APP' = ANY (p_channels) AND ckl.fn_pref_enabled(p_zodu_id, v_uid, p_type, 'IN_APP');
    v_ext   := ARRAY(SELECT ch FROM unnest(p_channels) AS ch
                     WHERE ch <> 'IN_APP' AND ckl.fn_pref_enabled(p_zodu_id, v_uid, p_type, ch));
    CONTINUE WHEN NOT v_inbox AND cardinality(v_ext) = 0;

    -- p_group = true: the same key within the bucket updates ONE row ("3 overdue runs on X")
    -- instead of adding rows; it is marked unread again and re-pushed live. External channels are
    -- still sent once per group (uq_delivery), which throttles push/email to one per bucket.
    INSERT INTO ckl.notifications AS n (zodu_id, branch_id, recipient_user_id, type, severity, title, body,
                                        entity_type, entity_id, action_url, data, dedupe_key, show_in_inbox)
    VALUES (p_zodu_id, p_branch_id, v_uid, p_type, p_severity, left(p_title, 200), left(p_body, 500),
            p_entity_type, p_entity_id, p_action_url, COALESCE(p_data, '{}') || '{"count": 1}', p_dedupe_key, v_inbox)
    ON CONFLICT (recipient_user_id, dedupe_key) DO UPDATE
       SET data       = n.data || jsonb_build_object('count', COALESCE((n.data->>'count')::int, 1) + 1),
           title      = left(format(CASE n.type WHEN 'MISSED_STREAK' THEN '%s missed-streak alerts on %s'
                                                   ELSE '%s overdue runs on %s' END,
                                    COALESCE((n.data->>'count')::int, 1) + 1, EXCLUDED.data->>'checklist_title'), 200),
           body       = EXCLUDED.body,
           entity_type = 'CHECKLIST',
           entity_id  = (EXCLUDED.data->>'checklist_id')::uuid,
           action_url = '/checklists?date=' || (EXCLUDED.data->>'run_date') || '&status=OVERDUE',
           read_at    = NULL,
           created_at = now()
     WHERE p_group
    RETURNING id INTO v_id;
    CONTINUE WHEN v_id IS NULL;
    v_n := v_n + 1;

    IF v_inbox THEN   -- delivered on COMMIT; payload stays tiny (< 8000 bytes)
      PERFORM pg_notify('ckl_notifications',
        json_build_object('id', v_id, 'user_id', v_uid, 'zodu_id', p_zodu_id, 'branch_id', p_branch_id)::text);
    END IF;

    FOREACH v_ch IN ARRAY v_ext LOOP
      INSERT INTO ckl.notification_deliveries (notification_id, channel, next_attempt_at)
      VALUES (v_id, v_ch, CASE WHEN p_severity = 'CRITICAL' THEN now()
                               ELSE ckl.fn_quiet_hours_end(p_zodu_id, v_uid, now()) END)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
  RETURN v_n;
END $$;

-- Recipients for a run: ASSIGNEE | REVIEWER (falls back to the creator) | CREATOR | CUSTOM.
-- Employees without a login (user_id NULL) are skipped.
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

  -- ASSIGNEE on a shared run (assignee NULL): every active employee of the branch,
  -- except approve / reject, which go to whoever handed it in.
  v_users := CASE p_target
    WHEN 'ASSIGNEE' THEN ARRAY(SELECT d.user_id FROM ckl.employee_directory d
                               WHERE d.zodu_id = r.zodu_id AND d.branch_id = r.branch_id AND d.user_id IS NOT NULL
                                 AND CASE WHEN r.assignee_employee_id IS NOT NULL
                                            THEN d.employee_id = r.assignee_employee_id
                                          WHEN p_type IN ('RUN_APPROVED','RUN_REJECTED') AND r.submitted_by_employee_id IS NOT NULL
                                            THEN d.employee_id = r.submitted_by_employee_id
                                          ELSE d.is_active END)
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
