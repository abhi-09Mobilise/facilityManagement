-- Tenant-admin owned. Departments form the org chart inside one tenant.
-- `manager_user_id` is a soft-reference to users (used by approval workflows
-- when approver_type='manager') — no FK to avoid circular dependencies.

CREATE TABLE IF NOT EXISTS `departments` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`       BIGINT UNSIGNED NOT NULL,
  `name`            VARCHAR(180) NOT NULL,
  `code`            VARCHAR(60)  NULL,
  `parent_dept_id`  BIGINT UNSIGNED NULL,
  `manager_user_id` BIGINT UNSIGNED NULL,
  `status`          TINYINT(1)   NOT NULL DEFAULT 1,
  `trash`           TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_depts_tenant` (`tenant_id`),
  UNIQUE KEY `uk_depts_tenant_code` (`tenant_id`, `code`),
  CONSTRAINT `fk_depts_tenant` FOREIGN KEY (`tenant_id`)      REFERENCES `tenants`(`id`)     ON DELETE CASCADE,
  CONSTRAINT `fk_depts_parent` FOREIGN KEY (`parent_dept_id`) REFERENCES `departments`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
