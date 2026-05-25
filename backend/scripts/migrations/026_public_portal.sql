-- F03 - Public portal (sites + facilities, no login).
--
-- - tenants.public_portal_enabled gates whether /public/t/:slug renders at all
-- - tenants.public_slug is the public-friendly identifier in the URL (separate
--   from the existing internal `slug` field which is used for login bounces)
-- - facilities.public_listed flags which facilities appear in the catalog

ALTER TABLE `tenants`
  ADD COLUMN `public_portal_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN `public_slug` VARCHAR(64) NULL,
  ADD UNIQUE KEY `uq_tenants_public_slug` (`public_slug`);

ALTER TABLE `facilities`
  ADD COLUMN `public_listed` TINYINT(1) NOT NULL DEFAULT 0;
