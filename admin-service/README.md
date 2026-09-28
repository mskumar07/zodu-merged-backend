# admin-service

Internal admin console API for Zodu Retail. One more service in this same
monorepo, alongside `auth-service`, `retail-service`, etc. — same
conventions, same Docker network, same deploy pipeline (see
`docker-compose.prod.yml` / `docker-compose.uat.yml` at the repo root).

Its frontend (`zodu_admin_panel_frontend`) is a **separate** project/repo,
but reaches this service exactly the way every other Zodu frontend reaches
its backend: through **api-gateway**, not a port of its own.

## Architecture in one line

This service has **its own** Postgres database (`admin_service`) for admin
users only. It never opens a connection to `retail_auth_service`,
`retail_service`, or any other product database — all cross-service data
comes from HTTP calls to those services' `/internal` routes over the
internal Docker network, the same way `retail-service` calls `auth-service`
via `src/utils/authClient.js` (see [`docs/SERVICE_INTEGRATION.md`](docs/SERVICE_INTEGRATION.md)
for exactly what each sibling service needs to expose).

Inbound, admin-service is proxied through `api-gateway` under `/admin`,
exactly like `/auth`, `/retail`, `/employee` etc. — it has no published port
of its own (`expose:` only in docker-compose, never `ports:`). One gateway,
one ingress, for customer traffic and admin traffic alike.

```
zodu_admin_panel_frontend        api-gateway            admin-service          auth-service, retail-service, ...
  (separate repo/deploy)   →   (/admin/* proxy,   →   (this folder, in   →    (siblings in this same repo;
                                 same as /auth,          this monorepo,          each keeps its own DB)
                                 /retail, ...)            own DB)
                                                                │
                                                                ▼
                                                        admin_service DB
                                                        (admin users only)
```

## Setup

1. Create the `admin_service` database on the target Postgres server (same
   as every other `*_service`/`*-service` database — this repo creates
   databases manually, not via script; see the pgAdmin/psql session you
   already use for the others).
2. From the repo root, run the shared migration runner — it applies
   `admin-service/migrations/001_init.sql` (creates `tbl_admin_users`) the
   same way it applies every other service's migrations:
   ```bash
   ./scripts/apply-migrations.sh local   # or uat / prod
   ```
3. Insert the first admin user by hand (bcrypt-hash the password first, e.g.
   `node -e "console.log(require('bcryptjs').hashSync('YourPassword', 10))"`,
   then `INSERT INTO tbl_admin_users (name, email, password_hash, role) VALUES (...)`
   via psql/pgAdmin).
4. ```bash
   npm install
   cp .env.example .env.local   # fill in DB + service URLs + INTERNAL_SERVICE_KEY
   npm run dev
   ```

Server starts on `PORT` (default 3007, the next free internal port after
checklist-service's 3005/3006 — see docker-compose.prod.yml). This port is
never published outside the Docker network; reach the service through
api-gateway's `/admin` route (`http://localhost:5001/admin/...` locally).

## Project layout

```
src/
  api/            Express routers (controllers) — thin, no business logic
  services/       Business logic (admin-auth-service, dashboard-service)
  repository/     SQL against admin_service DB only
  clients/        HTTP clients for OTHER microservices (the only way this
                   backend reaches their data)
  middleware/      requireAdminAuth, requireRole
  database/       pg Pool
  config/         env loading
  utils/          logger, typed errors, asyncHandler
migrations/       plain numbered .sql files, same convention as auth-service —
                  applied via the repo-root ./scripts/apply-migrations.sh,
                  not a script in this folder
```

## Scaling the dashboard

`dashboard-service.js` currently fans out to each service on every request
with `Promise.allSettled` (one slow/down service degrades gracefully instead
of blanking the page). If that gets slow under load, the next step is a
read-model: have each service publish events, consume them here, and keep a
denormalized summary table in `admin_service` — CQRS. Don't build that until
the simple version actually hurts.
