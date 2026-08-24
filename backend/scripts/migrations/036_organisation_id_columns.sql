-- Add `organisation_id` to sites, departments, and users.
--
-- Columns are nullable in this migration so 037 can backfill them against
-- the auto-created "Default" org per tenant; 038 then flips sites and
-- departments to NOT NULL + adds the FK constraints. Users stays NULLABLE
-- forever because super_admins have no tenant and therefore no org.
--
-- No FKs are added here on purpose — creating the FK before the column
-- is populated would either force a NOT NULL up front (breaking existing
-- rows) or silently allow orphan NULLs to slip past 038.
--
-- IDEMPOTENT (MySQL 8.0): re-runnable after a partial failure. MySQL has
-- no ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS, so each op is
-- guarded by an information_schema lookup.

-- ---- sites.organisation_id ------------------------------------------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME   = 'sites'
             AND COLUMN_NAME  = 'organisation_id');
SET @sql := IF(@c = 0,
  'ALTER TABLE `sites` ADD COLUMN `organisation_id` BIGINT UNSIGNED NULL AFTER `tenant_id`',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @i := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME   = 'sites'
             AND INDEX_NAME   = 'idx_sites_org');
SET @sql := IF(@i = 0,
  'CREATE INDEX `idx_sites_org` ON `sites` (`organisation_id`)',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---- departments.organisation_id ------------------------------------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME   = 'departments'
             AND COLUMN_NAME  = 'organisation_id');
SET @sql := IF(@c = 0,
  'ALTER TABLE `departments` ADD COLUMN `organisation_id` BIGINT UNSIGNED NULL AFTER `tenant_id`',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @i := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME   = 'departments'
             AND INDEX_NAME   = 'idx_depts_org');
SET @sql := IF(@i = 0,
  'CREATE INDEX `idx_depts_org` ON `departments` (`organisation_id`)',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---- users.organisation_id ------------------------------------------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME   = 'users'
             AND COLUMN_NAME  = 'organisation_id');
SET @sql := IF(@c = 0,
  'ALTER TABLE `users` ADD COLUMN `organisation_id` BIGINT UNSIGNED NULL AFTER `tenant_id`',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @i := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME   = 'users'
             AND INDEX_NAME   = 'idx_users_org');
SET @sql := IF(@i = 0,
  'CREATE INDEX `idx_users_org` ON `users` (`organisation_id`)',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
