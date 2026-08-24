-- Backfill: give every existing site a "Default" building, then point
-- every existing floor at the building that belongs to its site.
--
-- Idempotent by design — the INSERT uses WHERE NOT EXISTS against the
-- (site_id, code='DEFAULT') unique key, and the UPDATE only touches
-- floors where building_id IS NULL. Re-running is a no-op.
--
-- IMPORTANT — trashed sites are backfilled TOO:
--   043 flips floors.building_id to NOT NULL. That MODIFY COLUMN scans
--   the whole table, not just live rows, so if any floor (even a
--   trashed one under a trashed site) still has building_id IS NULL
--   the alter fails. We therefore create a Default building for every
--   site regardless of trash — a soft-deleted site pointing at a
--   Default building changes nothing at the app level (the UI still
--   hides it via WHERE trash=0) but keeps the schema migration clean.
--
-- Same reasoning as 037: mirror trash-handling to avoid blowing up the
-- schema flip in the next migration.

INSERT INTO `buildings` (`tenant_id`, `organisation_id`, `site_id`, `name`, `code`, `status`, `trash`)
SELECT s.`tenant_id`, s.`organisation_id`, s.`id`, 'Default', 'DEFAULT', 1, 0
  FROM `sites` s
 WHERE NOT EXISTS (
         SELECT 1
           FROM `buildings` b
          WHERE b.`site_id` = s.`id`
            AND b.`code`    = 'DEFAULT'
       );

UPDATE `floors`
   SET `building_id` = (
         SELECT `id`
           FROM `buildings`
          WHERE `site_id` = `floors`.`site_id`
            AND `code`    = 'DEFAULT'
          LIMIT 1
       )
 WHERE `building_id` IS NULL;
