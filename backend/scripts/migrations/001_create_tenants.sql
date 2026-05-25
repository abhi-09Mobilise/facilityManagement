-- Super-admin owned. Every other tenant-scoped table FKs back here.
-- A tenant is one organization on the platform.

CREATE TABLE IF NOT EXISTS `tenants` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`           VARCHAR(180) NOT NULL,
  `slug`           VARCHAR(80)  NOT NULL,
  `contact_email`  VARCHAR(180) NULL,
  `contact_phone`  VARCHAR(30)  NULL,
  `currency_code`  VARCHAR(8)   NOT NULL DEFAULT 'INR',
  `timezone`       VARCHAR(64)  NOT NULL DEFAULT 'Asia/Kolkata',
  `locale`         VARCHAR(16)  NOT NULL DEFAULT 'en-IN',
  `status`         ENUM('trial','active','suspended') NOT NULL DEFAULT 'trial',
  `trash`          TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenants_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
