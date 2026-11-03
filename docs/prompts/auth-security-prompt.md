You are a senior Node.js security engineer. Secure the **Zodu** backend (multi-tenant restaurant / retail billing SaaS) in the repo `C:\Zodu\latest\zodu-merged-backend`. Implement industry-standard **JWT authentication**, **authorization**, **tenant isolation** and **API hardening** so that an attacker cannot read, change or delete another company's data, take over accounts, or abuse the API.

File storage is handled by a **separate prompt** (`docs/prompts/file-service-prompt.md`). Do not build file-service here; only make sure its auth hook can switch to the new tokens (Phase 2).

Work in the **phases** at the end, one branch and PR each. **Stop after each phase** and report before starting the next. Do not convert every service in one change.

---

## Standards to follow

| Standard | Used for |
|---|---|
| **OWASP API Security Top 10 (2023)** | Checklist for every service (mapping in section 5) |
| **OWASP ASVS** (levels 1–2) | Authentication, session and access-control requirements |
| **RFC 8725**, JWT Best Current Practices | Algorithm pinning, `typ`, `iss` / `aud` checks, key handling |
| **RFC 9068**, JWT Profile for OAuth 2.0 Access Tokens | `typ: at+jwt`, claim set |
| **RFC 9700**, OAuth 2.0 Security Best Current Practice | Refresh-token rotation and reuse detection |
| **NIST SP 800-63B** | Password rules, rate limiting of login attempts |
| **OWASP Password Storage Cheat Sheet** | argon2id (minimum `m=19456 KiB, t=2, p=1`) |

---

## 0. Ground truth: verify each point before relying on it

These facts come from the repo as of Oct 2026. Re-check each one and tell me if anything has changed.

### Services

All services are Node 24 (`node:24-alpine`), **CommonJS**, Express 4, raw `pg` (no ORM).

| Service | Port | Gateway prefix | Auth today |
|---|---|---|---|
| api-gateway | 5001 | — | **Only public port.** `cors({ origin: '*' })`, no rate limit, no security headers |
| auth-service | 4000 | `/auth` | `ValidateSignature` on most routes |
| retail-service | 4001 | `/retail` | **None** (~180 routes) |
| employee-service | 4002 | `/employee` | **None** (~21 routes) |
| restaurant-service | 4003 | `/restaurant` | **None** (~185 routes) |
| payroll-service | 4004 | not proxied | **None** (~9 routes); confirm how clients reach it |
| checklist-service | 4005 / 3006 | `/checklist` | **None** (~21 routes); port differs between compose (4005) and gateway default (3006) |
| admin-service | 4006 | `/admin` | Own admin JWT (`requireAdminAuth`). **Out of scope**, but keep its secret separate from customer tokens |
| face-service | 8000 | not proxied | **Python** (FastAPI), called internally by employee-service |
| print-bridge | — | — | Out of scope |

### Code conventions (follow them)

- Every Node service uses `src/api/*-controller.js` → `src/services/*` → `src/repository/*` → `src/database/connection.js` (pg Pool).
- Validation uses **Joi** (`src/schema/`, `src/utils/requestValidator.js`). **Use Joi, not zod.**
- Errors go through `src/utils/error/*` (`STATUS_CODES`, error classes, `HandleErrorWithLogger`). Logging uses pino or winston.
- Migrations are idempotent `.sql` files in `<service>/migrations/`, registered in `scripts/apply-migrations.sh` (tracked in `tbl_schema_migrations`).
- Each service has its own database. Its Dockerfile builds from its own folder (`COPY . .`).
- **No tests exist.**

### Tenant and permission model

- **Tenant = company = `zodu_id`.** Companies have **branches** (`branch_id`: `B1`, `B2`, …). Most data is scoped by `(zodu_id, branch_id)`.
- A user can belong to **several companies** (`tbl_user_companies`, `is_primary`) and has roles **per company and branch** (`tbl_user_roles`).
- Permissions already exist: `tbl_roles`, `tbl_access_control` (`can_read`, `can_create`, `can_edit`, `can_delete` per `module_id`) and `tbl_modules`. **Derive permissions from these; don't invent a second model.**
- `tbl_users` has `user_type` (e.g. `employee`), `is_active`, `is_deleted` and `login_user` (whether the user may log in).

### Current auth (what you are replacing)

