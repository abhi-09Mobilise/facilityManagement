-- 050 (Milestone M3): customizable no-show grace period.
--
-- Adds a nullable `grace_period_minutes` at three scopes so different admin
-- levels can set it:
--   tenants        - super_admin / tenant_admin set a tenant-wide default
--   organisations  - org_admin (or higher) overrides for their org
--   facilities     - a per-facility override (finest grain)
--
-- Resolution precedence (see utils/graceConfig.js):
--   facility -> organisation (via facility.site_id -> sites.organisation_id)
--            -> tenant -> env default (config.checkin.graceMin).
-- NULL means "inherit from the next scope up", so leaving a level blank is the
-- normal case.
--
-- Guarded against information_schema so re-runs are safe (mirrors 048).

-- tenants.grace_period_minutes ---------------------------------------------
SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenants' AND COLUMN_NAME = 'grace_period_minutes');
SET @stmt := IF(@has_col = 0,
  'ALTER TABLE `tenants` ADD COLUMN `grace_period_minutes` INT UNSIGNED NULL',
  'SELECT 1');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

-- organisations.grace_period_minutes ---------------------------------------
SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'organisations' AND COLUMN_NAME = 'grace_period_minutes');
SET @stmt := IF(@has_col = 0,
  'ALTER TABLE `organisations` ADD COLUMN `grace_period_minutes` INT UNSIGNED NULL',
  'SELECT 1');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

-- facilities.grace_period_minutes ------------------------------------------
SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'facilities' AND COLUMN_NAME = 'grace_period_minutes');
SET @stmt := IF(@has_col = 0,
  'ALTER TABLE `facilities` ADD COLUMN `grace_period_minutes` INT UNSIGNED NULL AFTER `max_per_user_per_month`',
  'SELECT 1');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;
