-- 048 (Milestone M10 / M15): QR check-in data model.
--
-- Adds the three columns the arrival-check-in flow needs. See
-- docs/10_qr_checkin.md for the full design.
--
--   checkin_code    short, non-guessable code emailed to the booker. The
--                   public /checkin page accepts THIS, never the raw numeric
--                   booking id (which is sequential and guessable). 8 chars
--                   from a human-safe alphabet (no 0/O/1/I/L). UNIQUE so the
--                   public endpoint can resolve a booking from the code alone,
--                   with no tenant context.
--   checked_in_at   set when the person confirms arrival. NULL = not yet.
--   checked_out_at  reserved for a future check-out; the QR page is check-in
--                   only for now.
--
-- Idempotency:
--   Every ADD is guarded against information_schema so re-runs are safe,
--   mirroring 046_stable_desk_ids.sql.

-- checkin_code --------------------------------------------------------------
SET @has_col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings'
     AND COLUMN_NAME = 'checkin_code'
);
SET @stmt := IF(@has_col = 0,
  'ALTER TABLE `bookings` ADD COLUMN `checkin_code` CHAR(8) NULL AFTER `status`',
  'SELECT 1');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

-- checked_in_at -------------------------------------------------------------
SET @has_col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings'
     AND COLUMN_NAME = 'checked_in_at'
);
SET @stmt := IF(@has_col = 0,
  'ALTER TABLE `bookings` ADD COLUMN `checked_in_at` DATETIME NULL AFTER `checkin_code`',
  'SELECT 1');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

-- checked_out_at ------------------------------------------------------------
SET @has_col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings'
     AND COLUMN_NAME = 'checked_out_at'
);
SET @stmt := IF(@has_col = 0,
  'ALTER TABLE `bookings` ADD COLUMN `checked_out_at` DATETIME NULL AFTER `checked_in_at`',
  'SELECT 1');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

-- UNIQUE key on checkin_code (NULLs are allowed/duplicated in MySQL, so
-- un-minted historical rows don't collide). Guarded for idempotency.
SET @has_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings'
     AND INDEX_NAME = 'uq_bookings_checkin_code'
);
SET @stmt := IF(@has_idx = 0,
  'ALTER TABLE `bookings` ADD UNIQUE KEY `uq_bookings_checkin_code` (`checkin_code`)',
  'SELECT 1');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;
