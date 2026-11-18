-- checklist-v2-service · one-time setup per Postgres server (local / UAT / prod).
-- Run by hand as a superuser; scripts/apply-migrations.sh never creates databases.
--
--   psql -h <host> -p <port> -U <superuser> -d postgres -v app_password="'<secret>'" -f checklist-v2-service/db/bootstrap.sql
--
-- ckl_owner owns the schema objects and runs the migrations; ckl_app is the
-- service login (DML + EXECUTE, no DDL). Migrations run as the superuser in
-- apply-migrations.sh still work: V007 grants ckl_app whatever exists.

CREATE ROLE ckl_owner NOLOGIN;
CREATE ROLE ckl_app LOGIN PASSWORD :app_password;

CREATE DATABASE checklist_v2_service OWNER ckl_owner;

\connect checklist_v2_service
CREATE SCHEMA IF NOT EXISTS ckl AUTHORIZATION ckl_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA ckl TO ckl_app;
-- Objects created later by ckl_owner are usable by the app without new grants.
ALTER DEFAULT PRIVILEGES FOR ROLE ckl_owner IN SCHEMA ckl GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ckl_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ckl_owner IN SCHEMA ckl GRANT USAGE, SELECT ON SEQUENCES TO ckl_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ckl_owner IN SCHEMA ckl GRANT EXECUTE ON FUNCTIONS TO ckl_app;
