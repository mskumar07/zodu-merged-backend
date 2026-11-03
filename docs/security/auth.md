# Customer authentication

How auth-service signs users in, what the tokens contain, and how the other
services check them. Service-to-service tokens are in [README.md](README.md).

## Overview

| | |
|---|---|
| Access token | JWT, **ES256**, header `typ: at+jwt` + `kid`, **15 minutes** (`ACCESS_TOKEN_TTL_SECONDS`) |
| Refresh token | 48 random bytes, base64url (64 characters), opaque; only its SHA-256 is stored, in Redis |
| Session | one *family* per device login; id = `sid` claim = `tbl_user_sessions.session_id` |
| Idle / absolute lifetime | 30 days without a refresh (`REFRESH_IDLE_DAYS`) / 90 days in all (`SESSION_MAX_DAYS`) |
| Public keys | `GET /.well-known/jwks.json` on auth-service; `/auth/.well-known/jwks.json` through the gateway |
| Verification | `@zodu/security` `createAccessTokenVerifier()` / `createAuthenticate()` in every service |

`APP_SECRET` no longer signs anything. auth-service keeps it only to accept the
old HS256 refresh tokens once (see [Migration](#migration-from-hs256)); file-,
restaurant- and retail-service no longer read it.

## Access token claims

| Claim | Value |
|---|---|
| `sub` | user_id |
| `zid` | active company (zodu_id) |
| `bid` | active branch_id (absent if the company has no branch the user may use) |
| `role` | role name in that company/branch |
| `perms` | `<module>:<read\|create\|edit\|delete>` and extras, see [Permissions](#permissions) |
| `utype` | user_type |
| `plt` | `web`, `desktop`, `mobile`, or `unknown` (client sent no `X-Client-Platform`) |
| `sid` | session family id |
| `iss` `aud` `iat` `nbf` `exp` `jti` | `zodu-auth`, `zodu-api`, standard |

No email, phone, GSTIN, PAN, bank details or salary, ever.

Services read the company and branch **only** from the token (`req.auth.zoduId`,
`req.auth.branchId`), never from the body, query, path or an `X-Branch-Id`
header. file-service does this now; the other services move over in Phase 3.

## Endpoints

All under `/auth/api` through the gateway. Response bodies keep the old
snake_case shape: `{ data: { access_token, expires_in, refresh_token?, user, companies, context } }`.

| Route | Auth | Notes |
|---|---|---|
| `POST /login` | – | `{ email \| phone_number, password }`. 20/min per IP; 5 failures per account in 15 min → 429 + `Retry-After` |
| `POST /refresh-token` | refresh token | rotates; same response as login. 60/min per IP |
| `POST /logout` | refresh token | revokes that session, clears the cookie |
| `POST /logout-all` | access token | revokes every session of the user |
| `GET /sessions` | access token | the user's devices (platform, ip, user agent, created, last used, `current`) |
| `DELETE /sessions/:sid` | access token | revoke one of them; another user's sid → 404 |
| `POST /switch-context` | access token | `{ zodu_id, branch_id? }` → new access token, same session |
| `POST /create-account` | – | 5/min per IP; owner password policy |
| `GET /auth-check`, `/my-companies`, `/role-access` | access token | |

### Platform and where the refresh token travels

Clients send `X-Client-Platform: web | desktop | mobile` on every auth call.

- **web:** the refresh token is set as cookie `rt`
  (`HttpOnly; Secure; SameSite=Strict; Path=/auth/api`) and is **not** in the body.
  Refresh with `credentials: 'include'` and no body. Logout clears the cookie
  (same attributes, `Max-Age=0`).
- **desktop / mobile:** the refresh token is in the body; send it back as
  `{ refresh_token }`. Store it securely:
  - Flutter: `flutter_secure_storage` (Keychain / Android Keystore);
  - Electron: `safeStorage` (or the OS keychain via `keytar`), in the main
    process. **Never `localStorage`**, which any script in the renderer can read.
- **no header** (current app builds): treated as body mode, platform `unknown`.
  The session takes the platform of the first refresh that sends one.
  `AUTH_REQUIRE_PLATFORM_HEADER=true` (Phase 4) refuses requests without it.

A session is bound to its platform: refreshing a desktop session with
`X-Client-Platform: mobile` is refused (and doesn't burn the token).

### Refresh rotation and reuse

Every refresh returns a **new** refresh token; the old one is dead. If an
already-used token comes back:

- within `REFRESH_REUSE_GRACE_SECONDS` (30s): it gets the **same** successor.
  This covers several requests that hit an expired access token at once and
  all refresh with the same token (the web client has no single-flight lock);
- later: the whole family is revoked (`refresh_reuse_detected` event). The
  thief and the real user both have to sign in again.

Every refresh reloads the user and roles from the database, so deactivation,
`login_user=false` and role changes reach the token within 15 minutes, and at
once where sessions are revoked (below).

### Session revocation

`revokeAllForUser` runs on:

- password change (employee login details);
- employee deactivated, `login_user=false`, login removed;
- role changed or deleted (users of that role), employee's role changed;
- company or branch deleted (every user of the company).

Revoking deletes the refresh family and writes `revoked:sid:<sid>` to Redis for
16 minutes. Services with `AUTH_CHECK_REVOKED_SESSIONS=true` (and the same
Redis) refuse the session's access tokens at once; otherwise they expire
within 15 minutes.

## Context rule (company and branch)

At **login**:

1. company: the user's primary company (`tbl_user_companies.is_primary`), else the first;
2. branch: among the company's active branches the user may use (all of them
   for the `Admin` role or a role without a branch, else the branches of the
   user's roles), `B1` if allowed, else the first;
3. role: `Admin` if the user has it there, else the role for that branch, else
   a company-wide role.

On **refresh** the session keeps its company/branch, re-checked against the
current roles (a branch no longer allowed falls back as in step 2).

**`POST /switch-context`** checks membership (`tbl_user_companies`) and branch
access exactly as above. A company the user isn't in, or a branch they can't
use or that doesn't exist, returns **404** and records `cross_tenant_attempt`.
Clients call it whenever the user changes company or branch.

## Permissions

`perms` comes from `tbl_access_control` + `tbl_modules`: one entry per granted
action, any role granting it wins. Slugs (`packages/zodu-security/src/permissions.js`):

| tbl_modules.module_name | slug |
|---|---|
| Dashboard | `dashboard` |
| Billing | `billing` |
| Menu Items | `menu` |
| Purchase | `purchase` |
| Sales History | `sales` |
| Expense | `expense` |
| Inventory | `inventory` |
| Customer Management | `customer` |
| Staff / User Management | `employee` |
| Attendance | `attendance` |
| Reports | `report` |
| Checklist / Tasklist | `checklist` |
| Settings | `settings` |

Extras with no module row (granted to the owner through the bypass for now):
`company:edit`, `company:delete`, `branch:create`, `branch:edit`,
`branch:delete`, `role:read`, `role:edit`, `gst:export`.

**Owner bypass:** the role named `Admin` passes every `requirePermission` check,
but only inside the token's own company, because services take `zodu_id` from
the token. A custom role named "Owner" gets no bypass.

## Passwords

NIST SP 800-63B:

- at least 8 characters (owner/Admin included); at most 128; no composition rules;
- refused if in the offline common-password list
  (`auth-service/data/common-passwords.txt`, 46,483 entries of 8+ characters
  from SecLists' NCSC top 100k);
- applies to sign-up, employee login details and every password change;
- hashed with **argon2id** (m=19456 KiB, t=2, p=1). bcrypt hashes still verify
  and are rehashed to argon2id at the next successful login;
- unknown accounts are checked against a real dummy argon2id hash, so the
  response time doesn't reveal whether an account exists. Wrong password,
  unknown, inactive, deleted and `login_user=false` all return
  "Invalid email/phone or password"; the real reason is in the security log.

### Forgot password

`auth-service/src/services/password-reset-service.js`, codes in Redis
(`src/auth/password-reset.js`), delivery in `src/notify/`. Public routes, per-IP
limit (`PASSWORD_RESET_RATE_LIMIT_PER_MIN`, default 10) plus the gateway's auth limit.

1. `POST /api/forgot-password { email } | { phone_number }`: a 6-digit code
   (`crypto.randomInt`) to that email (SMTP, from `noreply@zodu.in`) or phone
   (Twilio SMS). Always 200 "If an account uses this email or phone number, a
   code has been sent", whether the account exists, is disabled or not; the code
   is sent after answering, so the timing doesn't differ. One request per
   identifier per 60 s and 5 per hour (429 + `Retry-After`, unknown accounts too).
2. `POST /api/forgot-password/verify { email | phone_number, otp }`: code valid
   10 minutes, stored salted-hashed, compared in constant time, single use; a new
   request replaces it; 5 wrong tries delete it. Returns `reset_token` (32 random
   bytes, 10 minutes, only its SHA-256 is a Redis key).
3. `POST /api/reset-password { reset_token, new_password }`: password policy
   (checked before the token is used up), argon2id, token used (`GETDEL`),
   **every session revoked**, login lockout cleared.

Codes are never logged, except when the channel isn't configured outside
production (local testing). Events: `password_reset_requested`,
`password_reset_delivery_failed`, `password_reset_code_failed`,
`password_reset_code_verified`, `password_reset`.

### Two-factor (extension point)

`secondFactorRequired(user, ctx)` in `session-service.js` is called after the
password check and returns `false` today. To add TOTP (RFC 6238) for owners /
Admins: return `true` for them, answer the login with `{ requires_2fa: true,
challenge }` (a short-lived, single-use challenge in Redis) instead of tokens,
and add `POST /api/login/2fa { challenge, code }` that issues the tokens.

## Security events

`tbl_security_events` (user_id, zodu_id, event, ip, user_agent, platform,
details jsonb, created_at). Written without blocking the request. Events:
`login_success`, `login_failed` (reason), `login_blocked`, `lockout`,
`refresh_refused`, `refresh_reuse_detected`, `legacy_refresh_migrated`,
`logout_all`, `session_revoked`, `password_changed`, `password_reset*` (above),
`cross_tenant_attempt`.
`permission_denied` (sampled) comes with `requirePermission` in Phase 3.
Passwords, tokens and request bodies are never logged.

## Signing key rotation

The private key exists only in auth-service (`JWT_PRIVATE_KEY`, `JWT_KID`;
`scripts/gen-secrets.sh` creates the first one). Verifiers cache the JWKS for
10 minutes and refetch at once (at most every 30s) when they see an unknown `kid`.

1. **Generate** a new key:
   `openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 | openssl base64 -A`
   and pick a new kid, e.g. `prod-20270115`.
2. **Publish both and switch signing** in one deploy of auth-service:
   - `JWT_PRIVATE_KEY` / `JWT_KID` = the new key;
   - `JWT_PREVIOUS_PUBLIC_KEY` = the old **public** key
     (`echo "$OLD" | openssl base64 -d -A | openssl pkey -pubout | openssl base64 -A`),
     `JWT_PREVIOUS_KID` = the old kid.

   New tokens carry the new kid; verifiers fetch it on first sight. Tokens
   signed with the old key still verify through the previous key.
3. **Wait** 15 minutes (token lifetime) + 30 seconds (clock tolerance), plus
   the time the deploy took to roll out.
4. **Remove** `JWT_PREVIOUS_PUBLIC_KEY` / `JWT_PREVIOUS_KID` and redeploy.

If the key leaked, skip the wait: deploy step 2 **without** the previous key.
Every access token in flight is then refused (401); clients refresh and carry
on, since refresh tokens don't depend on the signing key. Nobody has to sign in again.

## Migration from HS256

Until `LEGACY_REFRESH_CUTOFF` (ISO date; empty = still open), an old refresh
JWT is exchanged **once** for a new session if it verifies with `APP_SECRET`
**and** matches a non-revoked `tbl_user_sessions` row. The row is revoked
(`migrated`). Parallel requests with the same old token share the new session.
Old HS256 **access** tokens are refused everywhere; clients get a 401, refresh,
and carry on.

Phase 4: set the cutoff, remove the legacy path and `APP_SECRET`, drop the
plaintext `tbl_user_sessions.refresh_token` column.

## Client changes (web, Electron, Flutter)

| Change | Needed for |
|---|---|
| Send `X-Client-Platform` on every auth call | cookie mode (web), Phase 4 enforcement |
| web: refresh via the cookie (`credentials: 'include'`, no body); stop storing the refresh token | cookie mode |
| desktop / mobile: keep the refresh token in secure storage (above) | |
| 401 → refresh **once** → retry; if the refresh fails, go to login. Do this for **every** API client, including the raw axios calls in invoice/POS settings and roles (they break 15 minutes after login today) | 15-minute tokens (now) |
| Treat the refresh token as opaque (64 characters, not a JWT) | now |
| Call `/api/switch-context` when the user changes company or branch, and use the returned token | file-service (now), all services (Phase 3) |
| Stop sending `zodu_id` / `branch_id` / `X-Branch-Id`: they are ignored | Phase 3 |
| Sign-up form: owner passwords need 8+ characters | now |
| Allow `CORS_ORIGINS` for the web app and the Electron origin | gateway |
