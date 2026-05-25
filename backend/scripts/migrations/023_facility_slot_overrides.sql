-- F01 - Per-slot capacity overrides.
--
-- Each row says "for this facility, on day_of_week, between start_time and
-- end_time, allow between min_attendees and max_attendees instead of the
-- facility's default capacity".
--
-- The default capacity (facilities.capacity) still applies when NO override
-- matches the candidate slot. The booking capacity check is updated to
-- resolve the effective max via:
--   SELECT max_attendees, min_attendees
--     FROM facility_slot_overrides
--    WHERE facility_id=? AND day_of_week=DAYOFWEEK(start_at)-1
--      AND start_time<=TIME(start_at) AND end_time>=TIME(end_at)
--      AND status=1
--    LIMIT 1
-- (any match wins; the application layer rejects overlapping admin entries).

CREATE TABLE IF NOT EXISTS `facility_slot_overrides` (
  `id`            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `facility_id`   BIGINT UNSIGNED NOT NULL,
  `day_of_week`   TINYINT NOT NULL,             -- 0..6 Sun..Sat
  `start_time`    TIME NOT NULL,
  `end_time`      TIME NOT NULL,
  `min_attendees` INT NOT NULL DEFAULT 1,
  `max_attendees` INT NOT NULL,
  `status`        TINYINT(1) NOT NULL DEFAULT 1,
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_slot` (`facility_id`, `day_of_week`, `start_time`, `end_time`),
  KEY `idx_fso_lookup` (`facility_id`, `day_of_week`, `status`),
  CONSTRAINT `fk_fso_fac` FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
