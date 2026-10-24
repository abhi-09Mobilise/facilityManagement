# 11 — Kiosk booking view (Embassy)

**Goal.** A walk-up **kiosk** screen for booking a facility, scoped to the
**Embassy tenant (FM tenant 10)**. Flow: pick **Organisation → facility cards →
slot → identify yourself → confirm**. No staff login to *use* it; the booker is
identified by **work email / employee ID** matched against the Embassy employees
we sync (doc 12 / `1_user_master`).

## Decisions (locked 2026-10-24)

- **Flow picks tenant → organisation → site → facility.** No token. `tenant_id`
  / `org_id` / `site_id` are plain params; every query is scoped to them.
  Facilities link to a **site** (`facility.site_id`), so the facility list is
  keyed by `site_id`, not org. (Superseded the earlier signed-token model.)
- **Launched from the profile menu.** Admins (`super_admin`/`tenant_admin`/
  `org_admin`) get an **Open kiosk** item next to Logout that opens `/kiosk` in
  a new tab. Optionally pinned to one tenant via `VITE_KIOSK_TENANT_ID` so only
  Embassy admins see it.
- **Identity = email / employee ID, asked FIRST.** After choosing the facility
  the kiosk identifies the booker by work email / employee ID, *then* shows the
  booking page. Resolves a **synced Embassy employee** and books as that real
  user (approvals, emails, "My bookings" all work). Unknown → "not found";
  never creates users.
- **Date/time + seat on one page.** For desk facilities the booking page shows,
  top-to-bottom: pick a time slot → pick seat(s) on the **same desk canvas** as
  `/facility/type/desk` → (if >1 seat) an email per extra seat.
- **One booking per seat.** Multiple seats ⇒ each seat is booked for its own
  employee (the first seat = the primary booker; extras by the emails entered),
  so every person gets their own approval + check-in code. `/public/kiosk/book`
  takes an `assignments: [{identifier, desk_id}]` list and creates one booking
  per entry (identities validated up front, all-or-nothing).
- **Public booking needs a real user.** `bookings.user_id` is `NOT NULL`; the
  kiosk satisfies it via the resolved employee, not an anonymous row.

## Current state

- Public portal (`/public/t/:slug/...`) is **browse-only**. Booking lives behind
  `authRequired` (`POST /api/bookings`, coupled to `req.user`).
- Employees are synced into FM with `email` + `external_id` (migration 054) —
  the kiosk's lookup keys.

## Public endpoints (rate-limited like the rest of `/public`; no token)

```
GET  /public/kiosk/tenants
       -> { tenants: [{id,name}] }                              # active tenants
GET  /public/kiosk/organisations?tenant_id=
       -> { tenant:{id,name}, organisations:[{id,name}] }
GET  /public/kiosk/sites?tenant_id=&org_id=
       -> { sites:[{id,name,address}] }
GET  /public/kiosk/facilities?tenant_id=&site_id=
       -> public_listed facility cards (facilities link to a SITE, not just org)
GET  /public/kiosk/facilities/:id/day?tenant_id=&date=
       -> reuse bookings.dayAvailability (slots + seats_remaining)
POST /public/kiosk/identify   { tenant_id, identifier }         # email OR emp id
       -> { user: {id, name, masked_email} } | 404
POST /public/kiosk/book       { tenant_id, identifier, facility_id, start_at, end_at }
       -> books as the resolved employee (reuses the authed engine)
```

Every endpoint scopes queries to `tenant_id`; `identify` is separate so the UI
can confirm "booking as **Asha R.**" before taking the slot. The UI renders
orgs + facilities as Book-a-facility-style cards in a horizontal carousel
(left/right scroll) when there are several.

## Booking reuse (implemented)

`bookings.create` is coupled to `req.user`. Rather than refactor it (risky to
the working authed path, and not runtime-testable without a DB), the kiosk
**invokes the controller internally** with a synthetic req/res
(`invokeController` in public.controller): `req.user = { id: <employee>, role:
'employee', tenant_id }`, `req.body = { facility_id, start_at, end_at, title,
desk_id, channel:'tablet' }`. Same for availability via
`bookings.dayAvailability`. This gives literal single-source-of-truth reuse —
capacity, desk-clash (`booking_desks`), operating-hours, advance-rules,
approval-chain and the check-in code all run exactly as the authed path — with
**zero changes to `bookings.controller`** (verified: empty diff).

## Abuse / safety

- Reuse the `/public` IP rate limiter; add a tighter per-token limit on `book`.
- `identify` returns a **masked** email only (`a***@embassy.com`) — never leak
  the roster. Unknown identifier → generic "not found".
- Advance-rule / capacity / window checks run server-side via the shared
  creator — a kiosk can't bypass them.
- Kiosk books only `public_listed` facilities in the bound tenant.
- Optional: per-employee daily cap on kiosk bookings (reuse `max_per_user_*`).

## Frontend

- New SPA route `/kiosk` (+ `?token=`), **no navbar/auth**, large touch targets,
  auto-reset to the org picker after a confirmation or 60s idle.
- Steps: Organisation grid → facility cards → day/slot → identify (email/ID) →
  "booking as X" confirm → success card with the check-in code.
- Reuses the portal card components + the booker day-availability shapes.

## Out of scope

- Multi-tenant kiosk (Embassy-only by decision).
- Kiosk check-in (that's the QR `/checkin` page, doc 10) — though the success
  card can show the check-in code.

## Effort

**M–L.** Biggest piece is the `createBookingAs` refactor + the public booking
endpoint; the browse/identify endpoints and the SPA are straightforward reuse.
