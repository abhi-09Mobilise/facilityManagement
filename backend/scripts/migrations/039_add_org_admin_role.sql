-- Add 'org_admin' to the users.role enum.
--
-- The new order (super_admin, tenant_admin, org_admin, approver, employee)
-- is deliberate: reading top-to-bottom is the authority hierarchy.
-- org_admin sits between tenant_admin (full-tenant reach) and approver
-- (per-facility reach) — it can manage sites, departments and users
-- inside its own organisation but not across sibling orgs in the same
-- tenant.
--
-- No data backfill: nobody is auto-promoted to org_admin. Assignment
-- happens through the tenant-admin UI once the app is deployed.
--
-- Note: once the app rolls out, the Node controller will force
-- is_approver=1 on any user with role='org_admin' (mirrors how 020
-- treats role='approver'). We're keeping that rule in application code
-- rather than a DB trigger so it stays visible in code review.

ALTER TABLE `users`
  MODIFY COLUMN `role` ENUM('super_admin','tenant_admin','org_admin','approver','employee')
    NOT NULL DEFAULT 'employee';
