-- T1.4 (Milestone M6): Daily occupancy aggregation table.
--
-- Purpose:
--   Pre-computed daily rollup of booking usage. Dashboards + scheduled
--   reports read from this table instead of scanning the (potentially huge)
--   `bookings` table on every request. HLD ref: section 4.1.
--
-- Grain (unique key):
--   one row per (day, facility_id, department_id). Higher-level dims
--   (site, building, floor) are denormalised on the row so slice-by-site
--   / slice-by-floor queries don't need joins.
--
-- Populated by:
--   - jobs/occupancyAggregator.js         nightly incremental run for yesterday
--   - POST /api/cron/aggregate-occupancy  external scheduler trigger (idempotent)
--   - scripts/backfill_occupancy.js       one-time 90-day backfill (T1.5)
--
-- Idempotency:
--   The aggregator issues `INSERT ... ON DUPLICATE KEY UPDATE` per row.
--   Re-running the aggregator for the same day is safe — measures are
--   recomputed from scratch, not incremented. Late-arriving cancellations
--   or check-outs flip counters correctly on the next run.
--
-- Department denormalisation:
--   `department_id` is BIGINT UNSIGNED NOT NULL DEFAULT 0. Value 0 means
--   "no department known" (booker had no department at booking time).
--   Storing 0 rather than NULL keeps the unique key simple (InnoDB PK
--   cannot contain NULL). No FK to `departments` because departments can
--   be trashed after bookings exist, and analytics history must survive.
--
-- Measures:
--   bookings_count    number of active bookings that intersect the day
--                     (status IN pending / approved / completed)
--   released_count    number of intersecting bookings now status='cancelled'
--   checked_in_count  number of intersecting bookings with
--                     checkout_status='approved' (checked-in AND out)
--   booked_minutes    SUM of minutes each active booking overlaps [00:00,24:00)
--                     of the day. Clipped so a multi-day booking counts only
--                     that day's slice.
--   open_minutes      (facility.capacity * 1440) - booked_minutes, floored at 0.
--                     Simple v1. If capacity=0, this is 0.

CREATE TABLE IF NOT EXISTS `occupancy_daily` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `day`             DATE            NOT NULL,
  `tenant_id`       BIGINT UNSIGNED NOT NULL,
  `site_id`         BIGINT UNSIGNED NULL,
  `building_id`     BIGINT UNSIGNED NULL,
  `floor_id`        BIGINT UNSIGNED NULL,
  `facility_id`     BIGINT UNSIGNED NOT NULL,
  `department_id`   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `bookings_count`  INT UNSIGNED    NOT NULL DEFAULT 0,
  `released_count`  INT UNSIGNED    NOT NULL DEFAULT 0,
  `checked_in_count` INT UNSIGNED   NOT NULL DEFAULT 0,
  `booked_minutes`  INT UNSIGNED    NOT NULL DEFAULT 0,
  `open_minutes`    INT UNSIGNED    NOT NULL DEFAULT 0,
  `created_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_occ_grain`      (`day`, `facility_id`, `department_id`),
  KEY        `idx_occ_tenant_day`   (`tenant_id`, `day`),
  KEY        `idx_occ_site_day`     (`site_id`, `day`),
  KEY        `idx_occ_building_day` (`building_id`, `day`),
  KEY        `idx_occ_floor_day`    (`floor_id`, `day`),
  KEY        `idx_occ_dept_day`     (`department_id`, `day`),
  KEY        `idx_occ_facility_day` (`facility_id`, `day`),
  CONSTRAINT `fk_occ_tenant`   FOREIGN KEY (`tenant_id`)   REFERENCES `tenants`(`id`)    ON DELETE CASCADE,
  CONSTRAINT `fk_occ_facility` FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
