-- checklist-v2-service · runs of deleted checklists no longer linger as overdue
-- Deleting a checklist used to cancel only runs that had not started yet
-- (slot_at > now()). Runs already started stayed TODO / IN_PROGRESS and showed as
-- Overdue (the board carries overdue runs over for 30 days); MISSED runs showed as
-- Overdue too. Delete now cancels every unfinished run (src/services/checklists.js
-- remove); this cleans up checklists deleted before that. Completed runs are kept.
-- Re-runnable.

UPDATE ckl.runs r
   SET status = 'CANCELLED', row_version = r.row_version + 1
  FROM ckl.checklists c
 WHERE c.id = r.checklist_id
   AND c.deleted_at IS NOT NULL
   AND r.status IN ('TODO','IN_PROGRESS','PENDING_REVIEW','MISSED');
