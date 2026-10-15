-- 051: tag every booking with the channel it was created through so the
-- SpaceDesk "Booking channel" dashboard tile can show real breakdowns.
--
-- Values match the dashboard donut slices:
--   'portal'  - this web app's /api/bookings endpoint (default for existing + new rows)
--   'app'     - a mobile app booking endpoint (future; set by that endpoint when it exists)
--   'qr'      - QR-scan walk-in booking endpoint (future)
--   'tablet'  - door-mounted tablet booking endpoint (future)
--
-- Nullable so legacy integrations creating rows directly stay safe.
-- Existing rows are backfilled to 'portal' because every booking in the
-- system today was created through the web portal (confirmed by audit —
-- /public routes are view-only, /public/checkin only sets checked_in_at).
--
-- Guarded against information_schema so re-runs are safe (mirrors 048, 050).

-- bookings.channel ---------------------------------------------------------
SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'channel');
SET @stmt := IF(@has_col = 0,
  "ALTER TABLE `bookings` ADD COLUMN `channel` ENUM('portal','app','qr','tablet') NULL AFTER `status`",
  'SELECT 1');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

-- Index for the dashboard aggregation query (channel + tenant + date).
SET @has_idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND INDEX_NAME = 'idx_bookings_channel');
SET @stmt := IF(@has_idx = 0,
  'ALTER TABLE `bookings` ADD INDEX `idx_bookings_channel` (`channel`)',
  'SELECT 1');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

-- Backfill: every existing row came from the web portal.
-- Only touches rows where channel is still NULL — idempotent for re-runs.
UPDATE `bookings` SET `channel` = 'portal' WHERE `channel` IS NULL;
