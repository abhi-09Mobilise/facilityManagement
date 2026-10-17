-- Junction table for the many-to-many relationship between bookings and
-- desks. Replaces the old anti-pattern of storing comma-separated desk IDs
-- in `bookings.desk_id` (which overflowed VARCHAR(64) when 6+ desks were
-- selected at once).
--
-- Each row holds exactly one desk claim; multi-desk bookings get multiple
-- rows. Clean 1NF, indexable, FK-safe.
--
-- Rollout plan (dual-source during transition):
--   • CREATE: new bookings INSERT one row per desk here. `bookings.desk_id`
--     is set to NULL — the junction is the source of truth.
--   • READ: overlap checks + "which desks are taken" queries read from
--     `booking_desks`. The old `bookings.desk_id` column still holds
--     comma-separated legacy values for pre-migration rows (also mirrored
--     into this junction by the backfill below).
--   • `bookings.desk_id` column kept NULLABLE for rollback safety. A later
--     migration can DROP it once all read paths are confirmed migrated.

CREATE TABLE IF NOT EXISTS `booking_desks` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `desk_id`    VARCHAR(64)     NOT NULL,
  `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_bd_booking_desk` (`booking_id`, `desk_id`),
  KEY `idx_bd_desk`    (`desk_id`),
  KEY `idx_bd_booking` (`booking_id`),
  CONSTRAINT `fk_bd_booking`
    FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Backfill: split every existing `bookings.desk_id` comma-string into one
-- row per desk. Uses a tally table trick to split without stored procs.
--
-- Idempotent via INSERT IGNORE + the unique key — re-running this
-- statement is a no-op after the first successful run.
INSERT IGNORE INTO `booking_desks` (`booking_id`, `desk_id`)
SELECT
  b.id,
  TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(b.desk_id, ',', n.n), ',', -1)) AS desk_id
FROM `bookings` AS b
CROSS JOIN (
  SELECT 1 AS n UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
  UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8
  UNION ALL SELECT 9 UNION ALL SELECT 10 UNION ALL SELECT 11 UNION ALL SELECT 12
  UNION ALL SELECT 13 UNION ALL SELECT 14 UNION ALL SELECT 15 UNION ALL SELECT 16
  UNION ALL SELECT 17 UNION ALL SELECT 18 UNION ALL SELECT 19 UNION ALL SELECT 20
) AS n
WHERE b.desk_id IS NOT NULL
  AND b.desk_id <> ''
  AND n.n <= 1 + LENGTH(b.desk_id) - LENGTH(REPLACE(b.desk_id, ',', ''))
  AND TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(b.desk_id, ',', n.n), ',', -1)) <> '';
