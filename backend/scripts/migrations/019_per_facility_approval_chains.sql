-- Per-facility approval chains.
--
-- Replaces the tenant-level approval_workflows + approval_workflow_steps tables
-- (see migrations 010, 013, 016) with a chain attached directly to each facility.
--
-- New shape:
--   facilities.facility_approver_user_id  - the "facility person" (eg the
--       swimming-pool admin) - shown on the facility edit form and used as
--       the default step 2 of the chain.
--   facility_approval_chains              - one row per step. approver_kind
--       is either 'user' (a fixed user_id) or 'dynamic_dept_manager'
--       (resolved at booking-time to the booker's department manager, with a
--       fallback to any active tenant_admin).
--   approval_action_tokens                - single-use tokens emailed to
--       approvers; the token only identifies the booking_approvals row, the
--       decide endpoint still enforces RBAC (req.user.id === approver).
--
-- booking_approvals.step_id used to FK to approval_workflow_steps; we now
-- denormalise step_order onto booking_approvals itself and drop the FK so
-- the legacy tables can be dropped.

-- 1. Denormalise step_order onto booking_approvals + drop the FK.
ALTER TABLE `booking_approvals`
  DROP FOREIGN KEY `fk_ba_step`;

ALTER TABLE `booking_approvals`
  ADD COLUMN `step_order` SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER `step_id`,
  MODIFY COLUMN `step_id` BIGINT UNSIGNED NULL;

-- Best-effort backfill of step_order from the old workflow_steps table
-- (no-op once those rows are gone).
UPDATE `booking_approvals` ba
  INNER JOIN `approval_workflow_steps` s ON s.id = ba.step_id
   SET ba.step_order = s.step_order;

ALTER TABLE `booking_approvals`
  ADD KEY `idx_ba_booking_step` (`booking_id`, `step_order`);

-- 2. Facility-level approver pointer (the "facility person").
ALTER TABLE `facilities`
  ADD COLUMN `facility_approver_user_id` BIGINT UNSIGNED NULL AFTER `requires_approval`,
  ADD KEY `idx_facilities_approver` (`facility_approver_user_id`),
  ADD CONSTRAINT `fk_facilities_approver`
      FOREIGN KEY (`facility_approver_user_id`) REFERENCES `users`(`id`)
      ON DELETE SET NULL;

-- 3. Per-facility approval chain.
CREATE TABLE IF NOT EXISTS `facility_approval_chains` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `facility_id`      BIGINT UNSIGNED NOT NULL,
  `step_order`       SMALLINT UNSIGNED NOT NULL,
  `approver_kind`    ENUM('user','dynamic_dept_manager') NOT NULL,
  `approver_user_id` BIGINT UNSIGNED NULL,
  `created_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_chain_facility_step` (`facility_id`, `step_order`),
  KEY `idx_chain_facility` (`facility_id`),
  CONSTRAINT `fk_chain_facility`
    FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_chain_user`
    FOREIGN KEY (`approver_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. One-time tokens for email "Approve / Reject" links.
CREATE TABLE IF NOT EXISTS `approval_action_tokens` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `token_hash`          CHAR(64)        NOT NULL,
  `booking_approval_id` BIGINT UNSIGNED NOT NULL,
  `expires_at`          DATETIME        NOT NULL,
  `used_at`             DATETIME        NULL,
  `created_at`          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_aat_token_hash` (`token_hash`),
  KEY `idx_aat_approval` (`booking_approval_id`, `used_at`),
  CONSTRAINT `fk_aat_approval`
    FOREIGN KEY (`booking_approval_id`) REFERENCES `booking_approvals`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Drop the legacy tables. CASCADE handles any residual references.
DROP TABLE IF EXISTS `approval_workflow_steps`;
DROP TABLE IF EXISTS `approval_workflows`;
