-- Tenant-admin owned. A meal_time is a named time window an employee can
-- pre-book against a booking, e.g. "Morning Tea 09:30-10:00".
-- Linked to bookings via the `booking_meals` junction (see migration 011).

CREATE TABLE IF NOT EXISTS `meal_times` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`  BIGINT UNSIGNED NOT NULL,
  `name`       VARCHAR(80) NOT NULL,            -- 'Morning Tea','Lunch','Evening Snacks'
  `start_time` TIME NOT NULL,
  `end_time`   TIME NOT NULL,
  `status`     TINYINT(1) NOT NULL DEFAULT 1,
  `trash`      TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_meals_tenant` (`tenant_id`),
  UNIQUE KEY `uk_meals_tenant_name` (`tenant_id`, `name`),
  CONSTRAINT `fk_meals_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
