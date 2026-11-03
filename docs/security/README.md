# Security: operations guide

Covers what the foundation phase put in place: service-to-service tokens,
secrets in env files, Redis, the gateway, and the secrets to rotate. Later
phases (ES256 tokens, per-route permissions) extend this page.

## 1. Service-to-service calls

Every `/internal/*` route needs the calling service's `X-Internal-Token`, and
each route accepts only the services listed here. The gateway also answers 404
for every `/internal` path, so these routes are unreachable from outside.

| Receiver | Route | Accepted callers |
|---|---|---|
| auth-service | `/internal/company*`, `/internal/branches*` writes, `/internal/invoice-settings/*`, `/internal/pos-settings/*` | restaurant, retail |
| auth-service | `GET /internal/company/:id`, `GET /internal/branches/:id[/:branch]` | restaurant, retail, admin |
| auth-service | `/internal/admin/*` | admin |
| auth-service | `/internal/user-branch-access` | file |
| auth-service | `/internal/employee/*` | employee |
| employee-service | all `/internal/*` (create-admin, by-user, purge) | auth |
| restaurant-service | seed-defaults, purge | auth |
| retail-service | seed-defaults, purge | auth |
| retail-service | `/internal/admin/*` | admin |
| payroll-service | `/internal/salary/*` | employee |
| payroll-service | purge | auth |
| checklist-service | purge | auth |
| file-service | all `/internal/*` | auth, employee, checklist, retail, restaurant |
| face-service | `POST /embedding` | employee |

Calls admin-service makes that have no route on the other side (they fail
today and still do): `PUT /internal/admin/subscriptions/:z/:b` on auth-service,
`GET /internal/admin/users/stats` on employee-service.

## 2. Secrets and env files

No secret is in a compose file any more. Each service reads them from
`env/<service>.<env>.env` on the host (git-ignored, `chmod 600`). The compose
files hold only non-secret settings.

```bash
scripts/gen-secrets.sh uat          # service tokens + Redis password, idempotent
```

Then add by hand, per environment (templates: each service's `.env.example`):

| File | Values |
|---|---|
| every service with a database | `DB_USERNAME`, `DB_PASSWORD` |
| auth, employee, restaurant, retail | `APP_SECRET` (same value in all four; it signs customer tokens) |
| admin-service | its own `APP_SECRET`, **different** from the customer one |
| api-gateway | `CORS_ORIGINS` (the web app origins) |
| file-service | `APP_SECRET`, MinIO keys (`docs/file-service/minio-setup.md`) |

`env/secrets.<env>.env` is the master copy of the generated values; keep it
with the other host secrets, outside backups that leave the host unencrypted.

**Rotate one service token:** delete its line from `env/secrets.<env>.env`, run
`scripts/gen-secrets.sh <env>`, restart the services
(`docker compose -f docker-compose.<env>.yml up -d`). Calls between services
fail until both sides have restarted, so do it in a quiet window.

## 3. Secrets to rotate now

These were committed to git (compose files and history) and must be treated
as public. Rotate each, then put the new value only in the env files.

| Secret | Where it was | Action |
|---|---|---|
| Postgres password `zodu@2025` (users `zodudb`, `zoduprod`) | both compose files, git history | `ALTER USER ... PASSWORD`, update every service's env file. The database host `72.60.206.59` is a public IP: restrict port 5432/5433 to the app host (firewall / `pg_hba.conf`). |
| MinIO keys `zoduminio` / `zodu@2025` | compose history (removed in the file-service phase) | disable that user (`docs/file-service/minio-setup.md` §7) |
| admin-service `APP_SECRET` (`zodu@2025adminsecret…`) | both compose files | new random value (`openssl rand -base64 48`); all admin console sessions end |
| admin `INTERNAL_SERVICE_KEY` (`zodu@2025internalkey…`) | both compose files | no longer used; replaced by per-service tokens |
| customer `APP_SECRET` | not in git, but its source on the servers is unknown (not in compose; `.env` is excluded from images) | check where the running containers get it; rotate in the auth phase, when ES256 keys replace it |

Purging the values from git history (`git filter-repo`) is optional once they
are rotated; rotation is what matters.

## 4. Redis

Used for rate-limit counters (gateway, file-service) and, from the auth phase,
refresh-token sessions. It is internal only, password-protected
(`env/redis.<env>.env`), persisted (AOF, volume `redis-data`) and never evicts
keys (`noeviction`: a full Redis refuses writes instead of silently dropping
sessions). If Redis is down, rate limits let requests through.

## 5. Gateway

- **Blocked (404):** `/*/internal/*`, `/*/delete/file/*`, `/*/file/*` except
  GET/HEAD (old file URLs, served read-only by file-service), `.` and `..`
  segments, backslashes, control characters, malformed or triple-encoded
  escapes. The path is decoded before the checks. Encoded slashes are allowed
  because document numbers such as `INV/25-26/001` appear in paths.
- **CORS:** only `CORS_ORIGINS`, with credentials. Requests without an Origin
  (Flutter, Electron main process) are unaffected. An Electron renderer loaded
  from `file://` sends `Origin: null`, which is not allowed: serve it from a
  custom scheme (`app://zodu`) and list that.
- **Rate limits (Redis):** 600 requests/min per IP overall
  (`RATE_LIMIT_IP_PER_MIN`); 30/min per IP for login, sign-up and refresh
  together (`AUTH_RATE_LIMIT_PER_MIN`). Offices behind one NAT share these.
- **Headers:** helmet (CSP `default-src 'none'` on API responses; file
  responses keep file-service's own), `X-Request-Id` on every request and
  passed to the services, client IP in `X-Forwarded-For`.
- **Limits:** bodies over 26MB (declared size) → 413; services enforce their
  own, tighter limits, also for chunked bodies. Headers must arrive within 20s,
  the whole request within 5 minutes, a service must answer within 2 minutes.
- **payroll-service is not proxied.** Its only non-internal route
  (`GET /api/salary`) is used by no client; employee-service reaches it internally.

### At the HTTPS reverse proxy (not in this repo)

```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

The gateway trusts exactly one proxy hop (`TRUST_PROXY=1`). The compose files
publish its port on all interfaces; if the reverse proxy runs on the same host,
bind it to `127.0.0.1:<port>:<port>` so nobody can bypass the proxy and spoof
`X-Forwarded-For`. Add `preload` to HSTS only once every subdomain serves HTTPS.

## 6. Building images

Node images build from the repository root (`packages/zodu-security` is copied
in; see its README):

```bash
docker compose -f docker-compose.uat.yml build
docker compose -f docker-compose.uat.yml push
```

All Node images run Node 24 as the `node` user with `NODE_ENV=production`.

## 7. Dependency checks

`.github/workflows/security.yml` runs `npm audit --omit=dev --audit-level=high`
for every service on each push, pull request and weekly, plus the test suites.
Dependabot (`.github/dependabot.yml`) opens update PRs for npm, pip, the base
images and the workflow actions.
