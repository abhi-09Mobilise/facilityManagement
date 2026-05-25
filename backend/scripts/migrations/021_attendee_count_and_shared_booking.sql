-- Shared / capacity-bounded bookings.
--
-- New columns:
--   bookings.attendee_count
--     The number of seats this booking occupies. Computed at create-time as
--     1 (the booker) + COUNT(booking_guests). Stored on the row so the
--     capacity-check SUM(...) at insert time is a single index range scan
--     instead of a triple-join.
--
--   facilities.shared_booking (0/1)
--     Opt-in flag. When 0 (default, today's behavior): only one booking can
--     occupy a facility for a given window - the booking controller's
--     hasConflict()-style check refuses any overlap. When 1: multiple
--     bookings can co-exist as long as the total attendee_count for any
--     overlapping window stays <= facility.capacity.
--
-- Race-condition guard (in the controller, not in SQL):
--   The booking-create transaction runs at InnoDB's default REPEATABLE READ
--   isolation. After INSERTing the new booking, the controller issues
--   SELECT SUM(attendee_count) ... WHERE start_at<? AND end_at>? FOR SHARE
--   on the same facility. InnoDB takes gap locks on the index range, so a
--   second concurrent transaction either sees the first row in its SUM (and
--   rolls back if over capacity) or blocks until the first commits.
--
-- Backward compatibility:
--   - shared_booking defaults to 0, so all existing facilities behave as
--     before (exclusive). Admins opt in per facility from the Facilities
--     form.
--   - attendee_count is backfilled for every existing booking; no row goes
--     stale.

ALTER TABLE `bookings`
  ADD COLUMN `attendee_count` INT NOT NULL DEFAULT 1 AFTER `dont_disturb`;

-- Backfill: every existing booking gets 1 (the booker) plus however many
-- guest rows it has.
UPDATE `bookings` b
   SET b.attendee_count = 1 + (
     SELECT COUNT(*) FROM `booking_guests` g WHERE g.booking_id = b.id
   );

-- Index supporting the capacity-check range scan. Existing
-- idx_bookings_facility_start covers (facility_id, start_at) but the
-- capacity sum also needs end_at + status, so a covering index helps.
CREATE INDEX `idx_bookings_capacity_window`
  ON `bookings` (`facility_id`, `status`, `start_at`, `end_at`);

-- Per-facility opt-in flag for shared bookings.
ALTER TABLE `facilities`
  ADD COLUMN `shared_booking` TINYINT(1) NOT NULL DEFAULT 0 AFTER `requires_approval`;
