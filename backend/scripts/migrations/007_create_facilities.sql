-- Tenant-admin owned. A `facility` is a bookable instance (the actual room/desk).
-- `type` mirrors the facility cards in the frontend.
-- `facility_operating_hours` controls when each facility is open + slot granularity.

CREATE TABLE IF NOT EXISTS `facilities` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`         BIGINT UNSIGNED NOT NULL,
  `site_id`           BIGINT UNSIGNED NOT NULL,
  `floor_id`          BIGINT UNSIGNED NULL,
  `name`              VARCHAR(180) NOT NULL,
  `type`              ENUM('meeting_room','gym','conference_room','desk','swimming_pool','other') NOT NULL,
  `capacity`          INT          NOT NULL DEFAULT 0,
  `description`       TEXT NULL,
  `image_url`         VARCHAR(255) NULL,
  `requires_approval` TINYINT(1)   NOT NULL DEFAULT 0,
  `status`            TINYINT(1)   NOT NULL DEFAULT 1,
  `trash`             TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_facilities_tenant` (`tenant_id`),
  KEY `idx_facilities_site`   (`site_id`),
  KEY `idx_facilities_floor`  (`floor_id`),
  CONSTRAINT `fk_facilities_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_facilities_site`   FOREIGN KEY (`site_id`)   REFERENCES `sites`(`id`)   ON DELETE CASCADE,
  CONSTRAINT `fk_facilities_floor`  FOREIGN KEY (`floor_id`)  REFERENCES `floors`(`id`)  ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `facility_operating_hours` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `facility_id`    BIGINT UNSIGNED NOT NULL,
  `day_of_week`    TINYINT NOT NULL,             -- 0=Sun..6=Sat
  `open_time`      TIME    NOT NULL,
  `close_time`     TIME    NOT NULL,
  `slot_minutes`   INT     NOT NULL DEFAULT 30,
  PRIMARY KEY (`id`),
  KEY `idx_foh_facility` (`facility_id`),
  UNIQUE KEY `uk_foh_fac_day` (`facility_id`, `day_of_week`),
  CONSTRAINT `fk_foh_facility` FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
