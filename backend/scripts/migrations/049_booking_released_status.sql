-- 049 (Milestone M12): no-show auto-release status.
--
-- Adds 'released' to `bookings.status`. The no-show sweeper
-- (jobs/noShowSweeper.js) flips an approved booking to 'released' once its
-- check-in grace window closes with no check-in, so the seat frees up.
--
-- Why a new status rather than reusing 'cancelled':
--   'released' = the SYSTEM freed a no-show; 'cancelled' = a human cancelled.
--   Keeping them distinct lets no-show analytics tell the two apart.
--
-- Seat availability is DERIVED from bookings (there is no per-seat status
-- column). Every availability / capacity query whitelists
--   status IN ('pending','approved','completed')
-- so 'released' — deliberately absent from that list — frees the desk and the
-- shared-capacity count automatically, with no change to those queries.
--
-- MODIFY is naturally idempotent (re-applying sets the same enum), and the
-- migration runner applies each file once regardless.

ALTER TABLE `bookings`
  MODIFY `status`
    ENUM('pending','approved','rejected','cancelled','completed','released')
    NOT NULL DEFAULT 'pending';
