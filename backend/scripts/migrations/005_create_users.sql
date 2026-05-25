-- Spans all three roles via the `role` column.
--   super_admin: tenant_id IS NULL
--   tenant_admin / employee: tenant_id REQUIRED
-- department_id is intentionally a soft-reference (no FK) to avoid the
-- chicken-and-egg ordering with `departments`.

CREATE TABLE IF NOT EXISTS `users` (
  `id`                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`             BIGINT UNSIGNED NULL,
  `department_id`         BIGINT UNSIGNED NULL,
  `username`              VARCHAR(120) NOT NULL,
  `password`              VARCHAR(255) NOT NULL,
  `name`                  VARCHAR(120) NULL,
  `lname`                 VARCHAR(120) NULL,
  `email`                 VARCHAR(180) NULL,
  `mobile`                VARCHAR(20)  NULL,
  `user_img`              VARCHAR(255) NULL,
  `role`                  ENUM('super_admin','tenant_admin','employee') NOT NULL DEFAULT 'employee',
  `status`                TINYINT(1)   NOT NULL DEFAULT 1,
  `is_approved`           TINYINT(1)   NOT NULL DEFAULT 1,
  `trash`                 TINYINT(1)   NOT NULL DEFAULT 0,
  `login_attempts`        INT          NOT NULL DEFAULT 0,
  `login_clear_datetime`  DATETIME     NULL,
  `created_at`            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_users_username` (`username`),
  KEY `idx_users_tenant` (`tenant_id`),
  KEY `idx_users_email`  (`email`),
  CONSTRAINT `fk_users_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
