-- Pre-end cleanup notification feature.
--
-- 1. facilities.pre_end_notify_minutes — minutes BEFORE end_at to fire the
--    cleanup notification. NULL or 0 disables the feature for that facility.
-- 2. bookings.pre_end_notified_at — when (if ever) we fired the email. Set
--    by the cron handler the moment notifications go out so a second cron
--    tick doesn't re-send.
-- 3. facility_approval_chains.stage — extend ENUM to include 'cleanup'. The
--    cleanup chain holds the recipients (specific user OR dynamic dept
--    manager) who get the pre-end email. Independent from 'checkin' /
--    'checkout' / 'notification' so admins can give cleaning staff their
--    own list.
-- 4. booking_approvals.stage — same ENUM extension for symmetry, in case
--    we ever materialise a booking_approvals row for cleanup. We don't
--    today (cleanup is fire-and-forget mail), but keeping the columns
--    aligned saves a follow-up migration later.

ALTER TABLE `facilities`
  ADD COLUMN `pre_end_notify_minutes` INT NULL AFTER `max_per_user_per_month`;

ALTER TABLE `bookings`
  ADD COLUMN `pre_end_notified_at` DATETIME NULL AFTER `end_at`;

ALTER TABLE `facility_approval_chains`
  MODIFY `stage` ENUM('checkin','checkout','notification','cleanup')
  NOT NULL DEFAULT 'checkin';

ALTER TABLE `booking_approvals`
  MODIFY `stage` ENUM('checkin','checkout','notification','cleanup')
  NOT NULL DEFAULT 'checkin';
