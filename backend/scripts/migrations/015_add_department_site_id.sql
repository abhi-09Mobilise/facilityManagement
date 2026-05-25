-- Departments now belong to a specific site.
--
-- Going forward, new departments require a site_id (enforced at the
-- controller layer, not as NOT NULL — to keep older rows valid).
-- Existing rows keep their NULL site_id until an admin reassigns them.

ALTER TABLE `departments`
  ADD COLUMN `site_id` BIGINT UNSIGNED NULL AFTER `tenant_id`;

CREATE INDEX `idx_depts_site` ON `departments` (`site_id`);
