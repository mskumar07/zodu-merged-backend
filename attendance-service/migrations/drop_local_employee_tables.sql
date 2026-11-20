-- DESTRUCTIVE. Run by scripts/apply-migrations.sh (once) after employees_moved_to_employee_service.sql; back up first.
-- Removes the attendance database's own employee tables. Employees live in employee-service now, so these hold only
-- an old, no-longer-updated copy. Run it only after
--   · employees_moved_to_employee_service.sql has been applied, and
--   · the new attendance-service build has been checked against employee-service (team attendance, leave, dashboard),
--   · you are sure employee-service's database has every employee, document, emergency contact and face (take a backup first).
-- Keeps tbl_attendance, the leave tables, holidays, shift templates and tbl_schema_migrations.

BEGIN;
DROP TABLE IF EXISTS tbl_employee_faces;
DROP TABLE IF EXISTS tbl_employee_documents;
DROP TABLE IF EXISTS tbl_employee_emergency_contacts;
DROP TABLE IF EXISTS tbl_employees;
COMMIT;
