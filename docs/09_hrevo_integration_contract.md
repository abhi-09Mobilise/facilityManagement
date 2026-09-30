# HReVO Integration Contract — Department / Business-Unit Dimensions

**Status:** DRAFT — awaiting confirmation from HReVO team (target: this week).
**Owner:** Dev B (M6 milestone).
**Depends on:** T1.4 (occupancy_daily) — populated aggregations become
useful for department-level analytics only once this contract is settled.
**Blocks:** T3.4 (dashboard drill-downs by department / business unit).

---

## 1. Purpose

The `occupancy_daily` rollup table (migration 047) stores a
`department_id` column so dashboards can slice occupancy by department
and, later, by business unit. The value of `department_id` on each
`bookings` row is denormalised from `users.department_id` at booking
creation time.

For this to be meaningful outside SoCampus's own department table, we
need to agree with HReVO on:

1. **Which HReVO field maps to `users.department_id`** in the FMS.
2. **Whether HReVO carries a separate "business unit" concept** and, if
   so, whether we need to store `business_unit_id` on `users` (and by
   extension on `bookings` + `occupancy_daily`) in a future migration.

Until this is confirmed, the aggregator writes only `department_id`.
Business-unit slicing is a Phase-2 add-on gated on this contract.

---

## 2. Current state (FMS side)

- `users.department_id` is `BIGINT` (nullable, soft-ref only; see
  migration 008). No FK enforcement — deleting a department leaves the
  soft-ref intact so booking history isn't broken.
- `bookings.department_id` is `BIGINT` (nullable). Denormalised from
  the booker's `users.department_id` at CREATE time (see
  `backend/src/modules/bookings/bookings.controller.js` — the
  create-booking path pulls the booker's department and writes it
  onto the booking row, so subsequent department re-orgs don't
  rewrite history).
- `departments` (migration 008) — the master table. Has `tenant_id`,
  `parent_dept_id` (self-referential), `manager_user_id` (soft-ref),
  `code`, `name`.
- **No `business_unit` column exists anywhere in the schema today.**

## 3. What we need from HReVO

**Send to `dev-b@socampus` (or the shared HReVO integration channel)
this week:**

1. **Field mapping.** For each HReVO API resource (user, employee,
   dept, unit), the field name and cardinality that best maps to:
   - `users.department_id` in FMS
   - a future `users.business_unit_id` (if HReVO carries it)
2. **Value types.** Are HReVO department / BU identifiers integers,
   strings (like `'ENG-BLR'`), UUIDs, or something else? This affects
   FK type and future migration shape.
3. **Refresh model.** Is it daily push, on-change webhook, on-demand
   pull? The aggregator runs nightly, so lag under 24 h is fine — but
   we need to know it's not a manual export.
4. **Historical stability.** If HReVO renames or restructures a
   department, does the ID stay stable, or does it change? Impacts
   whether the aggregator's `department_id` history stays coherent
   over months.
5. **Tenant scoping.** Does HReVO give us a per-tenant view, or is
   there a single global directory? This affects which `tenant_id`
   context we apply when writing the sync.

## 4. Assumed contract (until confirmed)

While we wait for HReVO to respond, the aggregator + backfill assume:

- `users.department_id` corresponds to whatever HReVO field the admin
  is currently populating manually (via the `/admin/users/:id` edit
  form). **No automatic sync exists yet.**
- Business unit is not modelled in FMS. All BU-level analytics are
  deferred to Phase 2, contingent on this contract being finalised.
- `department_id` values on historical `bookings` rows are frozen —
  they will NOT be back-rewritten if HReVO changes a mapping later.

## 5. Follow-ups once the contract lands

Once HReVO confirms the field mapping:

1. Update this doc's Section 3 with actual field names + types.
2. Add a sync job (`backend/src/jobs/hrevoSync.js`) that pulls the
   department roster into `departments` on a nightly cadence.
3. **If HReVO carries business unit:** create migration `048_add_bu.sql`
   to add `users.business_unit_id`, `bookings.business_unit_id`,
   `occupancy_daily.business_unit_id` + `idx_occ_bu_day` covering
   index. Extend the aggregator to group by BU as well.
4. Wire the BU dimension into the dashboard drill-downs (T3.4).

## 6. Open questions log

_(add rows as issues surface with HReVO. Each row: date, question,
who owns follow-up.)_

| Date       | Question                                                  | Owner |
| ---------- | --------------------------------------------------------- | ----- |
| 2026-09-15 | Confirm field mapping for `department` and `business_unit`| Dev B |
| 2026-09-15 | Value type of HReVO department id                          | Dev B |
| 2026-09-15 | Refresh cadence (daily push vs pull vs webhook)            | Dev B |
