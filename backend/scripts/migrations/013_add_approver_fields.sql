-- Adds the approver-pool model.
--   users.designation   - org title (free text, e.g. "Team Lead", "Manager")
--   users.is_approver   - eligible to appear on workflow steps
--
-- Note: `is_approved` (already present) means "this account is approved to
-- log in". `is_approver` (new) means "this user can be picked as an approver
-- in an approval workflow". Different things — yes, the names are unfortunate.
--
-- Workflow steps are simplified — every step is now just a specific user.
--   - approver_type   removed (was: manager / role / user)
--   - approver_role   removed (no more "first user with role X" lookup)
--   - approver_user_id is now NOT NULL
--
-- Wipes any existing step rows whose approver_user_id is NULL (they were the
-- old "manager" type rows which can no longer be expressed). Admins must
-- rebuild affected workflows with specific approver users.

ALTER TABLE `users`
  ADD COLUMN `designation` VARCHAR(80) NULL AFTER `mobile`,
  ADD COLUMN `is_approver` TINYINT(1) NOT NULL DEFAULT 0 AFTER `is_approved`;

CREATE INDEX `idx_users_is_approver` ON `users` (`tenant_id`, `is_approver`);

DELETE FROM `approval_workflow_steps` WHERE `approver_user_id` IS NULL;

ALTER TABLE `approval_workflow_steps`
  DROP COLUMN `approver_type`,
  DROP COLUMN `approver_role`,
  MODIFY COLUMN `approver_user_id` BIGINT UNSIGNED NOT NULL;
