-- checklist-v2-service · recurrence functions
-- Design: docs/checklist-v2/ARCHITECTURE.md §5.1. Re-runnable.

-- Port of patternOn() + the start/end limits of timesOn() in recurrence.ts.
-- Weekly uses ISO weeks (Monday start) like mondayOf(); "last weekday" = d+7 is in the next month.
CREATE OR REPLACE FUNCTION ckl.fn_pattern_on(s ckl.checklist_schedules, d date)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN d < s.start_date THEN false
    WHEN s.task_type = 'ONCE' THEN d = s.start_date
    WHEN s.ends = 'ON_DATE' AND d > s.end_date THEN false
    WHEN s.frequency = 'HOURLY' THEN true
    WHEN s.frequency = 'DAILY' THEN
         NOT (s.weekdays_only AND EXTRACT(ISODOW FROM d) IN (6, 7))
         AND (d - s.start_date) % GREATEST(COALESCE(s.every_n, 1), 1) = 0
    WHEN s.frequency = 'WEEKLY' THEN
         EXTRACT(DOW FROM d)::smallint = ANY (s.weekdays)
         AND ((date_trunc('week', d::timestamp)::date - date_trunc('week', s.start_date::timestamp)::date) / 7)
             % GREATEST(COALESCE(s.every_n, 1), 1) = 0
    WHEN s.frequency = 'MONTHLY' THEN
         ((EXTRACT(YEAR FROM d)::int * 12 + EXTRACT(MONTH FROM d)::int)
        - (EXTRACT(YEAR FROM s.start_date)::int * 12 + EXTRACT(MONTH FROM s.start_date)::int))
           % GREATEST(COALESCE(s.every_n, 1), 1) = 0
         AND CASE s.monthly_by
               WHEN 'DAY' THEN EXTRACT(DAY FROM d)::int =
                    LEAST(s.month_day, EXTRACT(DAY FROM (date_trunc('month', d::timestamp) + interval '1 month - 1 day'))::int)
               WHEN 'WEEKDAY' THEN EXTRACT(DOW FROM d)::int = s.nth_weekday
                    AND CASE WHEN s.nth = -1
                             THEN EXTRACT(MONTH FROM d + 7) <> EXTRACT(MONTH FROM d)
                             ELSE ceil(EXTRACT(DAY FROM d) / 7.0)::int = s.nth END
               ELSE false
             END
    ELSE false
  END
$$;

-- Port of slotsOf(): one trigger time, or every N hours inside the window (inclusive end).
CREATE OR REPLACE FUNCTION ckl.fn_slot_times(s ckl.checklist_schedules)
RETURNS SETOF time LANGUAGE sql IMMUTABLE AS $$
  SELECT s.trigger_time
  WHERE s.task_type = 'ONCE' OR s.frequency IS DISTINCT FROM 'HOURLY'
  UNION ALL
  SELECT make_time(m / 60, m % 60, 0)
  FROM generate_series(
         CASE WHEN s.all_day THEN 0    ELSE (EXTRACT(EPOCH FROM s.window_start) / 60)::int END,
         CASE WHEN s.all_day THEN 1439 ELSE (EXTRACT(EPOCH FROM s.window_end)   / 60)::int END,
         GREATEST(COALESCE(s.every_n, 1), 1) * 60) AS m
  WHERE s.task_type = 'RECURRING' AND s.frequency = 'HOURLY'
$$;

-- Port of nextOccurrences(): "After N" counts slots from start_date, like lastRun().
-- p_rule uses the column names of ckl.checklist_schedules (the API normalises defaults first).
CREATE OR REPLACE FUNCTION ckl.fn_preview_occurrences(p_rule jsonb, p_from date, p_count int DEFAULT 5)
RETURNS TABLE (occurs_on date, times time[]) LANGUAGE plpgsql STABLE AS $$
DECLARE
  s       ckl.checklist_schedules := jsonb_populate_record(NULL::ckl.checklist_schedules, p_rule);
  v_day   date := s.start_date;
  v_slots time[];
  v_take  time[];
  v_seq   int := 0;
  v_found int := 0;
BEGIN
  SELECT array_agg(t ORDER BY t) INTO v_slots FROM ckl.fn_slot_times(s) AS t;
  IF v_slots IS NULL OR p_count < 1 THEN RETURN; END IF;
  WHILE v_found < LEAST(p_count, 50) AND v_day <= s.start_date + 3700 LOOP
    EXIT WHEN s.task_type = 'ONCE' AND v_day > s.start_date;
    EXIT WHEN s.ends = 'ON_DATE' AND v_day > s.end_date;
    IF ckl.fn_pattern_on(s, v_day) THEN
      v_take := v_slots;
      IF s.ends = 'AFTER' THEN
        EXIT WHEN v_seq >= s.max_occurrences;
        v_take := v_slots[1 : LEAST(cardinality(v_slots), s.max_occurrences - v_seq)];
      END IF;
      v_seq := v_seq + cardinality(v_take);
      IF v_day >= p_from THEN
        occurs_on := v_day; times := v_take; v_found := v_found + 1;
        RETURN NEXT;
      END IF;
    END IF;
    v_day := v_day + 1;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION ckl.fn_next_checklist_code(p_zodu_id text, p_branch_id text)
RETURNS text LANGUAGE sql AS $$
  INSERT INTO ckl.checklist_code_counters AS c (zodu_id, branch_id, last_no)
  VALUES (p_zodu_id, p_branch_id, 1)
  ON CONFLICT (zodu_id, branch_id) DO UPDATE SET last_no = c.last_no + 1
  RETURNING 'CL-' || lpad(last_no::text, 4, '0')
$$;

-- The board's four columns. PENDING_REVIEW shows as In Progress (badge "Awaiting review");
-- MISSED shows as Overdue (badge "Missed").
CREATE OR REPLACE FUNCTION ckl.fn_board_status(p_status text, p_due_at timestamptz)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p_status = 'COMPLETED' THEN 'COMPLETED'
    WHEN p_status = 'MISSED' THEN 'OVERDUE'
    WHEN p_status = 'PENDING_REVIEW' THEN 'IN_PROGRESS'
    WHEN p_status IN ('TODO','IN_PROGRESS') AND p_due_at < now() THEN 'OVERDUE'
    WHEN p_status = 'IN_PROGRESS' THEN 'IN_PROGRESS'
    WHEN p_status = 'TODO' THEN 'TODO'
    ELSE p_status
  END
$$;
