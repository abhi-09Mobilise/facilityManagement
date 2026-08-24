-- Introduce the `organisations` layer between Tenant and Sites.
--
-- Stage 1 of the org rollout. A tenant (the paying customer on the platform)
-- can now group its sites under one or more organisations — e.g. a holding
-- company tenant might carve out separate orgs per subsidiary, each with
-- their own sites, departments and users. Slugs are unique per tenant
-- (not globally) so two different tenants can each have a "default" org.
--
-- This migration is additive only. Backfill and FK wiring happen in
-- 037 and 038 respectively.

CREATE TABLE IF NOT EXISTS `organisations` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`   BIGINT UNSIGNED NOT NULL,
  `name`        VARCHAR(180) NOT NULL,
  `slug`        VARCHAR(80)  NOT NULL,
  `logo_url`    VARCHAR(500) NULL,
  `status`      TINYINT(1)   NOT NULL DEFAULT 1,
  `trash`       TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_orgs_tenant` (`tenant_id`),
  UNIQUE KEY `uk_orgs_tenant_slug` (`tenant_id`, `slug`),
  CONSTRAINT `fk_orgs_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
