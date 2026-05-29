-- Configurable advance-booking rules per facility.
--
-- All five columns are NULLABLE — NULL means "no rule, unlimited".
--
--   min_advance_minutes        : booker must book at least N minutes in advance.
--                                e.g. 60  => can't book a slot starting in < 1h.
--   max_advance_days           : booker can't book more than N days into the future.
--                                e.g. 30  => date input maxes at today + 30d.
--   max_per_user_per_day       : a single user can hold at most N active
--                                (pending/approved) bookings whose start_at
--                                falls inside the same calendar day.
--   max_per_user_per_week      : same idea, week = Monday 00:00 -> next Monday 00:00.
--   max_per_user_per_month     : same idea, month = 1st 00:00 -> 1st of next month 00:00.
--
-- Cancelled bookings are excluded from the count so they free the slot.
-- super_admin + tenant_admin bypass all five rules (admin override).

ALTER TABLE `facilities`
  ADD COLUMN `min_advance_minutes`    INT NULL AFTER `offline_capacity`,
  ADD COLUMN `max_advance_days`       INT NULL AFTER `min_advance_minutes`,
  ADD COLUMN `max_per_user_per_day`   INT NULL AFTER `max_advance_days`,
  ADD COLUMN `max_per_user_per_week`  INT NULL AFTER `max_per_user_per_day`,
  ADD COLUMN `max_per_user_per_month` INT NULL AFTER `max_per_user_per_week`;