- `GenerateSignature` (`auth-service/src/utils/error/index.js`) signs **HS256** with `APP_SECRET`, valid **30 days**. The payload contains **PII**: `user_id, zodu_id, user_type, email, phone`.
- The **refresh token** is also an HS256 JWT with the **same `APP_SECRET`**, valid 7 days, stored **in plain text** in `tbl_user_sessions`.
- **Login** (`POST /auth/api/login`) accepts **email or phone** + password. Passwords are **bcrypt**.
  - The dummy hash for unknown accounts is a **malformed bcrypt string**. `bcrypt.compare` fails fast on it, so response time reveals which accounts exist.
  - Login returns `access_token`, `refresh_token`, `user{…}` and `companies[…]` (with branches and subscription status). **Clients depend on this shape.**
- Other auth routes: `/api/create-account`, `/api/refresh-token` (body `refresh_token`), `/api/logout`, `/api/auth-check`, `/api/my-companies`, `/api/role-access`.
- **There is no password-reset or forgot-password flow.** Confirm where passwords change (employee "login details" flow via employee-service → auth-service internal API).
- No login rate limit, no lockout, no security event log.

### Attack surface found

- **Broken object-level authorization (BOLA):** many routes take `zodu_id` / `branch_id` from **params, query or body**. Examples: `PUT /api/company/:zodu_id` and `GET /get/branches/:zodu_id` (restaurant), `/api/settings/:zodu_id/:branch_id` (auth), `GET /api/sales/:id?zodu_id=&branch_id=`. Any caller can pass another company's id.
- **Internal endpoints are public:** services call each other on `/internal/*` with no auth. The gateway proxies whole prefixes, so **`/restaurant/internal/*`, `/retail/internal/*` etc. are reachable from the internet.**
- **Open file routes:** unauthenticated `GET /file/*` and `DELETE /delete/file/:name` exist. These are fixed by the file-service prompt; here, make sure they are at least blocked at the gateway.
- **Dynamic SQL:** queries are mostly parameterized. Some interpolate values: `ORDER BY o.created_at ${order}` (restaurant `dashboard-repo.js`), `stock_qty ${operator} $1` (`inventory-repo.js`), `${having}`, and dynamic `SET` lists (`sets.join(', ')`). Each must be checked against a whitelist.
- **No pagination caps:** `limit = parseInt(req.query.limit)` with no maximum.
- **Mass assignment risk:** updates that build columns from `req.body`.
- **Secrets in git:** `docker-compose.uat.yml` / `docker-compose.prod.yml` contain the DB password, MinIO keys and `APP_SECRET` in plain text.
- **Dependencies:** `multer` 1.x (known vulnerabilities), both `bcrypt` and `bcryptjs`, both `joi` and `@hapi/joi`.

### Clients

- React (Vite) web, Electron desktop, Flutter mobile.
- They send `Authorization: Bearer <access_token>` and **no** platform header. Refresh uses `body.refresh_token`.

---

## Part A: auth-service (tokens, login, sessions)

### A1. Signing keys

- **ES256** key pair. The private key exists **only** in auth-service, loaded from env / secret manager (`JWT_PRIVATE_KEY`, `JWT_KID`). Never commit it.
- Publish public keys at `GET /.well-known/jwks.json` (gateway: `/auth/.well-known/jwks.json`). Support a previous key (`JWT_PREVIOUS_PUBLIC_KEY`, `JWT_PREVIOUS_KID`) during rotation.
- Document the **key-rotation procedure** (generate, publish both, switch signing, remove old after 15 min + clock skew).
- Use `jose` (ESM-only; Node 24 supports `require()` of ESM, so keep the services CommonJS).

### A2. Access token (RFC 9068 profile)

- JWT, **15 minutes**, header `typ: "at+jwt"` and `kid`.
- Claims:

  | Claim | Value |
  |---|---|
  | `sub` | user_id |
  | `zid` | active zodu_id |
  | `bid` | active branch_id |
  | `role` | role_name for that company/branch |
  | `perms[]` | from `tbl_access_control` + `tbl_modules` |
  | `utype` | user_type |
  | `plt` | web, desktop or mobile |
  | `sid` | session family id |
  | `iss`, `aud`, `iat`, `nbf`, `exp`, `jti` | standard |

- **Never put PII or secrets in the token:** no email, phone, GSTIN, PAN, bank details or salary.
- **Multi-company users:** add `POST /api/switch-context {zodu_id, branch_id}` (authenticated). It verifies membership through `tbl_user_companies` / `tbl_user_roles` and returns a new access token **in the same session family**. Login picks the primary company and the user's default branch, matching current behaviour; document the rule.

