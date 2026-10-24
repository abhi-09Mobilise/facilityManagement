# Embassy Pantry Bridge

Standalone Node.js service that aggregates pantry-order data from the external
**Embassy (IFMS) MySQL** database and exposes it in the exact JSON shape the
Facility Management dashboard's pantry widget expects.

The FM backend proxies the pantry widget call here **only for tenants listed
in the mapping** (`EMBASSY_TENANT_MAP`); every other tenant keeps using FM's
own pantry tables — zero behavioural change.

---

## Why a separate service

- **Credential isolation**: Embassy DB creds never ship inside the FM backend.
- **Separation of concerns**: Embassy's schema (`60_pntry_order`, `pc_id`
  tenant key, status enum 2/3/4/6/9, etc.) stays encapsulated here.
- **Network reality**: the Embassy MySQL lives on a private Azure subnet
  (`10.86.0.76:3306`). This service is designed to be deployed inside that
  VNet; the FM backend reaches it over the internal network.
- **Fail-open**: if the bridge is down, FM's pantry widget falls back to the
  local DB — the dashboard never 500s because of a cross-system hiccup.

---

## Project layout

```
embassy-pantry-bridge/
├── package.json
├── .env.example
├── README.md
└── src/
    ├── server.js       # Express app + GET /pantry/aggregated
    ├── db.js           # mysql2 pool (Azure TLS-aware)
    ├── queries.js      # Q1–Q6 from the Embassy integration brief
    ├── transformer.js  # Embassy rows → FM widget JSON
    └── mock.js         # Deterministic canned data for BRIDGE_MODE=mock
```

---

## Setup

```powershell
cd c:\Mobilise\facilityManagement\embassy-pantry-bridge
npm install
copy .env.example .env
# Edit .env: set BRIDGE_SECRET (strong random hex) and keep BRIDGE_MODE=mock for now
npm run dev
```

Boot log should read:

```
[bridge] Embassy pantry bridge up on :4000 (mode=mock)
```

Health probe:

```powershell
curl http://localhost:4000/health
# → { "status": true, "mode": "mock", "uptime_s": 3 }
```

---

## Modes

### `BRIDGE_MODE=mock` (default)

Returns deterministic canned data in the FM shape without touching MySQL.
Use on dev workstations that can't reach the Embassy private subnet, or
to verify FM-side wiring before DB access is arranged.

### `BRIDGE_MODE=live`

Runs Q1–Q6 against Embassy MySQL. Requires:
- Working network path to the Embassy DB
- A read-only user (see **Preparing the DB user** below)
- Azure TLS cert in place if targeting prod (see **TLS** below)

Switch by editing `.env`:
```
BRIDGE_MODE=live
EMBASSY_DB_HOST=10.86.0.76
EMBASSY_DB_PORT=3306
EMBASSY_DB_USER=bridge_ro
EMBASSY_DB_PASSWORD=<ask DBA>
EMBASSY_DB_NAME=demo_ifmsuat
EMBASSY_DB_SSL=false     # true for prod Azure MySQL Flexible Server
```

---

## API

### `GET /pantry/aggregated`

**Headers**
- `X-Bridge-Secret: <value from .env BRIDGE_SECRET>` — required on every request.

**Query params**
- `scope_id` (required) — Embassy `pc_id` to aggregate.
- `from` (optional) — ISO date `YYYY-MM-DD`. Default: 30 days ago.
- `to` (optional) — ISO date `YYYY-MM-DD`. Default: today.

**Response (200)**
```json
{
  "status": true,
  "data": {
    "created": 768,
    "delivered": 714,
    "inProgress": 7,
    "avgDeliveryMin": 7,
    "daily": [
      { "day": "8 Sept", "orders": 24 },
      { "day": "9 Sept", "orders": 18 }
    ],
    "topItems": [
      { "name": "Masala chai", "orders": 439, "color": "#f97316" }
    ],
    "window": { "from": "2025-09-14", "to": "2025-10-14" },
    "as_of": "2025-10-14T10:30:00.000Z"
  }
}
```

**Error responses**
- `400` — missing `scope_id`
- `401` — bad / missing `X-Bridge-Secret`
- `502` — Embassy aggregator failed (DB error, timeout). Message in `detail`.

### `GET /health`

Open (no secret needed). Returns mode + uptime.

---

## Daily Embassy → FM org-hierarchy sync (worker)

Besides serving the pantry widget, the bridge runs a **daily worker** that
copies the Embassy org hierarchy into the FM database:

```
0_org_pl          -> organisations   (source_ref = pl_id)
0_org_pc          -> lookup only (block.pc_id -> pl_id -> organisation)
0_org_pc_block    -> sites           (source_ref = id)
0_org_pc_building -> buildings       (source_ref = id)
0_org_pc_floor    -> floors          (source_ref = id, floor_img -> layout_image_url)

1_user_master     -> users           (external_id = user id)   [runs after orgs]
1_usr_pl_map      -> lookup only (user_id -> pl_id -> organisation)
```

**Employees** are synced in the same daily run, right after organisations (so
each user attaches to its org). Scope = employees with an active, in-date
`1_usr_pl_map` row to a pl under org 13 — not all ~17k IFMS users. They're
SSO-only (random non-login password); email is the SSO match key, so
employees without an email import as `status=0`. Idempotent on
`users.external_id` (migration 054).

The bridge is the natural home for this: it already holds the Embassy
connection, and *all* Embassy data (pantry + hierarchy) flows through here.

