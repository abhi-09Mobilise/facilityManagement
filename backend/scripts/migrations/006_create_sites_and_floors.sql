-- Tenant-admin owned. A `site` is a physical campus/office.
-- `floors` sub-divide a site - keep it simple, one level deep is enough for V1.

CREATE TABLE IF NOT EXISTS `sites` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`  BIGINT UNSIGNED NOT NULL,
  `name`       VARCHAR(180) NOT NULL,
  `code`       VARCHAR(60)  NULL,
  `address`    VARCHAR(500) NULL,
  `timezone`   VARCHAR(64)  NULL,
  `status`     TINYINT(1)   NOT NULL DEFAULT 1,
  `trash`      TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sites_tenant` (`tenant_id`),
  UNIQUE KEY `uk_sites_tenant_code` (`tenant_id`, `code`),
  CONSTRAINT `fk_sites_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `floors` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`     BIGINT UNSIGNED NOT NULL,
  `site_id`       BIGINT UNSIGNED NOT NULL,
  `name`          VARCHAR(120) NOT NULL,        -- 'Block A / Floor 3'
  `level_number`  INT          NULL,
  `status`        TINYINT(1)   NOT NULL DEFAULT 1,
  `trash`         TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_floors_tenant` (`tenant_id`),
  KEY `idx_floors_site`   (`site_id`),
  CONSTRAINT `fk_floors_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_floors_site`   FOREIGN KEY (`site_id`)   REFERENCES `sites`(`id`)   ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
