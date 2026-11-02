You are a senior Node.js backend engineer. Build a central **file-service** for **Zodu**, our multi-tenant restaurant / retail billing SaaS, in the repo `C:\Zodu\latest\zodu-merged-backend`. Then move every service's file handling onto it.

The design is already proven in the POC at **`C:\Zodu\latest\poc\minio-storage-poc`**. **Read the whole POC first and reuse its code and rules.** Do not redesign the folder layout, the type checks or the security rules. Your job is to turn the POC into a production service that fits this repo, and to migrate the existing services and files onto it.

Work in the **phases** at the end, one branch and PR each. **Stop after each phase** and report before starting the next.

---

## 1. The POC: what to reuse

| POC file | Reuse as |
|---|---|
| `src/storage/modules.js` | **Module registry** (scope, allowed types, size limit, categories, date folders). Copy it, then extend it with the modules in section 3. |
| `src/storage/key-builder.js` | **Key layout and ownership check.** Copy it unchanged apart from the new modules. |
| `src/storage/file-inspector.js` | **Content inspection**, as-is: type detected from the bytes, extension must match the content; PDF JavaScript, Office macros/ActiveX/DDE/OLE, zip bombs and CSV formula injection rejected; SVG/HTML never allowed. |
| `src/storage/media-service.js` | Upload (all-or-nothing batches with rollback), presigned GET, stream, list, delete, `safeFileName`, `contentDisposition` (RFC 5987). Adapt it to save `tbl_files` rows (section 4). |
| `src/routes/media.js` | Multer limits (`defParamCharset: 'utf8'`, file, field and part limits), `files` / `file` fields, upload rate limit |
| `src/server.js` | Hardening headers, error mapping (multer errors → 4xx, no internals leaked on 500) |
| `test/*.test.js` | Port all tests and keep them green |

**Not reused:**
- `middleware/auth.js` (the header-based fake auth) → section 5.
- `middleware/rate-limit.js` (in-memory) → a shared store, section 7.
- The `/media-file/tree` and `/setup-structure` demo routes → do **not** expose them.

### Storage layout (must stay exactly like the POC)

```
{bucket}/
└── {zoduId}/
    ├── _shared/{module}/{entityId}[/{category}]/{uuid}.{ext}                      ← tenant-wide
    └── {branchId}/{module}/{entityId}[/{category}][/{yyyy}/{mm}]/{uuid}.{ext}     ← per branch
```

Examples:

```
Z001/B1/expense/EXP1001/3f6c…e1.png
Z001/B1/employee/EMP7/profile/9a2b…44.png
Z001/B1/checklist/CHK3001/2026/10/c1d2…77.png
Z001/_shared/branding/LOGO/77aa…01.png
```

Rules (already enforced by the POC code):
- Only IDs in the path (`[A-Za-z0-9_-]{1,64}`).
- Branch IDs may not start with `_` (reserved for `_shared`).
- The file name is a UUID, with the extension taken from the **detected** type. The user's file name is never in the key; it's kept as metadata and in the DB.
- "Folders" are never created; they appear from the keys. There is no "folder exists?" check.
- **Before you start, confirm the real `zodu_id` and `branch_id` formats** in auth-service (`getNextZoduId`, `createBranch`) all pass `SAFE_ID`.

---

## 2. The repo today: verify each point before relying on it

**Conventions.**
- All services are Node 24, **CommonJS**, Express 4, raw `pg` (no ORM).
- Layering: `src/api/*-controller.js` → `src/services/*` → `src/repository/*` → `src/database/connection.js`.
- Validation: Joi (`src/schema/`). Errors: `src/utils/error/*`. Logging: pino or winston.
- Migrations are idempotent `.sql` files in `<service>/migrations/`, registered in `scripts/apply-migrations.sh` (tracked in `tbl_schema_migrations`).
- Each service has its own database and a Dockerfile that builds from its own folder.
- **Follow these conventions in file-service.**

**Gateway.** `api-gateway/gateway.js` proxies `/auth`, `/retail`, `/employee`, `/restaurant`, `/checklist` and `/admin`. Add `/files`.

