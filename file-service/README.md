# file-service

Central file storage for Zodu. It is the only service with MinIO credentials.
Other services store `file_id`s, never URLs or keys.

- Layout: `{zoduId}/{branchId|_shared}/{module}/{entityId}[/{category}][/{yyyy}/{mm}]/{uuid}.{ext}`
- Modules, types, limits, access and permissions: [src/storage/modules.js](src/storage/modules.js)
- Content inspection (type from bytes, PDF JS, macros, zip bombs, CSV formulas): [src/storage/file-inspector.js](src/storage/file-inspector.js)
- Tenant / branch / permission context: [src/middleware/context.js](src/middleware/context.js)
- MinIO bucket, user policy, HTTPS proxy: [docs/file-service/minio-setup.md](../docs/file-service/minio-setup.md)

## API (through the gateway at `/files`)

| Method | Path | Auth |
|---|---|---|
| POST | `/files/:module/:entityId[?category=]` | JWT + `X-Branch-Id`, module *create* |
| GET | `/files/:module/:entityId` | module *read* |
| GET | `/files/:fileId/url[?download=1]` | module *read*. Presigned, 15 min. `employee` → `/content` URL |
| POST | `/files/urls` `{ file_ids }` | max 100. Foreign ids are left out. |
| GET | `/files/:fileId/content[?download=1]` | module *read* |
| GET | `/files/v/:fileId` | none. `link` modules only, cached for a year |
| DELETE | `/files/:fileId`, `/files/:module/:entityId` | module *delete*. Soft delete |
| POST | `/internal/upload`, `/internal/store`, `/internal/resolve`, `/internal/delete`, `/internal/claim`, `/internal/discard` | `X-Internal-Token` (blocked at the gateway) |
| GET | `/legacy/<key>` | none. Pre-file-service objects, read-only, until Phase 3 |

Another tenant's or branch's file, or a branch the user isn't assigned to,
answers **404**. A missing module permission answers **403**.

URLs in responses: `link` modules get `PUBLIC_FILE_BASE_URL/files/v/:id`.
`employee` files get `/files/:id/content`. Every other module gets a presigned URL.

## How the services use it (Phase 2)

Every service carries a copy of [clients/file-client.js](clients/file-client.js)
as `src/utils/file-client.js` (keep the copies identical) and holds no MinIO
credentials.

- **Direct uploads** (logo, invoice images, employee documents, checklist
  attachments, payment attachments) go to `/internal/upload` for their module and record.
- **Upload first, save later** (`/upload`, `/upload/multiple` in retail and
  restaurant): files go to the `uploads` staging area and the app gets a
  `/files/v/<id>` link. Saving a record claims the file into it
  (`/internal/claim`): it moves to the record's key and keeps its id.
- **Stored values:** scalar `*_file_id` columns, or "file refs" inside JSONB
  arrays (`{ ..., file_id, file_ctx, url_key }`). `fileUrlsMiddleware` turns
  refs into fresh URLs in every JSON response, in the field the app always read.
- **Old URLs** (`/{service}/file/<key>`) are routed by the gateway to
  `GET /legacy/<key>`, read-only from the old bucket, until Phase 3 migrates them.

## Internal calls

```
POST http://file-service:4007/internal/upload?module=expense&entity_id=EXP12
X-Internal-Token: <INTERNAL_SERVICE_TOKEN_RETAIL>
X-Zodu-Id: Z001
X-Branch-Id: B1
X-User-Id: <user uuid>
multipart: files=@bill.jpg
```

## Run

```bash
cp .env.example .env.local      # fill in; NODE_ENV=local reads .env.local
npm install
npm test                        # unit + HTTP tests, no infrastructure needed
npm run test:services           # each service's file code against file-service (needs their npm installs)
docker compose -f docker-compose.test.yml up -d
FILE_IT=1 npm run test:integration
npm run dev
```

The database must exist before `scripts/apply-migrations.sh <env>` creates the tables.

## Scale-out notes

- Uploads are held in memory (multer). `MAX_CONCURRENT_UPLOADS` caps how many
  run at once per instance; extra uploads queue for `UPLOAD_QUEUE_TIMEOUT_MS`,
  then get a 503. At higher volume, the next step is direct-to-MinIO presigned
  PUT uploads with a post-upload inspection step.
- Rate limits live in Redis (`REDIS_URL`), so all replicas share one budget.
- `onScan(file)` in [src/storage/scan.js](src/storage/scan.js) is the antivirus
  hook. It's a no-op today and ready for ClamAV.