### A3. Refresh token (RFC 9700 rotation)

- Random **48-byte opaque** string (`crypto.randomBytes`), base64url. Store only its **SHA-256 hash** in **Redis**, 30-day TTL. Add Redis to compose.
- **Rotate on every use, single-use** (`GETDEL`).
- **Families:** one per device login. **Reusing an already-used token revokes the whole family** and writes a security event.
- Keep a set of families per user so `revokeAllForUser(userId)` works.
- **Absolute session lifetime** of 90 days (re-login required even with continuous use). The idle timeout is the 30-day TTL.
- Keep writing a row to `tbl_user_sessions` (ip, user agent, platform, created, last used, revoked), **without the token**, so sessions can be listed and audited. Drop the plaintext `refresh_token` column in a migration once the legacy path is removed.

### A4. Endpoints

Keep the existing paths and the **snake_case response shape**, so clients only change token handling.

- **Platform header:** every auth endpoint accepts `X-Client-Platform: web|desktop|mobile`. Add `AUTH_REQUIRE_PLATFORM_HEADER` (default `false` until the client releases ship). While it is false, a missing header means body mode, logged as a warning.
- **`POST /api/login {email | phone_number, password}`**
  - Validate with Joi (max lengths on every field; password max 128).
  - **Passwords:** verify bcrypt **or** argon2id. After a successful bcrypt login, **rehash to argon2id**. No user is locked out by the migration.
  - **Unknown account:** verify against a **real, valid argon2id dummy hash** generated at startup, so timing is identical.
  - **One generic error** for unknown account, wrong password, inactive, deleted or `login_user=false`: "Invalid email/phone or password". Log the real reason as a security event.
  - **Brute force:** per-IP rate limit (e.g. 20/min), and per-identifier lockout of 15 minutes after 5 failures (Redis). Also limit failures per identifier across IPs (credential stuffing). Return 429 with `Retry-After`.
  - Keep the extra login data (`user`, `companies`). Only the token fields change.
  - **web:** refresh token in cookie `rt` (`HttpOnly; Secure; SameSite=Strict; Path=/auth/api`, the public path through the gateway). The body contains `access_token`, `expires_in` and the user/companies data.
  - **desktop / mobile:** the body also contains `refresh_token`. Document secure client storage: Flutter `flutter_secure_storage`; Electron `safeStorage` / OS keychain, never `localStorage`.
- **`POST /api/refresh-token`**
  - web reads the cookie; desktop and mobile read `body.refresh_token`.
  - Reject if the platform differs from the session's.
  - **Reload the user and roles from the DB**, so `is_active=false`, `is_deleted`, `login_user=false` and role changes apply within 15 minutes.
  - Same response shape as login.
  - **Legacy migration:** an old HS256 refresh JWT that verifies **and** matches a non-revoked `tbl_user_sessions` row gets new tokens once, and the old row is revoked. This path is removed after `LEGACY_REFRESH_CUTOFF` (env date).
- **`POST /api/logout`:** revoke the family and clear the cookie (same attributes, `Max-Age=0`).
- **`POST /api/logout-all`** (authenticated): `revokeAllForUser`.
- **`GET /api/sessions`** and **`DELETE /api/sessions/:sid`** (authenticated): list and revoke the user's own sessions/devices.
- **`POST /api/create-account`:** per-IP rate limit, Joi validation, the same password policy, and argon2id for new accounts.
- **`GET /api/auth-check`, `/api/my-companies`, `/api/role-access`:** move to the new middleware.

### A5. Passwords (NIST SP 800-63B)

- Minimum length 8 (12 for owner/Admin). Allow at least 64 characters. **No composition rules.**
- Reject passwords found in a **breached / common list** (ship an offline top-100k list; no external calls).
- Apply this to signup, employee login-details (employee-service → auth-service internal) and any password change.
- **Revoke all sessions** (`revokeAllForUser`) on:
  - password change;
  - employee deactivation, `login_user=false`;
  - role or access change (to force fresh perms);
  - company/branch deletion (the purge clients).
- **No reset flow exists.** Do not build one now; leave a documented design (single-use, hashed, 15-minute reset token; generic "if the account exists" response; revoke all sessions after reset).

### A6. 2FA extension point

