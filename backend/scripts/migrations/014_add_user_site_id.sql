-- Add site_id to users. Lets admins record which site an employee primarily
-- works out of (purely informational — doesn't restrict bookings on its own).
-- Soft reference (no FK constraint): if a site is later trashed, the user row
-- isn't blocked — the app layer treats orphaned site_ids as 'no site set'.

ALTER TABLE `users`
  ADD COLUMN `site_id` BIGINT UNSIGNED NULL AFTER `department_id`;

CREATE INDEX `idx_users_site` ON `users` (`site_id`);
