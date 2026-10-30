# MinIO setup for file-service

One-time setup per environment (UAT first, then prod). It creates the private
`zodu-files` bucket and a MinIO user that can only reach that bucket. It also
puts MinIO behind HTTPS on `files.<domain>` so browsers can use presigned URLs.

The old `zodu` bucket is left untouched until the Phase 3 data migration has
been verified.

| | UAT | Prod |
|---|---|---|
| Public file host (`MINIO_PUBLIC_URL`) | `https://files.myzodu.com` | `https://files.zodu.in` |
| Gateway origin (`PUBLIC_FILE_BASE_URL`) | `https://api.myzodu.com` | `https://api.zodu.in` |
| Internal URL (`MINIO_INTERNAL_URL`) | `http://72.60.206.59:9000` until MinIO joins the compose network, then `http://minio:9000` | same |

## 1. Admin alias

Run on the MinIO host with the root credentials. Don't use them anywhere else.

```bash
mc alias set zodu-admin http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
```

## 2. Bucket: private, versioned, encrypted

```bash
mc mb --ignore-existing zodu-admin/zodu-files
mc anonymous set none zodu-admin/zodu-files      # no public read, list or write
mc version enable zodu-admin/zodu-files          # deletes leave a recoverable version
mc encrypt set sse-s3 zodu-admin/zodu-files      # needs a KMS, see below
```

SSE-S3 needs a KMS key on the server. Either set up MinIO KES, or for a
single-node install set a static key in MinIO's environment and restart:

```bash
# 32 random bytes, base64. Keep it with the backups: without it, encrypted objects are unreadable.
MINIO_KMS_SECRET_KEY=zodu-files-key:$(openssl rand -base64 32)
```

**Lifecycle:** file-service never deletes accounting files (`expense`,
`purchase`, `customer-payment`, `invoice`, `reports`). Its purge job removes
other modules' objects 30 days after a soft delete. With versioning on, that
removal leaves a delete marker, so expire the old versions afterwards:

```bash
mc ilm rule add zodu-admin/zodu-files --noncurrent-expire-days 30 --expire-delete-marker
```

## 3. Dedicated service user

`zodu-files-policy.json`. Object read/write/delete on this bucket only, with no
bucket administration and no access to `zodu` or any other bucket:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetBucketLocation", "s3:ListBucket"],
      "Resource": ["arn:aws:s3:::zodu-files"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": ["arn:aws:s3:::zodu-files/*"]
    }
  ]
}
```

```bash
SECRET=$(openssl rand -base64 36 | tr -d '/+=')
mc admin user add zodu-admin file-service "$SECRET"
mc admin policy create zodu-admin zodu-files-rw zodu-files-policy.json
mc admin policy attach zodu-admin zodu-files-rw --user file-service
# → MINIO_ACCESSKEY=file-service, MINIO_SECRETKEY=$SECRET in env/file-service.<env>.env
```

The Phase 3 migration script also needs read access to the old bucket. Give it
a **separate** user that has `s3:GetObject` and `s3:ListBucket` on `zodu` and
the policy above on `zodu-files`. Delete that user once the migration is done.

Check that the user is boxed in:

```bash
mc alias set fs-check http://127.0.0.1:9000 file-service "$SECRET"
mc ls fs-check/zodu-files          # works
mc ls fs-check/zodu                # Access Denied
mc mb fs-check/anything            # Access Denied
```

## 4. Network: private API and console, public HTTPS for presigned GETs only

Today port 9000 (API) on `72.60.206.59` is reachable from the internet, and the
root-equivalent keys are committed in the compose files. Close it:

- **API (9000):** bind to the private network only (`127.0.0.1:9000:9000` or
  the docker network). Browsers reach objects only through the HTTPS proxy below.
- **Console (9001):** never public. Bind to `127.0.0.1:9001` and use an SSH tunnel:
  `ssh -L 9001:127.0.0.1:9001 user@host`, then open http://localhost:9001.

```bash
# firewall, if MinIO isn't containerised behind compose
ufw deny 9000/tcp
ufw deny 9001/tcp
```

### HTTPS reverse proxy for `MINIO_PUBLIC_URL`

The presigned signature covers the **Host** header, so the proxy must pass the
browser's host through unchanged. It only needs to allow signed `GET`/`HEAD`:
uploads go through file-service on the private network, never through this host.

```nginx
server {
    listen 443 ssl http2;
    server_name files.myzodu.com;                 # files.zodu.in on prod

    ssl_certificate     /etc/letsencrypt/live/files.myzodu.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/files.myzodu.com/privkey.pem;

    # Read-only, signed requests only: no listing, no anonymous access, no writes.
    if ($request_method !~ ^(GET|HEAD)$) { return 405; }
    if ($arg_X-Amz-Signature = "")       { return 403; }
    location = / { return 403; }

    location / {
        proxy_pass         http://127.0.0.1:9000;
        proxy_set_header   Host $http_host;       # must match the signed host
        proxy_set_header   X-Forwarded-Proto https;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_buffering    off;
        client_max_body_size 1m;
        add_header X-Content-Type-Options nosniff always;
        add_header Referrer-Policy no-referrer always;
    }
}
```

DNS: an `A` record for `files.myzodu.com` / `files.zodu.in` pointing at the host.

## 5. CORS

`<img src>` and `<a href>` on presigned URLs don't need CORS. A `fetch()` of a
presigned URL from the web app does. Community MinIO has no per-bucket CORS API,
so set it server-wide in MinIO's environment:

```bash
MINIO_API_CORS_ALLOW_ORIGIN=https://myzodu.com,https://app.myzodu.com   # prod: the zodu.in origins
```

The stable links for `link` modules (`/files/v/:fileId`) are served by
file-service through the gateway, and the gateway already handles CORS for them.

## 6. Verify

```bash
# private bucket: anonymous GET must fail
curl -s -o /dev/null -w '%{http_code}\n' https://files.myzodu.com/zodu-files/any.png   # 403

# file-service health through docker
docker exec uat-file-service wget -qO- http://127.0.0.1:4007/health

# end to end: upload with a real token, then open the returned url
curl -s -X POST https://api.myzodu.com/files/expense/EXP1 \
  -H "Authorization: Bearer $TOKEN" -H "X-Branch-Id: B1" -F "files=@bill.jpg"
```

## 7. Rotate the leaked keys

`MINIO_ACCESSKEY=zoduminio` / `MINIO_SECRETKEY=zodu@2025` are committed in
`docker-compose.uat.yml` and `docker-compose.prod.yml`, so assume they are public.
Once every service has moved to file-service (Phase 2), disable that user. Until
then, change its password and move the value into the host `env/*.env` files:

```bash
mc admin user disable zodu-admin zoduminio    # after Phase 2
```
