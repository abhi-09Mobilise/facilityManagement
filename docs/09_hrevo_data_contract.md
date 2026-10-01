# 09 — HReVO data contract (departments & business units)

**Status:** DRAFT — awaiting HReVO team confirmation (blocks W3/T3.4 BU drill-downs)
**Owner:** Dev B · **Raised:** W1 (sprint plan T1.5)

## Why this exists

Requirement R3 asks for analytics cut by **location / building / floor /
department / business unit**. Location→floor and department come from our own
data; **business unit does not exist anywhere in SoCampus FM** — it must come
from the HR system of record (HReVO / Darwinbox sync).

## What we already have (no HReVO dependency)

| Dimension  | Source in SoCampus FM | Status |
|---|---|---|
| Location (site) | `facilities.site_id` → `sites` | live, in `occupancy_daily` |
| Building | `floors.building_id` → `buildings` | live, in `occupancy_daily` |
| Floor | `facilities.floor_id` → `floors` | live, in `occupancy_daily` |
| Department | `bookings.department_id` (snapshotted from the booker at create time — comment in migration 011 says exactly this: "so manager reports group bookings per department reliably") | live, in `occupancy_daily` (`department_id` column; 0 = facility rollup) |

## What we need from HReVO

1. **Business-unit field per employee.** Proposed contract:
   - `employee_id` (must equal `users.email` or an explicit `users.hrms_code` —
     *confirm which*), `department_code`, `business_unit_code`, `business_unit_name`.
2. **Department mapping guarantee.** Our `departments` table is per-site.
   Does HReVO's department taxonomy map 1:1, or do we need a mapping table
   (`hrms_department_code` column on `departments`)?
3. **Delivery mechanism** (pick one, in order of preference):
   - a. Extend the existing nightly HRMS sync payload with `business_unit_*`
     fields → we add `users.business_unit_code/name` columns (1 small migration).
   - b. REST endpoint we poll (needs auth details + rate limits).
   - c. CSV drop (needs schedule + schema + failure contract).
4. **Change semantics.** When an employee moves BU mid-quarter, is historical
   attribution restated or point-in-time? (We recommend point-in-time: bookings
   snapshot the BU at creation, same as `department_id` today.)

## How it lands in the fact table (once confirmed)

- Option a (preferred): `users.business_unit_code` → snapshot onto
  `bookings.business_unit_code` at create (mirrors `department_id` pattern)
  → new `occupancy_daily.business_unit_code` dimension in a follow-up
  migration. Aggregator change is one extra GROUP BY column.

## Security / privacy notes

- BU codes are organisational metadata, not PII — safe in the fact table.
- The sync path must NOT deliver salary/grade fields; contract explicitly
  limits the payload to the four fields above (data minimisation).

## Open until answered (chases W1, hard-blocks W3/T3.4)

- [ ] Which employee key joins HReVO ↔ SoCampus users?
- [ ] BU field names + sample payload
- [ ] Delivery mechanism chosen
- [ ] Restatement vs point-in-time decision