Leave a `requires_2fa` step in the login flow (TOTP, RFC 6238), to be required later for the company owner / Admin role. No UI work now.

### A7. Security event log

Add `tbl_security_events`: user_id, zodu_id, event, ip, user agent, platform, details jsonb, created_at.

Events: login success/fail, lockout, refresh reuse detected, logout-all, session revoked, password changed, permission denied (sampled), cross-tenant attempt.

**Never log passwords, tokens or full request bodies.**

---

## Part B: shared security package (every Node service)

Create `packages/zodu-security/` (CommonJS). Choose **one** way to ship it into each image and apply it everywhere:
- (a) npm workspaces plus Dockerfiles built from the repo root (`build.context: .`); or
- (b) a private npm registry.

Explain the choice and update every Dockerfile and compose file. **Do not copy the code into each service.**

### B1. `authenticate()`

- `jose.createRemoteJWKSet` (cached, with cooldown), fetching JWKS from auth-service over the **internal network**.
- Pin **`algorithms: ['ES256']`**, and require `iss`, `aud`, `typ: at+jwt`, `exp` and `nbf`, with ≤ 30s clock tolerance.
- Reject `alg: none`, HS256, and tokens with an unknown `kid`.
- Set `req.auth = { userId, zoduId, branchId, role, perms, userType, platform, sessionId }`.
- Responses: 401 with `WWW-Authenticate: Bearer` on failure; 503 if the JWKS is unreachable. Use each service's error format.
- **Revocation:** optionally check a Redis deny-list of `sid`s revoked in the last 15 minutes (`AUTH_CHECK_REVOKED_SESSIONS=true`), so logout-all and deactivation apply immediately.

### B2. Authorization (prevents OWASP API5, broken function-level authorization)

- `requirePermission(...perms)` and `requireRole(...roles)`.
- Permission names come from `tbl_modules` + `tbl_access_control`: `<module_slug>:<read|create|edit|delete>`, e.g. `purchase:create`, `expense:read`, `employee:edit`, `menu:delete`, `report:read`.
- Generate the slug list from the real `tbl_modules` rows into a constant in the package, and document it.
- Add explicit permissions where no module exists (e.g. `gst:export`, `settings:edit`, `company:edit`, `branch:delete`). List them separately so I can add them to `tbl_modules`.
- **Owner bypass:** find how the company owner is represented (the account created in `CreateAccount`, the `Admin` role, or both), document it, and allow the bypass **only inside the owner's own `zid`**.
- **Default deny:** a route without an explicit `requirePermission` (or an explicit `allowAuthenticated()`) must fail a startup check that lists every router's routes.

### B3. `requireInternal()` (service-to-service)

- Each calling service has its own token (`INTERNAL_TOKEN_<CALLER>`), sent as `X-Internal-Token` and compared with `crypto.timingSafeEqual`. The receiver knows **which** service called.
- Update every axios `/internal/*` call: auth ↔ employee, restaurant, retail; purge clients; seed-defaults; create-admin.
- **face-service (Python):** add the same check as a FastAPI dependency and keep it unexposed.
- Kafka / amqplib stay on the internal network; no change.

### B4. `applySecurity(app)`

- `helmet()` (API defaults) and `app.disable('x-powered-by')`.
- `trust proxy` set to the exact hop count (gateway + reverse proxy), so `req.ip` can't be spoofed through `X-Forwarded-For`.
- **CORS allowlist** from `CORS_ORIGINS`, `credentials: true`. Allow requests with no `Origin` (Flutter, Electron main process) and the Electron renderer origin. **Never `*` together with credentials.**
- `express.json({ limit: '100kb' })` and `urlencoded` with the same limit. Raise it **only** on routes that need more (find them).
- **Rate limits**, backed by Redis (shared across replicas):
  - global per IP;
  - per user for authenticated routes;
  - tighter limits on expensive routes (reports, exports, dashboards, bulk imports).
- **Request id** (`X-Request-Id`, generated if missing), passed to logs and internal calls.
- **Request timeout** and `server.headersTimeout` / `requestTimeout` set (slowloris).

### B5. `errorHandler`

- Never leak stack traces, SQL, `pg` error details, file paths or upstream errors.
- Map Joi errors → 400, auth → 401, permission → 403, not found / cross-tenant → **404**, conflicts → 409, rate limit → 429. Everything else → 500 with a request id.
- Log full details server-side with the service logger.

