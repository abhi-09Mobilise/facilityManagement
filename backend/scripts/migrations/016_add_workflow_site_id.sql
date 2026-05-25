-- Approval workflows can now be scoped to a specific site.
--
--   site_id IS NULL  → tenant-wide (applies to all sites, the old behaviour)
--   site_id = N      → only bookings on facilities at site N
--
-- Match priority at runtime (workflowMatcher.findWorkflow):
--   1. site matches      AND facility_type matches  ← most specific
--   2. site matches      AND facility_type = 'any'
--   3. site IS NULL      AND facility_type matches
--   4. site IS NULL      AND facility_type = 'any'  ← least specific
--
-- Existing rows get NULL (tenant-wide), so nothing breaks.

ALTER TABLE `approval_workflows`
  ADD COLUMN `site_id` BIGINT UNSIGNED NULL AFTER `tenant_id`;

CREATE INDEX `idx_wf_site_type` ON `approval_workflows` (`tenant_id`, `site_id`, `facility_type`);
