-- F06 - Pantries, menu items, facility links and booking orders.
--
-- pantries:           one per site (cafe / canteen / snack bar).
-- pantry_menu_items:  items each pantry sells (with optional meal_time link).
-- facility_pantries:  many-to-many between facilities and pantries on the
--                     same site. Booking flow only shows pantries here.
-- booking_pantry_orders: chosen items per booking.

CREATE TABLE IF NOT EXISTS `pantries` (
  `id`         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `tenant_id`  BIGINT UNSIGNED NOT NULL,
  `site_id`    BIGINT UNSIGNED NOT NULL,
  `name`       VARCHAR(128) NOT NULL,
  `status`     TINYINT(1) NOT NULL DEFAULT 1,
  `trash`      TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_pantry_site` (`site_id`, `status`),
  KEY `idx_pantry_tenant` (`tenant_id`, `status`),
  CONSTRAINT `fk_pantry_site`   FOREIGN KEY (`site_id`)   REFERENCES `sites`(`id`)   ON DELETE CASCADE,
  CONSTRAINT `fk_pantry_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `pantry_menu_items` (
  `id`            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `pantry_id`     BIGINT UNSIGNED NOT NULL,
  `name`          VARCHAR(128) NOT NULL,
  `meal_time_id`  BIGINT UNSIGNED NULL,
  `price`         DECIMAL(10,2) NOT NULL DEFAULT 0,
  `status`        TINYINT(1) NOT NULL DEFAULT 1,
  KEY `idx_pmi_pantry` (`pantry_id`, `status`),
  CONSTRAINT `fk_pmi_pantry` FOREIGN KEY (`pantry_id`)    REFERENCES `pantries`(`id`)   ON DELETE CASCADE,
  CONSTRAINT `fk_pmi_meal`   FOREIGN KEY (`meal_time_id`) REFERENCES `meal_times`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `facility_pantries` (
  `facility_id` BIGINT UNSIGNED NOT NULL,
  `pantry_id`   BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`facility_id`, `pantry_id`),
  KEY `idx_fp_pantry` (`pantry_id`),
  CONSTRAINT `fk_fp_facility` FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_fp_pantry`   FOREIGN KEY (`pantry_id`)   REFERENCES `pantries`(`id`)   ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `booking_pantry_orders` (
  `id`           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `booking_id`   BIGINT UNSIGNED NOT NULL,
  `menu_item_id` BIGINT UNSIGNED NOT NULL,
  `quantity`     BIGINT UNSIGNED NOT NULL DEFAULT 1,
  KEY `idx_bpo_booking` (`booking_id`),
  CONSTRAINT `fk_bpo_booking`   FOREIGN KEY (`booking_id`)   REFERENCES `bookings`(`id`)          ON DELETE CASCADE,
  CONSTRAINT `fk_bpo_menu_item` FOREIGN KEY (`menu_item_id`) REFERENCES `pantry_menu_items`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
