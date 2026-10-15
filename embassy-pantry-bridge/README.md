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
