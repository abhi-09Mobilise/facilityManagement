# 02 — Two-stage approval (check-in + check-out)

**Goal.** Today's chain fires *before* booking. Add a second chain that fires *after* the booking window completes (cleaning, returns, post-use sign-off).

## Current state
- `facility_approval_chains` is a single chain per facility.
- `booking_approvals` rows are materialized at create.
- Status moves to `approved` when all rows decide.

## Schema delta

```sql
-- 023_checkout_chain.sql
ALTER TABLE facility_approval_chains
  ADD COLUMN stage ENUM('checkin','checkout') NOT NULL DEFAULT 'checkin',
  DROP INDEX uq_chain_step,
  ADD UNIQUE KEY uq_chain_step (facility_id, stage, step_order);

ALTER TABLE booking_approvals
  ADD COLUMN stage ENUM('checkin','checkout') NOT NULL DEFAULT 'checkin';

ALTER TABLE bookings
  ADD COLUMN checkout_status ENUM('not_started','pending','approved','rejected')
    NOT NULL DEFAULT 'not_started';
```

## Lifecycle

```
employee submits ──► materialize CHECKIN chain ──► emails sent ──► approved
                                                                        │
                                       (cron, every 5 min)              ▼
                            booking.end_at < NOW() AND status='approved'
                                              │
                                              ▼
                    materialize CHECKOUT chain ──► emails sent
                          │
                          ▼
                  all checkout rows decided ──► checkout_status='approved'
```

## Code touchpoints
- `chainMaterializer.materializeChain({stage})`.
- New job `jobs/checkoutSweeper.js` runs on `setInterval(5 * 60_000)` — selects approved bookings where `end_at < NOW()` and `checkout_status='not_started'`, materializes checkout chain, emails approvers.
- `approvals.controller.decide` already groups by `booking_id`; add `AND stage=?` to the "all decided?" query before flipping `bookings.status` vs `checkout_status`.

## API
- `GET /facilities/:id/chain?stage=checkin|checkout`
- `PUT /facilities/:id/chain?stage=checkin|checkout`
- Existing `/approvals/inbox` already returns the row — UI shows a `stage` chip.

## UI
- FacilityFormPage: chain editor gets a tab toggle "Check-in approvers | Check-out approvers".
- ApprovalsInboxPage: each row badge "Check-in" or "Check-out".

## Effort & risks
**M.** Risks: cron drift (alternative: trigger lazily on first read of `/bookings/:id` past `end_at`).
