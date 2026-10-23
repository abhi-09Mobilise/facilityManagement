-- 051: external-source linkage for the Embassy org-hierarchy import.
--
-- Lets the daily Embassy->FM worker (embassy-pantry-bridge/src/importHierarchy.js)
-- key each FM row to the Embassy row it came from, so re-running the sync
-- UPSERTS instead of duplicating. We store:
--   source_system  'embassy'  (room for other feeds later)
--   source_ref     the Embassy table's own PK:
--                    organisations <- 0_org_pl.pl_id
--                    sites         <- 0_org_pc_block.id
--                    buildings     <- 0_org_pc_building.id
--                    floors        <- 0_org_pc_floor.id
--
-- Unique key is (tenant_id, source_system, source_ref). MySQL allows multiple
-- rows with NULLs in a UNIQUE key, so existing hand-created rows (NULL refs)
-- never collide. Guarded against information_schema for idempotent re-runs.

-- helper pattern repeated per table ----------------------------------------
-- organisations -------------------------------------------------------------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'organisations' AND COLUMN_NAME = 'source_system');
SET @sql := IF(@c = 0,
  'ALTER TABLE `organisations` ADD COLUMN `source_system` VARCHAR(20) NULL, ADD COLUMN `source_ref` BIGINT UNSIGNED NULL',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @i := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'organisations' AND INDEX_NAME = 'uk_orgs_source');
SET @sql := IF(@i = 0,
  'ALTER TABLE `organisations` ADD UNIQUE KEY `uk_orgs_source` (`tenant_id`,`source_system`,`source_ref`)',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- sites ---------------------------------------------------------------------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sites' AND COLUMN_NAME = 'source_system');
SET @sql := IF(@c = 0,
  'ALTER TABLE `sites` ADD COLUMN `source_system` VARCHAR(20) NULL, ADD COLUMN `source_ref` BIGINT UNSIGNED NULL',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @i := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sites' AND INDEX_NAME = 'uk_sites_source');
SET @sql := IF(@i = 0,
  'ALTER TABLE `sites` ADD UNIQUE KEY `uk_sites_source` (`tenant_id`,`source_system`,`source_ref`)',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- buildings -----------------------------------------------------------------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'buildings' AND COLUMN_NAME = 'source_system');
SET @sql := IF(@c = 0,
  'ALTER TABLE `buildings` ADD COLUMN `source_system` VARCHAR(20) NULL, ADD COLUMN `source_ref` BIGINT UNSIGNED NULL',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @i := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'buildings' AND INDEX_NAME = 'uk_buildings_source');
SET @sql := IF(@i = 0,
  'ALTER TABLE `buildings` ADD UNIQUE KEY `uk_buildings_source` (`tenant_id`,`source_system`,`source_ref`)',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- floors --------------------------------------------------------------------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'floors' AND COLUMN_NAME = 'source_system');
SET @sql := IF(@c = 0,
  'ALTER TABLE `floors` ADD COLUMN `source_system` VARCHAR(20) NULL, ADD COLUMN `source_ref` BIGINT UNSIGNED NULL',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @i := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'floors' AND INDEX_NAME = 'uk_floors_source');
SET @sql := IF(@i = 0,
  'ALTER TABLE `floors` ADD UNIQUE KEY `uk_floors_source` (`tenant_id`,`source_system`,`source_ref`)',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
