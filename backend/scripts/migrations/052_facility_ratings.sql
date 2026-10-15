-- 052: facility feedback ratings.
--
-- Captures the 1-5 star rating + optional comment + optional predefined
-- tags that a booker gives for a completed booking. One rating per
-- booking (UNIQUE on booking_id) — users can update their existing row
-- but can't double-submit.
--
-- Flow (both paths write into this table):
--   • Authenticated: /my-bookings → Rate modal → POST /api/ratings
--   • Email link:    /rate/:token  → public page → POST /api/public/ratings/:token
--
-- Site / building / floor context is NOT denormalised here — the dashboard
-- aggregation JOINs through facilities to get those (facilities already
-- store site_id, building_id, floor_id). Same for reviewer name — JOIN
-- to users table when the admin needs it.
--
-- `bookings.feedback_email_sent_at` is added on the bookings table so the
-- feedback mailer cron doesn't double-email the same booking.
--
-- Idempotent (information_schema guards, mirrors 048/050/051).

-- facility_ratings table ---------------------------------------------------
SET @has_table := (SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'facility_ratings');
SET @stmt := IF(@has_table = 0,
  'CREATE TABLE `facility_ratings` (
    `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `booking_id`  BIGINT UNSIGNED NOT NULL,
    `facility_id` BIGINT UNSIGNED NOT NULL,
    `tenant_id`   BIGINT UNSIGNED NOT NULL,
    `user_id`     BIGINT UNSIGNED NOT NULL,
    `stars`       TINYINT UNSIGNED NOT NULL,
    `comment`     TEXT NULL,
    `tags`        JSON NULL,
    `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_rating_per_booking` (`booking_id`),
    KEY `idx_fr_facility_created` (`facility_id`, `created_at`),
    KEY `idx_fr_tenant_created` (`tenant_id`, `created_at`),
    KEY `idx_fr_stars` (`stars`),
    CONSTRAINT `chk_fr_stars_range` CHECK (`stars` BETWEEN 1 AND 5)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
  'SELECT 1');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

-- bookings.feedback_email_sent_at -----------------------------------------
-- Set by the feedbackMailer cron the first time it emails a user about a
-- completed booking. NULL = no feedback request sent yet (eligible for
-- the next run). Any non-NULL value = already asked, don't re-send.
SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'feedback_email_sent_at');
SET @stmt := IF(@has_col = 0,
  'ALTER TABLE `bookings` ADD COLUMN `feedback_email_sent_at` DATETIME NULL AFTER `channel`',
  'SELECT 1');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

-- Index on feedback_email_sent_at + status for the mailer cron query.
SET @has_idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND INDEX_NAME = 'idx_bookings_feedback_mail');
SET @stmt := IF(@has_idx = 0,
  'ALTER TABLE `bookings` ADD INDEX `idx_bookings_feedback_mail` (`status`, `feedback_email_sent_at`, `end_at`)',
  'SELECT 1');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;
