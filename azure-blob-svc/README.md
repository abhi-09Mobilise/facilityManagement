# Azure Blob upload sidecar

Tiny Express service that uploads, deletes, and reports health on blobs in
an Azure Storage account. Stands alongside the Node API the same way
`floor-scan-svc/` does — the browser never touches it directly.

## Why a separate process?

- **Isolation.** Storage account credentials live in this process only.
  If the main API leaks an error stack or env dump, the connection string
  isn't in it.
- **Familiar pattern.** Same shape as the OpenCV sidecar — bind to
  127.0.0.1, run under systemd, gated by an internal shared secret.
- **Per-env routing.** Point the main API at a different
  `AZURE_BLOB_SVC_URL` per environment to write to a different storage
  account without redeploying.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | reachable + Azure creds valid |
| POST | `/upload` | multipart `file` → returns `{ url, blob_name, container, size, content_type }` |
| DELETE | `/file?container=…&name=…` | delete one blob (idempotent — 404 = success) |

All endpoints except `/health` require the `X-Internal-Key` header to
match `INTERNAL_KEY` from `.env`. The main API attaches it automatically.

## Install

```bash
cd /var/www/FacilityManagement/azure-blob-svc
npm ci
cp .env.example .env
# Paste the storage account connection string, set INTERNAL_KEY, save.
./run.sh                                      # smoke test
curl http://127.0.0.1:5002/health             # should return { ok: true, ... }
```

## Run as a service

```bash
sudo cp azure-blob.service /etc/systemd/system/azure-blob.service
sudo systemctl daemon-reload
sudo systemctl enable --now azure-blob
sudo systemctl status azure-blob
journalctl -u azure-blob -f                   # live logs
```

## Tell the main API where it is

In `backend/.env`:

```
AZURE_BLOB_SVC_URL=http://127.0.0.1:5002
AZURE_BLOB_INTERNAL_KEY=must-match-INTERNAL_KEY-from-this-services-env
```

## Returned URL — public vs SAS

- `CONTAINER_ACCESS=blob` (default) — the URL the sidecar returns is
  directly usable by the browser, no SAS needed. Best for facility cover
  images and floor maps that you want any logged-in user to load fast.
- `CONTAINER_ACCESS=private` — the URL is not usable as-is; you'd need to
  mint a short-lived SAS URL on read. (Not yet wired here.)

If you front the storage account with Azure CDN or a custom domain, set
`PUBLIC_BASE_URL=https://cdn.your-domain.com` and returned URLs will use
that hostname instead of `*.blob.core.windows.net`.
