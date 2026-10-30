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
| POST | `/internal/upload`, `/internal/store`, `/internal/resolve`, `/internal/delete` | `X-Internal-Token` (blocked at the gateway) |

Another tenant's or branch's file, or a branch the user isn't assigned to,
answers **404**. A missing module permission answers **403**.

URLs in responses: `link` modules get `PUBLIC_FILE_BASE_URL/files/v/:id`.
`employee` files get `/files/:id/content`. Every other module gets a presigned URL.

## Internal calls (Phase 2)

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