**Auth today.**
- auth-service signs **HS256** tokens with `APP_SECRET` (`GenerateSignature`). The payload is `user_id, zodu_id, user_type, email, phone`. **There is no `branch_id` in the token.**
- Only auth-service checks tokens (`ValidateSignature`). employee, restaurant, retail and checklist routes are **unauthenticated**.
- A user can belong to several companies (`tbl_user_companies`) and has roles per company and branch (`tbl_user_roles`, `tbl_access_control`, `tbl_modules`).

**File handling today.** Each service has its own copy of the MinIO code. Everything sits in one bucket `zodu`, and DB rows store **full public URLs** (`PUBLIC_FILE_BASE_URL/...`).

| Service | Upload points | Key written today | Stored in |
|---|---|---|---|
| auth-service | company logo, invoice signature, watermark, receiver signature (`utils/minio.js`, `auth-controller.js`) | `{prefix}-{timestamp}.{ext}` at bucket root | `tbl_business.company_logo_url`; invoice settings `signature_url`, `watermark_url`, `receiver_signature_url` |
| employee-service | `POST /api/employees/:id/documents` | `employee-docs/{id}/{ts}-{originalname}` (images → webp) | `tbl_employee_documents.file_url` (the profile photo is derived from it) |
| checklist-service | `POST /api/checklists/:id/attachments` (5 files); admin item files | `checklist-attachments/{id}/{ts}-{originalname}` | JSONB `file_url` arrays in `tbl_checklist_attachments` and checklist items |
| restaurant-service | menu `menu_image`, `product_image`, generic `POST /upload` and `/upload/multiple`, expense and purchase-order `attachment_url` | `{ts}-{originalname}` **at bucket root** (images → webp via sharp, PDFs recompressed with pdf-lib) | `menu_image`, JSONB `attachment_url` on expense and purchase |
| retail-service | same as restaurant, plus customer `mark-payment` attachments | same | same, plus payment attachments |
| employee-service face photos | `POST /api/attendance/face` | **not stored** (sent to face-service for an embedding) | — keep it that way |

Files are served by **unauthenticated** `GET /file/:name` (auth, employee, restaurant, retail) and `GET /file/*` (checklist). restaurant, retail and checklist also have unauthenticated `DELETE /delete/file/:name`. restaurant's `/file/:name` sends `Cache-Control: public, max-age=31536000, immutable`.

**Clients.** React (Vite) web, Electron desktop and Flutter mobile all display images by putting the stored URL straight into `<img src>` / `Image.network`. Invoice templates and printing (print-bridge) also use the stored logo and signature URLs directly.

Grep for anything this table misses (`minio`, `putObject`, `multer`, `sharp`, `pdf-lib`, `_url`, `file_url`, `/file/`), add it to the table and tell me.

---

## 3. Module registry for production

Start from the POC's `modules.js` and adjust it to the real upload points. Each module needs: `scope`, `allowedTypes`, `maxSizeMb`, `categories`, `datePartition`, plus two new fields:
- **`access`**: `'private'` (presigned or authorised stream only) or `'link'` (see section 6);
- **`permission`**: the `tbl_modules` module the caller needs (read for download, create for upload, delete for delete).

| Module | Scope | Types | Max | Categories | Date folders | Access | Replaces |
|---|---|---|---|---|---|---|---|
| `branding` | tenant | images | 2MB | `logo` | – | link | company logo |
| `invoice-settings` | branch | png, webp, jpg | 1MB | `signature`, `watermark`, `receiver-signature` | – | link | invoice settings images |
| `menu-items` | branch | images | 5MB | – | – | link | menu and product images |
| `expense` | branch | images + docs | 10MB | – | yes | private | expense attachments |
| `purchase` | branch | images + docs | 10MB | `order`, `bill` | yes | private | purchase and purchase-order attachments |
| `customer-payment` | branch | images + pdf | 10MB | – | yes | private | retail mark-payment attachments |
| `employee` | branch | images + pdf, doc, docx | 10MB | `profile`, `documents` | – | private | employee documents (Aadhaar, PAN: sensitive) |
| `checklist` | branch | images + docs | 10MB | `attachments`, `items` | yes | private | checklist files |
| `invoice` | branch | pdf | 10MB | – | yes | private | server-generated invoice PDFs (future) |
| `reports` | branch | pdf, xlsx, csv | 25MB | `gst`, `sales`, `stock`, … | yes | private | server-generated exports (future) |
| `documents` | tenant | images + docs | 10MB | – | – | private | company documents |

