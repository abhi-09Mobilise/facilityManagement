-- Introduce the `buildings` layer between Site and Floor.
--
-- Phase A of the hierarchy rollout after the organisations layer. A site
-- (physical campus / office lot) can now group its floors under one or
-- more buildings — e.g. a corporate park site might have separate towers
-- A, B, C each with their own floor stack. `code` is unique WITHIN a
-- site (not globally) so two different sites can each have a "DEFAULT"
-- building or their own local naming schemes like "T1" / "T2".
--
-- A building inherits its organisation from its parent site. We still
-- carry `organisation_id` on this table so joins and org-scoped filters
-- stay cheap and don't have to bounce through `sites` every time.
--
-- This migration is additive only. Backfill lives in 042 (per-site
-- Default building), the floors.building_id nullable column in 041, and
-- the NOT NULL + FK flip in 043.

CREATE TABLE IF NOT EXISTS `buildings` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`        BIGINT UNSIGNED NOT NULL,
  `organisation_id`  BIGINT UNSIGNED NOT NULL,
  `site_id`          BIGINT UNSIGNED NOT NULL,
  `name`             VARCHAR(180) NOT NULL,
  `code`             VARCHAR(60)  NULL,
  `address`          VARCHAR(500) NULL,
  `status`           TINYINT(1)   NOT NULL DEFAULT 1,
  `trash`            TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_buildings_tenant` (`tenant_id`),
  KEY `idx_buildings_org`    (`organisation_id`),
  KEY `idx_buildings_site`   (`site_id`),
  UNIQUE KEY `uk_buildings_site_code` (`site_id`, `code`),
  CONSTRAINT `fk_buildings_tenant`       FOREIGN KEY (`tenant_id`)       REFERENCES `tenants`(`id`)       ON DELETE CASCADE,
  CONSTRAINT `fk_buildings_organisation` FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_buildings_site`         FOREIGN KEY (`site_id`)         REFERENCES `sites`(`id`)         ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