### B6. Validation helpers

- `validate({ params, query, body })` with Joi, `stripUnknown: true` and max lengths.
- **Pagination:** `limit` default 20, **max 100**; `page` / `offset` bounded.
- **Sorting:** `sort` / `order` only from a per-route whitelist (`ASC|DESC`, known columns). Never interpolate raw input into SQL.

---

## Part C: api-gateway hardening

- Replace `cors('*')` with the allowlist (same `CORS_ORIGINS`).
- **Block (return 404):** `/*/internal/*`, `/*/file/*`, `/*/delete/file/*`, and any path containing `..` or encoded slashes.
- Add `helmet`, a global per-IP rate limit (Redis), request id, a body size cap and request timeouts.
- `trust proxy` for the HTTPS reverse proxy in front; **HSTS** is set at that proxy (document it).
- Decide and document whether payroll-service should be proxied.
- The gateway does **not** verify JWTs itself (services do: defence in depth). It may optionally reject obviously malformed `Authorization` headers.

---

## Part D: per-service rollout (OWASP API Top 10 checklist)

For **every** service (employee → checklist → payroll → retail → restaurant, then the remaining auth-service routes), one PR each:

1. **Authentication on every route**, except the public allowlist: login, refresh-token, logout, create-account, JWKS, `/health`. `/internal/*` uses `requireInternal`.
2. **API1 BOLA (tenant isolation, critical).**
   - `zodu_id` and `branch_id` come **only from `req.auth`**, never from body, query or params.
   - Routes with `:zodu_id` / `:branch_id` in the path keep the path for client compatibility, but **return 404 if it differs from `req.auth`**. List these routes.
   - Every repository function takes `zodu_id` (and `branch_id` where the table has it) and uses it in the `WHERE` of every read, update and delete.
   - Updates and deletes match on `id + zodu_id (+ branch_id)`. **Return 404 when no row matches** (no difference between "not found" and "not yours").
   - Lookups by a bare id (`cust_uuid`, `api_order_id`, `menu_id`, `employee_id`, …) must also filter by tenant.
   - Multi-branch reports or dashboards check that the user may access each branch requested.
3. **API2 broken authentication:** done by Parts A and B. No route accepts a token from the query string.
4. **API3 broken object property-level authorization (mass assignment and data exposure).**
   - **Whitelist** updatable fields per route in the Joi schema.
   - Never build `SET` clauses from `Object.keys(req.body)`.
   - Never return `password_hash`, tokens, internal ids of other tenants, or bank / PAN data unless the route needs them and the permission allows it.
5. **API4 unrestricted resource consumption:** pagination caps, date-range caps on reports (e.g. ≤ 1 year), limits on bulk endpoints (row count), rate limits on exports.
6. **API5 broken function-level authorization:** `requirePermission` on every route (Part B2); admin-only actions (company/branch delete, role changes, settings) need the owner/Admin role.
7. **API6 sensitive business flows:** rate-limit and audit-log invoice cancellation, sale returns, payments / mark-payment, stock adjustments and price changes.
8. **API7 SSRF:** confirm no route fetches a user-supplied URL; if any does, allowlist hosts.
9. **API8 security misconfiguration:**
   - remove `app.use(cors())` from every service (the gateway and `applySecurity` handle CORS);
   - remove `console.log(req.file)` / debug logs of request data;
   - set `NODE_ENV=production` in images.
10. **API9 improper inventory:** produce **`docs/security/permissions-matrix.md`** listing every route (service, method, path, auth type, required permission, tenant scope). Remove dead or commented-out routes, and debug routes like the `/api/retail` catch-all if unused.
11. **API10 unsafe consumption of APIs:** validate responses from internal services (shape and tenant) before using them; add timeouts to every axios call.
12. **SQL injection:** audit every `${…}` inside SQL strings (`ORDER BY … ${order}`, `stock_qty ${operator}`, `${having}`, dynamic column lists). Each must come from a hard-coded whitelist; everything else uses `$n` parameters.

---

## Part E: secrets and dependencies

- **Move every secret out of `docker-compose.uat.yml` / `docker-compose.prod.yml`** into `env_file:` files that are not committed. Add a `.env.example` for every service.
- List every secret that must be **rotated** because it is in git history: DB password, MinIO keys, `APP_SECRET`, admin `APP_SECRET`.
- Give admin-service a secret that is never shared with customer services.
- Upgrade `multer` to 2.x. Remove duplicate libraries (`bcryptjs` vs `bcrypt`, `@hapi/joi` vs `joi`) where safe.
- Add `npm audit --omit=dev --audit-level=high` to CI for every service, and enable Dependabot / Renovate.