Image optimisation that exists today (sharp: resize to 1800px and convert to webp; pdf-lib recompression) moves into file-service as a per-module `transform` option (on for `menu-items` and `branding`). It runs **after** inspection, the detected type and extension are updated, and EXIF is always stripped from images.

---

## 4. Database: `file-service` DB, migration `file-service/migrations/001_files.sql`

`tbl_files`:

| Column | Notes |
|---|---|
| `file_id` | uuid primary key |
| `zodu_id`, `branch_id` | `branch_id` is null for tenant scope |
| `module`, `category`, `entity_id` | |
| `object_key` | unique |
| `mime_type`, `size_bytes`, `original_name` | `original_name` sanitized with `safeFileName` |
| `uploaded_by` | |
| `status` | `ready` / `deleted` |
| `created_at`, `deleted_at` | |
| `legacy_url` | nullable; used by the data migration |

Indexes: `(zodu_id, branch_id, module, entity_id)` and `(zodu_id, created_at)`.

Also add `tbl_file_access_log` (`file_id, user_id, zodu_id, action, ip, at`). Write to it for every download of a `private` file and every delete.

The **owning services store `file_id`** (or an array of `file_id`s in the existing JSONB columns), never a URL or key. API responses build URLs at read time (section 6).

---

## 5. Auth and tenant context (works with today's tokens)

Implement one function, `getRequestContext(req) → { userId, zoduId, branchId }`, behind a single middleware. This keeps file-service working now and lets the JWT upgrade (a separate project) swap the inside of the function later.

- **Now:**
  - Verify the Bearer token with `jsonwebtoken` and `APP_SECRET`, as `ValidateSignature` does. Take `userId` and `zoduId` **only from the token**.
  - `branchId` comes from the `X-Branch-Id` header, because the token has none. **Check that the user has access to that branch** through a new auth-service internal endpoint (`GET /internal/user-branch-access?user_id&zodu_id&branch_id`, using `tbl_user_roles`). Cache the answer for 60 seconds.
  - **Tenant-scope modules** (`_shared`) need only `zoduId`.
- **Never** read `zodu_id`, `branch_id` or `user_id` from body, query or path.
- **Permissions:** check the module's `permission` against `tbl_access_control` through auth-service's existing role-access data (cached). The company owner / Admin role bypasses the check only within its own `zoduId`.
- **Cross-tenant or cross-branch access returns 404, not 403**, so file ids can't be probed. This changes the POC's `assertKeyBelongsTo`, which returns 403.
- **Internal calls** from other services use `requireInternal`: an `X-Internal-Token` per calling service, compared with `crypto.timingSafeEqual`. The calling service passes the already-verified `{ userId, zoduId, branchId }`. **The gateway must block `/files/internal/*`**, and likewise `/*/internal/*` for every service.

---

## 6. API (`/files` through the gateway, port 4007)

