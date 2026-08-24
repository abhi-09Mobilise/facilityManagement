-- Lock in the organisation layer: sites and departments become NOT NULL
-- against organisations(id); users keeps its column NULLABLE (super_admins
-- have neither a tenant nor an org) but still gets the FK.
--
-- WARNING: this migration WILL FAIL if any row in `sites` or `departments`
-- still has organisation_id IS NULL. Run 037 first, then verify with:
--
--     SELECT COUNT(*) FROM sites       WHERE organisation_id IS NULL;
--     SELECT COUNT(*) FROM departments WHERE organisation_id IS NULL;
--
-- Both must return 0 before applying this file. Trashed rows count too —
-- the MODIFY COLUMN scans the whole table, not just live rows.
--
-- FK actions:
--   - sites / departments  → ON DELETE RESTRICT: deleting an organisation
--     with attached sites or departments should be blocked, not silently
--     cascade destroy customer data.
--   - users                → ON DELETE SET NULL: users can outlive their
--     organisation (e.g. reassignment during an org merge); the app layer
--     handles reattaching them.
--
-- IDEMPOTENT (MySQL 8.0): re-runnable after a partial failure. The MODIFY
-- COLUMN only fires when the column is still NULLable, and each FK is
-- added only if it isn't already present.

-- ---- sites.organisation_id  ->  NOT NULL ----------------------------
SET @nul := (SELECT IS_NULLABLE FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME   = 'sites'
               AND COLUMN_NAME  = 'organisation_id');
SET @sql := IF(@nul = 'YES',
  'ALTER TABLE `sites` MODIFY COLUMN `organisation_id` BIGINT UNSIGNED NOT NULL',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---- sites.fk_sites_organisation ------------------------------------
SET @fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
            WHERE TABLE_SCHEMA    = DATABASE()
              AND TABLE_NAME      = 'sites'
              AND CONSTRAINT_NAME = 'fk_sites_organisation'
              AND CONSTRAINT_TYPE = 'FOREIGN KEY');
SET @sql := IF(@fk = 0,
  'ALTER TABLE `sites` ADD CONSTRAINT `fk_sites_organisation` FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON DELETE RESTRICT',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---- departments.organisation_id  ->  NOT NULL ----------------------
SET @nul := (SELECT IS_NULLABLE FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME   = 'departments'
               AND COLUMN_NAME  = 'organisation_id');
SET @sql := IF(@nul = 'YES',
  'ALTER TABLE `departments` MODIFY COLUMN `organisation_id` BIGINT UNSIGNED NOT NULL',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---- departments.fk_departments_organisation ------------------------
SET @fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
            WHERE TABLE_SCHEMA    = DATABASE()
              AND TABLE_NAME      = 'departments'
              AND CONSTRAINT_NAME = 'fk_departments_organisation'
              AND CONSTRAINT_TYPE = 'FOREIGN KEY');
SET @sql := IF(@fk = 0,
  'ALTER TABLE `departments` ADD CONSTRAINT `fk_departments_organisation` FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON DELETE RESTRICT',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---- users.fk_users_organisation (column stays NULLable) ------------
SET @fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
            WHERE TABLE_SCHEMA    = DATABASE()
              AND TABLE_NAME      = 'users'
              AND CONSTRAINT_NAME = 'fk_users_organisation'
              AND CONSTRAINT_TYPE = 'FOREIGN KEY');
SET @sql := IF(@fk = 0,
  'ALTER TABLE `users` ADD CONSTRAINT `fk_users_organisation` FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON DELETE SET NULL',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