---

## Coordination with the file-service prompt

file-service currently reads `userId` / `zoduId` from today's HS256 token and `branchId` from an `X-Branch-Id` header, all inside one `getRequestContext(req)` function. In **Phase 2**, switch that function to `authenticate()` from the shared package (`req.auth.zoduId` / `branchId` from the token) and stop accepting `X-Branch-Id`.

---

## Tests (Jest + supertest; add the setup, since none exists)

Use real Redis and Postgres through docker compose in CI.

- **Login:**
  - success with email and with phone;
  - wrong password and unknown account return the **same message**, with similar timing (assert both run a hash);
  - lockout after 5 failures and 429 `Retry-After`;
  - bcrypt → argon2id rehash;
  - inactive, deleted and `login_user=false` users are rejected with the generic message.
- **Refresh:**
  - rotation;
  - reuse revokes the whole family;
  - platform mismatch rejected;
  - deactivated user rejected;
  - absolute lifetime enforced;
  - legacy HS256 refresh migrates once and fails the second time.
- **Tokens rejected:** expired, tampered signature, `alg: none`, HS256 signed with the public key, wrong `typ`, wrong `aud` / `iss`, unknown `kid`.
- **Switch-context:** refused for a company or branch the user doesn't belong to.
- **Access:**
  - for **each converted service**, at least one read, update and delete route with another tenant's id → 404, and another branch's id → 404;
  - a path `:zodu_id` that differs from the token → 404;
  - missing permission → 403;
  - owner bypass only inside the user's own `zid`.
- **Mass assignment:** extra body fields (`zodu_id`, `branch_id`, `is_active`, `role`) are ignored.
- **Pagination and sorting:** `limit=100000` is capped; `order=DESC;DROP TABLE` is rejected.
- **Internal routes:** `/internal/*` without a token → 401, with another service's token → 403, through the gateway → 404.
- **Hardening:**
  - CORS: an unknown origin gets no `Access-Control-Allow-Origin`;
  - security headers present;
  - 500 responses contain no stack trace or SQL.

---

## Phases (one PR each; stop after each)

1. **Foundation**
   - `packages/zodu-security` and the Dockerfile/compose build changes;
   - Redis;
   - secrets moved to env files, plus the rotation list;
   - gateway hardening (CORS, internal/file path blocking, headers, rate limit, request id);
   - `requireInternal` on every `/internal/*` route and updated axios callers (including face-service);
   - dependency upgrades.
2. **auth-service**
   - ES256 and JWKS, access-token claims, switch-context;
   - refresh families in Redis;
   - login hardening, argon2id rehash, password policy;
   - platform handling, legacy refresh migration;
   - session list/revoke, revocation hooks, security event log;
   - switch file-service's `getRequestContext`;
   - tests.
3. **Per-service rollout**, one PR per service: employee → checklist → payroll → retail → restaurant → remaining auth-service routes. Each covers Part D, its section of the permissions matrix, and its tests.
4. **Enforcement and cleanup:**
   - turn on `AUTH_REQUIRE_PLATFORM_HEADER` and `AUTH_CHECK_REVOKED_SESSIONS`;
   - remove the legacy HS256 refresh path after the cutoff;
   - drop the plaintext refresh-token column;
   - remove `GenerateSignature` / `ValidateSignature` and `APP_SECRET` from customer services.

**Client coordination.** List the exact changes per platform (web, Electron, Flutter):
- send `X-Client-Platform`;
- web: refresh via the cookie (`credentials: 'include'`);
- desktop / mobile: refresh via body, with secure storage;
- handle 401 → refresh once → retry, otherwise go to login;
- call switch-context on company or branch change;
- send no `zodu_id` / `branch_id` in requests (they are ignored).

Phases 3–4 must not ship until the matching client builds are released.

## Report at the end of each phase

- Every file changed or added.
- Every new env var (per service) and every secret that needs rotating.
- Every route you **could not secure automatically**, and why (e.g. a cross-branch report, a print-bridge or face-service call, a public endpoint).
- Every SQL interpolation you found and how you fixed it.
- Anything in section 0 that turned out to be wrong.
