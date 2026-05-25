-- Tenant-admin owned. Two-table model:
--   `approval_workflows`       - one workflow per facility-type (or 'any')
--   `approval_workflow_steps`  - ordered approver chain
--
-- approver_type meaning:
--   'manager' → resolves to the booker's department manager_user_id at runtime
--   'role'    → first user in the tenant with the named role
--   'user'    → a specific user id

CREATE TABLE IF NOT EXISTS `approval_workflows` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`     BIGINT UNSIGNED NOT NULL,
  `name`          VARCHAR(180) NOT NULL,
  `facility_type` ENUM('meeting_room','gym','conference_room','desk','swimming_pool','other','any') NOT NULL DEFAULT 'any',
  `status`        TINYINT(1) NOT NULL DEFAULT 1,
  `trash`         TINYINT(1) NOT NULL DEFAULT 0,
  `created_at`    DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_wf_tenant` (`tenant_id`),
  CONSTRAINT `fk_wf_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `approval_workflow_steps` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `workflow_id`      BIGINT UNSIGNED NOT NULL,
  `step_order`       INT NOT NULL,
  `approver_type`    ENUM('manager','role','user') NOT NULL,
  `approver_user_id` BIGINT UNSIGNED NULL,
  `approver_role`    VARCHAR(40)     NULL,
  PRIMARY KEY (`id`),
  KEY `idx_wfs_workflow` (`workflow_id`),
  CONSTRAINT `fk_wfs_workflow` FOREIGN KEY (`workflow_id`) REFERENCES `approval_workflows`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
