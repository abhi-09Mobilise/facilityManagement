-- Lock in the buildings layer under floors: floors.building_id becomes
-- NOT NULL and gets its FK against buildings(id).
--
-- WARNING: this migration WILL FAIL if any row in `floors` still has
-- building_id IS NULL. Run 042 first, then verify with:
--
--     SELECT COUNT(*) FROM floors WHERE building_id IS NULL;
--
-- Must return 0 before applying this file. Trashed rows count too — the
-- MODIFY COLUMN scans the whole table, not just live rows.
--
-- FK actions:
--   - floors → buildings: ON DELETE RESTRICT. Deleting a building with
--     attached floors should be blocked at the DB level, not silently
--     cascade destroy customer data. (The app-level controller returns
--     a friendly 409 with a count before it ever hits this FK.)
--
-- IDEMPOTENT (MySQL 8.0): re-runnable after a partial failure. The
-- MODIFY COLUMN only fires when the column is still NULLable, and the
-- FK is added only if it isn't already present.

-- ---- floors.building_id  ->  NOT NULL -------------------------------
SET @nul := (SELECT IS_NULLABLE FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME   = 'floors'
               AND COLUMN_NAME  = 'building_id');
SET @sql := IF(@nul = 'YES',
  'ALTER TABLE `floors` MODIFY COLUMN `building_id` BIGINT UNSIGNED NOT NULL',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---- floors.fk_floors_building --------------------------------------
SET @fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
            WHERE TABLE_SCHEMA    = DATABASE()
              AND TABLE_NAME      = 'floors'
              AND CONSTRAINT_NAME = 'fk_floors_building'
              AND CONSTRAINT_TYPE = 'FOREIGN KEY');
SET @sql := IF(@fk = 0,
  'ALTER TABLE `floors` ADD CONSTRAINT `fk_floors_building` FOREIGN KEY (`building_id`) REFERENCES `buildings`(`id`) ON DELETE RESTRICT',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