**Important — this is the one place the bridge WRITES.** The pantry path is
read-only-over-HTTP; this worker writes to the FM DB, so the bridge now needs
`FM_DB_*` creds and network access to the FM MySQL (see `.env.example`). If you
prefer to keep the bridge write-free, run the import from the FM side instead —
but by design we keep one Embassy→FM worker here.

Idempotent: every FM row is keyed to its Embassy PK via
`(tenant_id, 'embassy', source_ref)` (FM migration `051`), so re-running UPSERTS
— a daily run never duplicates. Rows whose parent is trashed/out-of-scope are
skipped and auto-import once the parent appears.

### Enabling

In `.env`:
```
EMBASSY_SYNC_ENABLED=true     # off by default
EMBASSY_SYNC_AT=02:30         # server-local HH:MM
EMBASSY_ORG_ID=13             # Embassy org -> FM tenant
FM_TENANT_ID=10
FM_DB_HOST=127.0.0.1
FM_DB_PORT=3306
FM_DB_USER=fm_sync
FM_DB_PASSWORD=...
FM_DB_NAME=socampus_fm
```
On boot the bridge logs when the next sync will fire and re-arms after each run.

### `POST /org/import` (manual trigger)

```
POST /org/import?org_id=13&tenant_id=10[&dry_run=1]
Headers: X-Bridge-Secret: <BRIDGE_SECRET>
```
Runs the same worker on demand. `dry_run=1` does the full upsert then rolls it
back — writes nothing, returns the would-be counts. Handy to verify wiring
before enabling the daily schedule.

> The FM user for `FM_DB_*` only needs INSERT/UPDATE/SELECT on
> `organisations`, `sites`, `buildings`, `floors`. Grant it no more than that.

---

## Wiring from the FM backend

In `backend/.env`:
```
PANTRY_BRIDGE_URL=http://localhost:4000
PANTRY_BRIDGE_SECRET=<same value as this service's BRIDGE_SECRET>
EMBASSY_TENANT_MAP=6:7
```

Format of `EMBASSY_TENANT_MAP`: `<fm_tenant_id>:<embassy_pc_id>` pairs,
comma-separated. Example: `6:7,12:3` means FM tenant 6 is served by
Embassy pc_id 7, FM tenant 12 by pc_id 3.

The FM backend's `dashboards.pantryOrders` controller checks the active
tenant against this map on every request. Mapped → proxy to bridge.
Unmapped → use local FM pantry tables (current behaviour, untouched).

---

## Preparing the DB user (for `BRIDGE_MODE=live`)

Ask the DBA to run on the Embassy MySQL:

```sql
CREATE USER 'bridge_ro'@'<bridge-host-ip>' IDENTIFIED BY '<strong-password>';
GRANT SELECT ON demo_ifmsuat.`60_pntry_order`      TO 'bridge_ro'@'<bridge-host-ip>';
GRANT SELECT ON demo_ifmsuat.`60_pntry_order_itm`  TO 'bridge_ro'@'<bridge-host-ip>';
GRANT SELECT ON demo_ifmsuat.`60_food_item_master` TO 'bridge_ro'@'<bridge-host-ip>';
GRANT SELECT ON demo_ifmsuat.`60_pntry_roster`     TO 'bridge_ro'@'<bridge-host-ip>';
GRANT SELECT ON demo_ifmsuat.`0_org_pc`            TO 'bridge_ro'@'<bridge-host-ip>';
GRANT SELECT ON demo_ifmsuat.`0_org_pc_locations`  TO 'bridge_ro'@'<bridge-host-ip>';
FLUSH PRIVILEGES;
```

Replace `<bridge-host-ip>` with the deploy host (don't use `%` outside dev).

---

## TLS (prod Azure MySQL Flexible Server)

Download the Azure CA chain:
<https://learn.microsoft.com/en-us/azure/mysql/flexible-server/how-to-connect-tls-ssl>

Save as `BaltimoreCyberTrustRoot.crt.pem` in this folder, then set
`EMBASSY_DB_SSL=true` in `.env`.

---

## Query reference

Full Q1–Q6 are documented inline in [src/queries.js](src/queries.js). They
are verbatim ports of the Embassy integration brief and were authored
against the schema cross-referenced from `PantryMgmtController.php`.

Key semantic choices:
- **Creation window** anchored on `created_at` (datetime), not `order_date`
  (date).
- **Delivered** = `ord_status = 6 AND dlvrd_on IS NOT NULL AND dlvrd_on <>
  '0000-00-00 00:00:00'` (guards legacy zero-datetime rows).
- **In progress** = created in window AND `ord_status NOT IN (3, 6)` AND no
  `dlvrd_on`.
- **Avg delivery** = `AVG(TIMESTAMPDIFF(SECOND, created_at, dlvrd_on)) / 60`
  minutes, rounded.

If the dashboard should only show refreshment orders (not "Request
Assistance" rows), append `AND ordr_type = 1` to Q1–Q5.

---

## Troubleshooting

**401 Invalid bridge secret** — the FM backend's `PANTRY_BRIDGE_SECRET` does
not match this service's `BRIDGE_SECRET`. They must be identical.

**ECONNREFUSED / 10060 on live mode** — the Embassy DB subnet is private.
Verify the bridge host can reach `EMBASSY_DB_HOST:EMBASSY_DB_PORT` with
`telnet` or `Test-NetConnection`.

**Bridge returns 200 but FM widget still shows local data** — the active
tenant isn't in `EMBASSY_TENANT_MAP`. Confirm the exact FM `tenant_id` and
restart the FM backend after editing its `.env`.

**Avg delivery is `null`** — no orders had `ord_status=6` + a non-zero
`dlvrd_on` in the window. Expected on test data.
