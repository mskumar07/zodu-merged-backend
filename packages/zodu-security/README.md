# @zodu/security

Shared security middleware for the Zodu Node services. CommonJS, Node 24.

| Export | What it does |
|---|---|
| `requireInternal(...callers)` | Guards `/internal/*`. 401 without a known service token, 403 when the calling service isn't one of `callers` (none listed = any known service). Sets `req.internalCaller`. |
| `createInternalAuth({ tokens, respond })` | Same, with explicit tokens or another error format (file-service). `identify(req)` returns the caller or `null`. |
| `createInternalHttp(axios, { baseURL, timeout })` | axios instance for calls to other services' `/internal` routes: adds `X-Internal-Token` and `X-Request-Id`, 10s timeout by default. |
| `internalHeaders()` | The same headers, for `fetch`. |
| `applySecurity(app, opts)` | helmet, no `x-powered-by`, exact `trust proxy`, request id, CORS allowlist, per-IP rate limit, 100kb JSON / urlencoded bodies. |
| `createRateLimit({ name, limit, windowMs, redis, key })` | Fixed-window limit shared through Redis; 429 with `Retry-After`. Lets requests through if Redis is down. |
| `requestId()` / `currentRequestId()` | `X-Request-Id` in and out, available to internal calls made while handling the request. |
| `setServerTimeouts(server)` | `headersTimeout`, `requestTimeout`, `keepAliveTimeout` (slowloris). |
| `createAccessTokenVerifier(opts)` | Checks customer access tokens: ES256 only, `typ: at+jwt`, `iss` / `aud` / `exp` / `nbf` (30s tolerance), key by `kid` from auth-service's JWKS (cached, refetched for an unknown kid). `verify(token)` → `req.auth` shape; rejects with `TokenError` 401, or 503 when the keys can't be fetched. |
| `createAuthenticate({ verifier?, respond, ...opts })` | Express middleware on top: `Authorization: Bearer` only, sets `req.auth = { userId, zoduId, branchId, role, perms, userType, platform, sessionId, tokenId, expiresAt }`, 401 with `WWW-Authenticate`, 503. `respond(req, res, status, message)` keeps the service's error body. |
| `createAuthorize({ respond })` | `requirePermission(...perms)` (all required), `requireRole(...roles)`, `allowAuthenticated()`. The `Admin` role passes permission checks inside its own company. |
| `MODULE_SLUGS`, `EXTRA_PERMISSIONS`, `permsFromAccessRows()` | Permission names `<slug>:<read\|create\|edit\|delete>` from `tbl_modules` (see `docs/security/auth.md`). |

Still to come: the error handler and validation helpers (per-service rollout).

## Access tokens

```js
const { createAuthenticate, createAuthorize } = require('@zodu/security');
const respond = (req, res, status, message) => res.status(status).json({ error: message });
const { authenticate } = createAuthenticate({ respond });   // JWKS from AUTH_SERVICE_URL
const { requirePermission } = createAuthorize({ respond });

router.post('/api/purchase', authenticate, requirePermission('purchase:create'), handler);
// handler: company and branch from req.auth.zoduId / req.auth.branchId, never from the request
```

| Env var | Meaning |
|---|---|
| `AUTH_SERVICE_URL` | JWKS at `<url>/.well-known/jwks.json` (internal network) |
| `AUTH_JWKS_URL` | overrides that URL |
| `AUTH_CHECK_REVOKED_SESSIONS` | `true`: also refuse sessions revoked in the last 15 min (pass `redis`, same Redis as auth-service) |
| `JWT_ISSUER` / `JWT_AUDIENCE` | defaults `zodu-auth` / `zodu-api` |

`jose` is ESM-only; Node 24 loads it with `require()`. Jest needs
`node --experimental-vm-modules node_modules/jest/bin/jest.js` for that.

## Service-to-service tokens

Each calling service has **its own** token. The caller sends it as
`X-Internal-Token`; the receiver lists the tokens it accepts, so it knows which
service called, and a leaked token names its source and can be rotated alone.

| Env var | Where | Meaning |
|---|---|---|
| `INTERNAL_TOKEN` | caller | this service's token, sent on every internal call |
| `INTERNAL_TOKEN_<CALLER>` | receiver | token of a service allowed to call it (`INTERNAL_TOKEN_AUTH`, ...) |

Tokens shorter than 32 characters are ignored. `scripts/gen-secrets.sh` writes
them for every service (see `docs/security/README.md` for who calls whom).

## How it gets into each image

Each service depends on it as a local package, installed **as a copy**, not a link:

```json
"dependencies": { "@zodu/security": "file:../packages/zodu-security" }
```

with `install-links=true` in the service's `.npmrc`. The package and its own
dependencies then sit in the service's `node_modules` and lockfile like any other
dependency. Dockerfiles build from the repository root so the package can be copied in:

```bash
docker build -f auth-service/Dockerfile -t <image> .
docker compose -f docker-compose.uat.yml build
```

Why not npm workspaces: they would replace the services' nine lockfiles with
one root lockfile, re-resolving every dependency of every service at once
(express 4 and 5, two joi lines, ...). With the file dependency each service
keeps its own lockfile, and adding the package changed only its own entries.
There is no private registry to publish to, so option (b) is out.

**After changing this package:** run `npm install` in each service that uses
it, so its copy and lockfile pick up the change. `npm ci` fails if a lockfile is
out of date, which stops a stale image from being built.

## Tests

```bash
npm install && npm test     # jest + supertest, no infrastructure needed
```