| Method | Path | Notes |
|---|---|---|
| POST | `/files/:module/:entityId[?category=]` | Multipart, field `files` (up to 10) or `file`. All-or-nothing with inspection, exactly as in the POC. Returns `[{ file_id, original_name, mime_type, size_kb, url }]`. |
| GET | `/files/:module/:entityId` | List a record's files (from `tbl_files`, not by listing MinIO) |
| GET | `/files/:fileId/url[?download=1]` | Presigned GET. **Expiry 15 minutes** (`PRESIGNED_URL_TTL=900`). `response-content-type` and `response-content-disposition` forced, as in the POC. `Cache-Control: no-store`. |
| POST | `/files/urls` `{ file_ids: [...] }` | **Batch** presigned URLs, max 100. Needed for menu lists and checklist galleries; foreign or missing ids are left out. |
| GET | `/files/:fileId/content` | Stream through the API (POC `streamFile`: `nosniff`, sandbox CSP except for PDF, attachment unless inline-safe). **Required for the `employee` module** and allowed for every module. |
| GET | `/files/v/:fileId` | **`link` modules only, no auth.** Streams the file with `Cache-Control: public, max-age=31536000, immutable`. The unguessable UUID in the URL is the protection. This keeps `<img src>`, invoice PDFs and print-bridge working with a stable URL. Returns 404 for any `private` module. |
| DELETE | `/files/:fileId` | Soft delete (`status=deleted`). Accounting modules (`expense`, `purchase`, `customer-payment`, `invoice`, `reports`) keep the object; others remove it after 30 days (job). |
| DELETE | `/files/:module/:entityId` | Soft-delete all of a record's files (called when the record is deleted) |
| POST | `/files/internal/upload` | `requireInternal`. Same as the upload above, with context passed by the calling service. Used in Phase 2 so **clients don't change yet**. |
| POST | `/files/internal/store` | `requireInternal`. Server-generated buffers or streams (invoice PDFs, report exports) |
| POST | `/files/internal/resolve` | `requireInternal`. `{ file_ids }` → URLs, so services can put URLs into their responses |
| GET | `/health` | |

Response format, status codes and validation follow the repo conventions (Joi schemas, `STATUS_CODES`, the error handler). **Never return MinIO keys, bucket names or stack traces.**

---

## 7. Production hardening (gaps the POC itself lists)

- **MinIO clients:** only file-service has MinIO credentials, using a **dedicated MinIO user** whose policy allows only the new bucket.
  - Use two clients: `internal` (private network: put, get, stat, remove) and `signer` (built from `MINIO_PUBLIC_URL`, e.g. `https://files.myzodu.com`, used only for presigning, because the signature covers the host).
- **New private bucket** `zodu-files` (`mc anonymous set none`) with versioning and server-side encryption. Leave the old `zodu` bucket untouched until migration is verified.
- **Rate limits:** move to a shared store (Redis; add it to compose) so all replicas count together.
  - Uploads: per user 30 requests/min.
  - API: per IP 300/min.
  - `/files/v/*`: generous per IP, since it's cached.
- **Memory:** keep multer memory storage, with the POC limits and **no more than N concurrent uploads per instance** (a queue or semaphore, `MAX_CONCURRENT_UPLOADS`). Document that direct-to-MinIO presigned uploads are the next step at higher volume; don't build them now.
- **Antivirus:** add an `onScan(file)` hook, a no-op now, ready for ClamAV.
- **Logging:** structured logs with request id, user id, zodu id, module, file id. Never log file contents or tokens.
- **Containers:** Dockerfile and `docker-compose.uat.yml` / `docker-compose.prod.yml` entries for `file-service` and `redis`, with **no published ports** (only the gateway is public).
- **Secrets:** go in `env_file:` / `.env` (not committed), plus a `.env.example`. The current MinIO keys are committed in the compose files; list them for rotation.

---

## 8. Migrating the services (Phase 2) and the existing files (Phase 3)

**Phase 2: switch each service to file-service. Clients don't change.**
- **Uploads:** the existing upload routes (menu image, expense/purchase attachments, employee documents, checklist attachments, logo and signatures, mark-payment) keep their paths and field names. They forward the multer files to `POST /files/internal/upload` with context from the request, then store the returned `file_id`s.
  - On **create** flows, insert the record first (inside the existing transaction), upload with the new id, save the `file_id`s, then commit.
  - If the upload fails, roll back. If the commit fails, delete the uploaded files.
- **Responses:** keep returning the old field names (`menu_image`, `attachment_url`, `file_url`, `company_logo_url`, …) filled with URLs from `/files/internal/resolve`:
  - `link` modules → the stable `/files/v/:fileId` URL;
  - `private` modules → a presigned URL.

  Add new `*_file_id` fields next to them for clients to adopt later.
