-- Roles & permissions matrix (configurable RBAC, Phase A).
--
-- The permission CATALOG (keys, labels, grouping) and the fallback default
-- matrix live in code: src/modules/permissions/permissions.catalog.js.
-- This table stores only the DELTAS an admin has saved:
--
--   tenant_id NULL  -> global default override  (edited by super_admin)
--   tenant_id set   -> per-tenant override      (edited by that tenant's
--                      tenant_admin, or super_admin targeting the tenant)
--
-- Resolution order (permissions.service.js):
--   tenant override -> global override -> code default.
--
-- `allowed` values:
--   'yes'  - full access
--   'team' - limited to direct reports / own department ("Team only")
--   'no'   - denied
--
-- Guardrails enforced in the controller, not here:
--   * super_admin rows are never written (implicit 'yes' for everything)
--   * roles.manage can never be granted to employee
--   * a save may not remove roles.manage from every admin role

CREATE TABLE IF NOT EXISTS `role_permissions` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`      BIGINT UNSIGNED NULL,
  `role`           ENUM('tenant_admin','org_admin','approver','employee') NOT NULL,
  `permission_key` VARCHAR(64) NOT NULL,
  `allowed`        ENUM('yes','team','no') NOT NULL,
  `updated_by`     BIGINT UNSIGNED NULL,
  `created_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_role_perm` (`tenant_id`, `role`, `permission_key`),
  KEY `idx_perm_tenant` (`tenant_id`),
  CONSTRAINT `fk_roleperm_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
