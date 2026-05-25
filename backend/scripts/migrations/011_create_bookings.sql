-- Employee-driven (admins can view/manage). The four-table model:
--   bookings           - one row per booking
--   booking_guests     - external attendees
--   booking_meals      - pre-booked meal-time windows (junction to meal_times)
--   booking_approvals  - one row per approver per booking (chain of decisions)

CREATE TABLE IF NOT EXISTS `bookings` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`     BIGINT UNSIGNED NOT NULL,
  `facility_id`   BIGINT UNSIGNED NOT NULL,
  `user_id`       BIGINT UNSIGNED NOT NULL,
  `title`         VARCHAR(180) NULL,
  `start_at`      DATETIME NOT NULL,
  `end_at`        DATETIME NOT NULL,
  `repeat_type`   ENUM('none','daily','weekly_wed','custom') NOT NULL DEFAULT 'none',
  `status`        ENUM('pending','approved','rejected','cancelled','completed') NOT NULL DEFAULT 'pending',
  `remarks`       TEXT NULL,
  `dont_disturb`  TINYINT(1) NOT NULL DEFAULT 0,
  `trash`         TINYINT(1) NOT NULL DEFAULT 0,
  `created_at`    DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_bookings_tenant`         (`tenant_id`),
  KEY `idx_bookings_facility_start` (`facility_id`, `start_at`),
  KEY `idx_bookings_user`           (`user_id`),
  KEY `idx_bookings_status`         (`status`),
  CONSTRAINT `fk_bookings_tenant`   FOREIGN KEY (`tenant_id`)   REFERENCES `tenants`(`id`)    ON DELETE CASCADE,
  CONSTRAINT `fk_bookings_facility` FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_bookings_user`     FOREIGN KEY (`user_id`)     REFERENCES `users`(`id`)      ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `booking_guests` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `fname`      VARCHAR(120) NULL,
  `lname`      VARCHAR(120) NULL,
  `contact_no` VARCHAR(30)  NULL,
  `email`      VARCHAR(180) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_bg_booking` (`booking_id`),
  CONSTRAINT `fk_bg_booking` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `booking_meals` (
  `booking_id`   BIGINT UNSIGNED NOT NULL,
  `meal_time_id` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`booking_id`, `meal_time_id`),
  CONSTRAINT `fk_bm_booking` FOREIGN KEY (`booking_id`)   REFERENCES `bookings`(`id`)   ON DELETE CASCADE,
  CONSTRAINT `fk_bm_meal`    FOREIGN KEY (`meal_time_id`) REFERENCES `meal_times`(`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `booking_approvals` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `booking_id`       BIGINT UNSIGNED NOT NULL,
  `step_id`          BIGINT UNSIGNED NOT NULL,
  `approver_user_id` BIGINT UNSIGNED NOT NULL,
  `decision`         ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `remark`           TEXT     NULL,
  `decided_at`       DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ba_booking`  (`booking_id`),
  KEY `idx_ba_approver` (`approver_user_id`, `decision`),
  CONSTRAINT `fk_ba_booking` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`)                ON DELETE CASCADE,
  CONSTRAINT `fk_ba_step`    FOREIGN KEY (`step_id`)    REFERENCES `approval_workflow_steps`(`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