- **Remove** each service's `utils/minio.js` and MinIO env vars, the generic `/upload` and `/upload/multiple` routes (after finding and moving their callers), `GET /file/*`, and `DELETE /delete/file/*`. Drop `minio`, `sharp` and `pdf-lib` dependencies where they're no longer used.
- Add a column migration in each owning service for the `file_id` references. Keep the old URL columns until Phase 3 is verified.
- **Do the services one PR at a time:** auth → employee → checklist → retail → restaurant.

**Phase 3: move the existing objects.** Write `file-service/scripts/migrate-legacy-files.js`:
- Read every URL column and JSONB array from section 2 (connect to each service's DB read-only, plus an update connection per service).
- Map each URL to its object in bucket `zodu`, and work out `zoduId`, `branchId`, module and entity id from the owning row.
- Copy the object to the new key in `zodu-files`, re-running `inspectFile`. Files that fail inspection are **reported, not copied**.
- Insert the `tbl_files` row with `legacy_url`, and write the `file_id` back to the owning row.
- Required behaviour:
  - `--dry-run`, `--service=`, `--limit=`;
  - **resumable and idempotent** (skip rows already carrying a `file_id`);
  - **never deletes** anything in `zodu`;
  - final report of migrated, skipped, rejected, missing objects, and objects in `zodu` that no row points to.
- **Run it on UAT first.**
- **Legacy URL fallback:** while old app builds are still in use, the gateway keeps routing `/{service}/file/:name` to file-service. It looks up `legacy_url`, applies the same `link`/`private` rules (private files need auth), and only after that streams the file. Remove this once clients have moved.

---

## 9. Tests

Use the POC style (`node:test` + `node:assert`, with `supertest` for HTTP). Run MinIO and Postgres in docker compose for integration tests.

- **Ported POC tests:** key builder and file inspector (all of them).
- **Upload:**
  - every module's type and size limits;
  - all-or-nothing batch with rollback;
  - spoofed types rejected (PNG bytes named `.pdf`; `.exe` renamed to `.jpg`; SVG; HTML);
  - PDF with `/JavaScript`; macro `.docx`; CSV formula.
- **Access:**
  - another `zodu_id` → 404;
  - another branch → 404;
  - a branch the user isn't assigned to (`X-Branch-Id` spoofing) → 404;
  - no token or invalid token → 401;
  - missing module permission → 403;
  - `_shared` file readable from any of the tenant's branches.
- **`/files/v/:id`:** works for `link` modules and returns 404 for `private` ones.
- **Presigned URLs:** expiry is 900s with forced response headers. Batch URLs leave out foreign ids.
- **Internal:** `/files/internal/*` without a valid token → 401; through the gateway → 404.
- **Migration script:** dry run against fixture rows; a second run changes nothing.

---

## Phases (one PR each; stop after each)

1. **file-service:** service, registry, `tbl_files` migration, context/permission middleware, all endpoints, Redis rate limits, auth-service `user-branch-access` internal endpoint, gateway `/files` route and internal-path blocking, Docker/compose, MinIO setup doc (`docs/file-service/minio-setup.md`: bucket, user policy JSON, CORS, private console port, HTTPS proxy for `MINIO_PUBLIC_URL`), tests.
2. **Service migration**, one PR per service (auth → employee → checklist → retail → restaurant), as in section 8.
3. **Data migration and cleanup:** run on UAT, verify, run on prod, legacy-URL fallback, then drop the old URL columns and old upload code in a final PR once clients have moved.

## Report at the end of each phase

- Every file added or changed.
- New env vars per service (`FILE_SERVICE_URL`, `INTERNAL_SERVICE_TOKEN_*`, `MINIO_INTERNAL_URL`, `MINIO_PUBLIC_URL`, `MINIO_BUCKET_NAME`, `PRESIGNED_URL_TTL`, `REDIS_URL`, `MAX_CONCURRENT_UPLOADS`, …) and secrets to rotate.
- Every upload or download point you found that is **not** in section 2, and how you handled it.
- Every route where you could not take the tenant/branch from the verified context, and why.
- Client changes needed later (optional adoption of `*_file_id`, `/files/urls`, the `X-Branch-Id` header).
