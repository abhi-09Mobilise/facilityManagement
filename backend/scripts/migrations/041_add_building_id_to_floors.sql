-- Add `building_id` to `floors` so every floor can hang under a building.
--
-- Column is nullable so 042 can backfill; 043 flips to NOT NULL + adds FK.
--
-- No FK is added here on purpose — creating the FK before the column is
-- populated would either force a NOT NULL up front (breaking existing
-- rows) or silently allow orphan NULLs to slip past 043.
--
-- IDEMPOTENT (MySQL 8.0): re-runnable after a partial failure. MySQL has
-- no ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS, so each op is
-- guarded by an information_schema lookup.

-- ---- floors.building_id ---------------------------------------------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME   = 'floors'
             AND COLUMN_NAME  = 'building_id');
SET @sql := IF(@c = 0,
  'ALTER TABLE `floors` ADD COLUMN `building_id` BIGINT UNSIGNED NULL AFTER `site_id`',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @i := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME   = 'floors'
             AND INDEX_NAME   = 'idx_floors_building');
SET @sql := IF(@i = 0,
  'CREATE INDEX `idx_floors_building` ON `floors` (`building_id`)',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
