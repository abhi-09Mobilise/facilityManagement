-- Promote 'approver' from a per-user flag to a first-class system role.
--
-- Before this migration:
--   - `users.role` was ENUM('super_admin','tenant_admin','employee')
--   - "Can this user act as an approver?" was decided by `users.is_approver`
--     (a 0/1 flag set by tenant admins on the user form).
--
-- After this migration:
--   - `users.role` is ENUM('super_admin','tenant_admin','approver','employee')
--   - The `is_approver` column is kept (chain-step queries still rely on it)
--     and is mirrored from the role: anyone with role='approver' has
--     is_approver=1 forced. Anyone with role='tenant_admin' can still also
--     be flagged is_approver=1 for cross-cutting approval roles, but it's
--     no longer required.
--   - Existing users who had is_approver=1 AND role='employee' get migrated
--     to role='approver' so the new dashboard surface immediately shows up
--     for them.

ALTER TABLE `users`
  MODIFY COLUMN `role` ENUM('super_admin','tenant_admin','approver','employee')
    NOT NULL DEFAULT 'employee';

-- Backfill: existing approvers move from employee -> approver. tenant_admins
-- and super_admins are left alone (they had implicit approver-like reach).
UPDATE `users`
   SET role = 'approver'
 WHERE role = 'employee'
   AND is_approver = 1
   AND trash = 0;

-- Mirror: make sure every approver has the flag set (defensive; backfilled
-- rows already do).
UPDATE `users`
   SET is_approver = 1
 WHERE role = 'approver'
   AND is_approver = 0;
