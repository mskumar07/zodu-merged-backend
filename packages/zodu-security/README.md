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

Still to come: `authenticate()` (ES256 access tokens via JWKS, auth phase),
`requirePermission()`, the error handler and validation helpers (per-service rollout).

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
