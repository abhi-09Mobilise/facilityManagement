-- F09 extension - 'notification' is a third stage for facility chains.
--
-- Unlike 'checkin' (approval gate before booking confirms) and 'checkout'
-- (post-booking sign-off), 'notification' rows never gate the workflow -
-- they just identify people to email when the booking is approved or
-- cancelled. We re-use the same chain table + materialiser so admins can
-- compose recipients with the same UI as approvers.

ALTER TABLE `facility_approval_chains`
  MODIFY `stage` ENUM('checkin','checkout','notification') NOT NULL DEFAULT 'checkin';

ALTER TABLE `booking_approvals`
  MODIFY `stage` ENUM('checkin','checkout','notification') NOT NULL DEFAULT 'checkin';
