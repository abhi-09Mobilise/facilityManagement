-- Add department_id to bookings so managers can roll up "how many facilities
-- has my department booked this month" reports without joining through users.
--
-- The value is auto-populated from the booker's users.department_id at
-- create-time (see bookings.controller.create). Bookings made by users with
-- no department (e.g. super admins) get NULL.

ALTER TABLE `bookings`
  ADD COLUMN `department_id` BIGINT UNSIGNED NULL AFTER `user_id`,
  ADD KEY    `idx_bookings_department` (`tenant_id`, `department_id`, `start_at`);
