-- Recurring tasks: one tbl_checklist_instances row per occurrence.
--
--   * due_date      — when THIS occurrence is due. A recurring task keeps its
--                     own start/due on tbl_checklists as the occurrence
--                     length (due - start); every occurrence is due
--                     scheduled_date + that length.
--   * completed_at  — when the occurrence was actually marked Completed
--                     (may be later than due_date for a late completion).
--   * generate_checklist_instances(from, to) — inserts the occurrences that
--     fall on each day of the range. Idempotent (UNIQUE checklist_id +
--     scheduled_date), so the nightly job, a restart catch-up and a manual
--     call can overlap safely.
--
-- "Overdue" is NOT stored: it is derived at read time (open status and
-- due_date < today), so it can never go stale.
--
-- Run this once against the checklist service's database.
-- Safe to re-run: IF NOT EXISTS / CREATE OR REPLACE throughout.

ALTER TABLE tbl_checklist_instances
    ADD COLUMN IF NOT EXISTS due_date     DATE,
    ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Backfill: recurring instances get scheduled_date + occurrence length, the
-- rest are due on the task's own due date.
UPDATE tbl_checklist_instances i
SET due_date = CASE
        WHEN c.is_recurring AND c.start_date IS NOT NULL AND c.due_date IS NOT NULL
            THEN i.scheduled_date + GREATEST(c.due_date - c.start_date, 0)
        ELSE COALESCE(c.due_date, i.scheduled_date)
    END
FROM tbl_checklists c
WHERE c.id = i.checklist_id AND i.due_date IS NULL;

UPDATE tbl_checklist_instances
SET completed_at = NOW()
WHERE status = 'Completed' AND completed_at IS NULL;

-- Date filter on the landing screen, and "latest occurrence of a task".
CREATE INDEX IF NOT EXISTS idx_instances_zodu_branch_date
    ON tbl_checklist_instances (zodu_id, branch_id, scheduled_date DESC);
CREATE INDEX IF NOT EXISTS idx_instances_checklist_date
    ON tbl_checklist_instances (checklist_id, scheduled_date DESC);

-- p_checklist_id NULL = every recurring task (nightly job); set = just that
-- task (used when one is created with a past start date, or its recurrence is edited).
CREATE OR REPLACE FUNCTION generate_checklist_instances(
    p_from         DATE,
    p_to           DATE DEFAULT NULL,
    p_checklist_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_to       DATE := COALESCE(p_to, p_from);
    v_inserted INTEGER;
BEGIN
    IF v_to < p_from THEN
        RAISE EXCEPTION 'p_to (%) is before p_from (%)', v_to, p_from;
    END IF;
    IF v_to - p_from > 366 THEN
        RAISE EXCEPTION 'range too large: % days (max 366)', v_to - p_from;
    END IF;

    WITH days AS (
        SELECT d::date AS day FROM generate_series(p_from, v_to, INTERVAL '1 day') d
    ),
    recurring AS (
        SELECT c.id, c.zodu_id, c.branch_id,
               c.recur_frequency                                   AS freq,
               GREATEST(COALESCE(c.recur_every, 1), 1)             AS every,
               COALESCE(c.recur_start_date, c.start_date, c.created_at::date) AS anchor,
               CASE WHEN c.start_date IS NOT NULL AND c.due_date IS NOT NULL
                    THEN GREATEST(c.due_date - c.start_date, 0) ELSE 0 END    AS duration,
               CASE WHEN c.recur_ends = 'On Date' THEN c.recur_end_date END   AS end_date
        FROM tbl_checklists c
        WHERE c.is_recurring AND c.recur_frequency IS NOT NULL
          AND (p_checklist_id IS NULL OR c.id = p_checklist_id)
    ),
    due AS (
        SELECT r.id, r.zodu_id, r.branch_id, r.duration, d.day
        FROM recurring r
        JOIN days d
          ON d.day >= r.anchor
         AND (r.end_date IS NULL OR d.day <= r.end_date)
        CROSS JOIN LATERAL (
            -- whole months between the anchor's month and this day's month
            SELECT (EXTRACT(YEAR FROM d.day)::int * 12 + EXTRACT(MONTH FROM d.day)::int)
                 - (EXTRACT(YEAR FROM r.anchor)::int * 12 + EXTRACT(MONTH FROM r.anchor)::int) AS months,
                   -- the anchor's day-of-month, clamped for short months (31st -> 28th/30th)
                   LEAST(EXTRACT(DAY FROM r.anchor)::int,
                         EXTRACT(DAY FROM (DATE_TRUNC('month', d.day) + INTERVAL '1 month' - INTERVAL '1 day'))::int) AS dom
        ) m
        WHERE CASE r.freq
                WHEN 'Daily'   THEN (d.day - r.anchor) % r.every = 0
                WHEN 'Weekly'  THEN (d.day - r.anchor) % (7 * r.every) = 0
                WHEN 'Monthly' THEN m.months % r.every = 0        AND EXTRACT(DAY FROM d.day)::int = m.dom
                WHEN 'Yearly'  THEN m.months % (12 * r.every) = 0 AND EXTRACT(DAY FROM d.day)::int = m.dom
                ELSE FALSE
              END
    ),
    ins AS (
        INSERT INTO tbl_checklist_instances (checklist_id, zodu_id, branch_id, scheduled_date, due_date, status)
        SELECT id, zodu_id, branch_id, day, day + duration, 'Not Started' FROM due
        ON CONFLICT (checklist_id, scheduled_date) DO NOTHING
        RETURNING checklist_id, scheduled_date
    ),
    -- The task row mirrors its newest occurrence, so the existing status
    -- filters / counts keep working. A back-filled older day must not reset it.
    upd AS (
        UPDATE tbl_checklists c
        SET status = 'Not Started'
        FROM (SELECT checklist_id, MAX(scheduled_date) AS newest FROM ins GROUP BY checklist_id) n
        WHERE c.id = n.checklist_id
          AND n.newest >= COALESCE(
                (SELECT MAX(i.scheduled_date) FROM tbl_checklist_instances i WHERE i.checklist_id = c.id),
                n.newest)
        RETURNING c.id
    )
    SELECT COUNT(*) INTO v_inserted FROM ins;

    RETURN v_inserted;
END;
$$;
