# Deploying to `fms.onmobilise.com`

Three processes need to run on the server:

1. **Node API** (`backend/`) — Express, port 4000 (internal).
2. **Floor-scan service** (`floor-scan-svc/`) — FastAPI + OpenCV, port 5001 (internal).
3. **nginx** — terminates HTTPS for `fms.onmobilise.com` and reverse-proxies
   `/api`, `/uploads`, `/public` to Node. Everything else serves the static
   React build.

The browser only ever talks to nginx on `https://fms.onmobilise.com`. Node
and Python both bind to `127.0.0.1` so they aren't reachable from the
internet. **This means CORS is a non-issue for the browser** as long as the
SPA and API live on the same origin (see below for the cross-origin case).

---

## 1. CORS configuration

The Node server reads `CORS_ORIGIN` from `.env`. Set it to a comma-separated
list of allowed browser origins:

```
CORS_ORIGIN=https://fms.onmobilise.com
```

If you ever serve a staging build off a different subdomain, add it:

```
CORS_ORIGIN=https://fms.onmobilise.com,https://staging-fms.onmobilise.com
```

Declined origins get logged once with the line:

```
[cors] declined origin: https://typo.example.com  (allowed: https://fms.onmobilise.com)
```

The Python floor-scan service has its own `ALLOWED_ORIGINS` env var, but
since the browser never hits it directly (the Node API proxies `/scan`),
the default `*` is fine. Bind it to `127.0.0.1` and only Node will reach it.

---

## 2. nginx config

```nginx
server {
  listen 443 ssl http2;
  server_name fms.onmobilise.com;

  # ssl_certificate ...;
  # ssl_certificate_key ...;

  # SPA bundle
  root /var/www/FacilityManagement/frontend/dist;
  index index.html;

  # API + static uploads + public portal → Node
  location /api/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 12m;            # match MAX_UPLOAD_MB + headroom
  }
  location /uploads/ { proxy_pass http://127.0.0.1:4000; }
  location /public/  { proxy_pass http://127.0.0.1:4000; }

  # React Router fallback
  location / {
    try_files $uri /index.html;
  }
}

# Optional: redirect http → https
server {
  listen 80;
  server_name fms.onmobilise.com;
  return 301 https://$host$request_uri;
}
```

Because the SPA and API share the same origin, browsers won't even send a
preflight — CORS is irrelevant on this path.

---

## 3. Node API — production install

```bash
cd /var/www/FacilityManagement/backend
cp .env.example .env       # edit values: DB, JWT_SECRET, SMTP, CRON_SECRET
npm ci --omit=dev
node scripts/migrate.js    # apply DB migrations
NODE_ENV=production node src/server.js
```

Use pm2 or systemd to keep it running. Example pm2:

```bash
pm2 start src/server.js --name fms-api --update-env
pm2 save
pm2 startup
```

---

## 4. Floor-scan Python service — yes, it must run on the server

The Node `/api/floor-scan` endpoint shells out to the Python service over
HTTP. If Python isn't running, admins can still draw layouts manually, but
the **Auto-detect** button on the layout editor will return a 503 with
`"Floor scan service is not reachable…"`.

### Install (one-time)

```bash
cd /var/www/FacilityManagement/floor-scan-svc

# Use Python 3.13 (NumPy / OpenCV don't have wheels for 3.14 yet)
python3.13 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

cp .env.example .env       # already has sensible defaults
```

### Run (foreground, for smoke-testing)

```bash
./run.sh
# or, equivalently:
uvicorn app:app --host 127.0.0.1 --port 5001
```

Health check:

```bash
curl http://127.0.0.1:5001/health
```

### Run as a service (production)

Copy the provided unit file:

```bash
sudo cp floor-scan.service /etc/systemd/system/floor-scan.service
# Edit User, Group, WorkingDirectory to match your deploy paths.
sudo systemctl daemon-reload
sudo systemctl enable --now floor-scan
sudo systemctl status floor-scan
journalctl -u floor-scan -f      # live logs
```

### Tell Node where it lives

In `backend/.env`:

```
FLOOR_SCAN_SVC_URL=http://127.0.0.1:5001
```

That's the default — only change it if you put Python on a different host
inside your private network.

---

## 5. Cron — pre-end cleanup notification

The `/api/cron/pre-end-notify` endpoint is gated by `CRON_SECRET`. Set it
in `.env` to a long random string, then schedule a hit from outside the
app (every 5 minutes is enough):

```cron
*/5 * * * *  curl -fsS "https://fms.onmobilise.com/api/cron/pre-end-notify?key=YOUR_SECRET" >/dev/null
```

---

## 6. Frontend build

```bash
cd /var/www/FacilityManagement/frontend
# Leave VITE_API_BASE_URL empty if SPA + API share the origin (recommended).
npm ci
npm run build           # outputs dist/
```

nginx serves `dist/` directly.

---

## 7. Smoke test after deploy

```bash
# 1. Node up
curl -i https://fms.onmobilise.com/api/health

# 2. Python up + reachable from Node
curl -i http://127.0.0.1:5001/health

# 3. CORS from the browser — open DevTools on https://fms.onmobilise.com,
#    log in, watch the network tab. No "blocked by CORS policy" errors.

# 4. Decline test — origin that ISN'T in CORS_ORIGIN should get blocked.
curl -i -H "Origin: https://evil.example.com" \
  https://fms.onmobilise.com/api/health
# Browser will reject due to missing Access-Control-Allow-Origin header.
```
