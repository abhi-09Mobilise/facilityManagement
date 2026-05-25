# 07 — Reschedule / cancel via mail

**Goal.** Approval emails already have Approve/Reject links. Booking-confirmation emails should add "Reschedule" and "Cancel" links the booker can click without a second login.

## Current state
`approvalActionTokens.js` handles single-use tokens for one specific approval row. No equivalent for the booker.

## Schema delta

```sql
-- 028_booking_action_tokens.sql
CREATE TABLE booking_action_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id INT NOT NULL,
  user_id INT NOT NULL,                -- must match req.user.id when consumed
  action ENUM('cancel','reschedule') NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  CONSTRAINT fk_bat_b FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
);
```

## API
- `GET /bookings/:id/act?token=...&action=cancel` — requires login; verifies `req.user.id === user_id`; cancels and marks `used_at`.
- `GET /bookings/:id/act?token=...&action=reschedule` — redirects to `/my-bookings?reschedule=ID` (the form pre-fills).
- New: `POST /bookings/:id/reschedule` — only when `status IN ('pending','approved')` AND `start_at > NOW()`; on accept, re-run capacity check + re-materialize check-in chain inside a transaction.

## Email template additions
In `mailTemplates.bookingConfirmed` add two buttons: "Reschedule" (yellow) and "Cancel" (red), both pointing at `/bookings/:id/act?token=...&action=...&next=<deeplink>`. Reuse the LoginPage `?next=` bounce.

## UX copy in mail
- *"Plans changed? You can [Reschedule] or [Cancel] this booking. Links expire in 7 days."*
- Post-action page: *"Booking cancelled. The approver has been notified."*

## Effort
**S.**
