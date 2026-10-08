# 10 — QR check-in

**Goal.** A single QR code (poster / sticker, same code everywhere) opens a
public check-in page. The employee types the **check-in code** from their
booking confirmation email and is marked present. Covers status-report item
**#14 (M15)** and pulls in its prerequisite **#5 (M10)** — the arrival
timestamps — because that's what "present" is recorded in.

> "QR check-in" = **a person arriving**. Not the `stage='checkin'` approval
> chain that runs before a booking is confirmed.

## Decisions (locked 2026-10-06)

- **No per-desk / per-room QR.** The QR is static and carries no payload — it
  just opens `{APP_PUBLIC_URL}/checkin`. (So one printed QR works org-wide.)
- **No login.** The check-in page is public; the emailed code is the proof.
- **Not the raw booking id.** Booking ids are sequential integers and trivially
  guessable, so we email a short **non-guessable check-in code** and the page
  accepts that. This is what the user calls "booking ID" in the email.
- **Single generic page.** The code alone identifies the booking; we do not
  verify which room the person is standing in.

## Current state

- `bookings` has no `checked_in_at` / `checked_out_at` and no check-in code.
- No check-in endpoint anywhere; nothing records arrival.
- A public, no-auth router already exists — [public.routes.js](../backend/src/modules/public/public.routes.js),
  mounted at `/public` **before** `authRequired`, with a built-in in-memory
  rate limiter (120 req/min/IP). We hang the check-in endpoint off it.
- Booking-confirmed email ([mailTemplates.bookingConfirmed](../backend/src/utils/mailTemplates.js))
  already renders a details card — we add one row for the code.

## Flow

```
booking approved ──► email carries check-in code  ABCD-2345
                          │
employee reaches desk ──► scans the wall QR ──► opens /checkin
                          │
          types code ──► POST /public/checkin { code }
                          │
        code valid + within window ──► checked_in_at = NOW()
                          │
                 ✅ "You're checked in — Marketing Hot-desks, 09:00–17:00"
```

## Schema delta

```sql
-- 048_booking_checkin.sql  (information_schema-guarded, idempotent like 046)
ALTER TABLE `bookings`
  ADD COLUMN `checkin_code`   CHAR(8)  NULL AFTER `status`,
  ADD COLUMN `checked_in_at`  DATETIME NULL AFTER `checkin_code`,
  ADD COLUMN `checked_out_at` DATETIME NULL AFTER `checked_in_at`,
  ADD UNIQUE KEY `uq_bookings_checkin_code` (`checkin_code`);
```

- `checkin_code` — 8 chars from a human-safe alphabet
  `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no `0/O/1/I/L`). ~32⁸ ≈ 10¹² space →
  unguessable under the public rate limit. Minted at booking create; unique
  index + retry-on-collision.
- `checked_out_at` reserved for a future check-out; the QR page is check-in only
  for now.
- **Backfill**: a tiny one-off `UPDATE` to mint codes for existing future-dated
  bookings (past ones can't be checked in, so leave them NULL).

## Backend

### Minting the code
In `bookings.controller.create`, generate the code when the booking row is
inserted (new helper `utils/checkinCode.js` → `generate()`, loop-until-unique on
the unique-key violation). Add it to the `bookingConfirmed` email payload.

### Public endpoint (the QR target)
```
POST /public/checkin
body: { code }
```
Added to [public.routes.js](../backend/src/modules/public/public.routes.js) so it
inherits the rate limiter and the no-auth mount.

Logic (`public.controller.checkin`):
1. Normalise `code` (uppercase, strip spaces/hyphens). Reject format mismatch →
   `400`.
2. `SELECT … FROM bookings WHERE checkin_code = ? AND trash = 0`.
   - not found → `404 CHECKIN_CODE_UNKNOWN` ("We couldn't find that code.")
3. Guard on state / window:

| Condition | Result |
|-----------|--------|
| `status != 'approved'` (pending / cancelled / completed) | `422 CHECKIN_NOT_APPROVED` |
| `NOW()` before `start_at − opensMin` | `422 CHECKIN_TOO_EARLY` |
| `NOW()` after `start_at + graceMin` | `422 CHECKIN_TOO_LATE` |
| already has `checked_in_at` | `200` no-op (return existing time) |
| OK | `200`, set `checked_in_at = NOW()` |

4. Response `{ facility_name, start_at, end_at, checked_in_at }` for the card.

**Window** (status-report T4.2: `start − opensMin … start + graceMin`). Grace
config (M3) doesn't exist yet → env constants, single helper so M3 is a one-line
swap:
```
CHECKIN_OPENS_MIN  (default 15)
CHECKIN_GRACE_MIN  (default 30)
```

**Rate limiting:** the public router's 120/min/IP already makes code-guessing
useless against a 10¹² space. No extra work; note it in the controller.

### Out of scope
- `released` status / auto-release sweeper (M12).
- Per-facility grace config (M3).
- In-app authed "Check in" button + admin override (M11) — easy follow-on that
  reuses the same window/guard helper; not needed for the QR flow.

## Frontend

- **`/checkin`** — new public SPA route in [App.tsx](../frontend/src/App.tsx)
  (outside the authed layout). Page `pages/checkin/CheckinPage.tsx`:
  - Phone-first, 44px targets (status-report #19). Single code input + big
    "Check in" button.
  - Auto-uppercase, accept pasted `ABCD-2345` or `ABCD2345`.
  - On success: green card with facility + time. On `422`: friendly reason
    (too early / too late / not approved). On `404`: "check the code or the
    email."
  - No navbar / auth — it's a kiosk-style page.
- **`api/public.api.ts`** (or inline) → `checkin(code)` hitting `/public/checkin`.

## Email

In `bookingConfirmed`, add a highlighted row to the details card:

> **Check-in code:** `ABCD-2345`
> *At the venue, scan the check-in QR and enter this code to confirm you've
> arrived.*

(Formatted big + monospace so it's easy to read off a phone.)

## Code touchpoints

| File | Change |
|------|--------|
| `scripts/migrations/048_booking_checkin.sql` | **new** — 3 columns + unique key |
| `utils/checkinCode.js` | **new** — `generate()` (safe alphabet, unique) |
| `utils/checkinWindow.js` | **new** — one helper owning the window math |
| `modules/bookings/bookings.controller.js` | mint code on create; pass to email |
| `modules/public/public.controller.js` | **+** `checkin` handler |
| `modules/public/public.routes.js` | **+** `POST /checkin` |
| `utils/mailTemplates.js` | `bookingConfirmed` → code row |
| `config/index.js` | `checkin: { opensMin, graceMin }` env reads |
| `frontend/src/App.tsx` | **+** public `/checkin` route |
| `frontend/src/pages/checkin/CheckinPage.tsx` | **new** — code entry + outcome |
| `scripts/backfill_checkin_codes.js` | **new** — codes for existing future bookings |

## Effort & risks

**S–M.**

- **Guessable without the code = safe; guessable *with* a leaked code = check-in
  only.** Worst case of a stolen code is marking someone present — no data
  exposure, no money. Acceptable for a public kiosk flow. (If that ever matters,
  the fallback is the "require login" variant.)
- **Timezone / clock skew:** all window math in server time via `NOW()`; the
  phone never decides.
- **Grace constants** live in one helper → swap for M3 per-facility config later.
- **Code collisions** handled by the unique key + regenerate loop.
