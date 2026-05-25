-- F02 - Two-stage approval (check-in + check-out).
--
-- Adds a `stage` enum to facility_approval_chains and booking_approvals
-- so the same chain machinery can drive a second approval workflow that
-- fires after the booking ends (cleaning, returns, post-use sign-off).
-- Also adds checkout_status to bookings so we can track the second
-- workflow independent of the primary `status` column.
--
-- A periodic sweeper (jobs/checkoutSweeper.js) inserts CHECKOUT rows for
-- bookings that completed in the last sweep window.
--
-- IDEMPOTENT (MySQL 8.0.30): re-runnable after a partial failure.
-- MySQL 8.0 has no IF (NOT) EXISTS on ADD/DROP COLUMN or CREATE/DROP/ADD
-- INDEX (those are MariaDB extensions), so every change is guarded by an
-- information_schema lookup.

-- facility_approval_chains.stage
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME   = 'facility_approval_chains'
             AND COLUMN_NAME  = 'stage');
SET @sql := IF(@c = 0,
  'ALTER TABLE `facility_approval_chains` ADD COLUMN `stage` ENUM(''checkin'',''checkout'') NOT NULL DEFAULT ''checkin'' AFTER `facility_id`',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Replace the old (facility_id, step_order) unique key with one that includes `stage`.
SET @i := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME   = 'facility_approval_chains'
             AND INDEX_NAME   = 'uq_chain_step');
SET @sql := IF(@i > 0,
  'ALTER TABLE `facility_approval_chains` DROP INDEX `uq_chain_step`',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @i := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME   = 'facility_approval_chains'
             AND INDEX_NAME   = 'uq_chain_step');
SET @sql := IF(@i = 0,
  'ALTER TABLE `facility_approval_chains` ADD UNIQUE KEY `uq_chain_step` (`facility_id`, `stage`, `step_order`)',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- booking_approvals.stage
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME   = 'booking_approvals'
             AND COLUMN_NAME  = 'stage');
SET @sql := IF(@c = 0,
  'ALTER TABLE `booking_approvals` ADD COLUMN `stage` ENUM(''checkin'',''checkout'') NOT NULL DEFAULT ''checkin'' AFTER `booking_id`',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- bookings.checkout_status
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME   = 'bookings'
             AND COLUMN_NAME  = 'checkout_status');
SET @sql := IF(@c = 0,
  'ALTER TABLE `bookings` ADD COLUMN `checkout_status` ENUM(''not_started'',''pending'',''approved'',''rejected'') NOT NULL DEFAULT ''not_started'' AFTER `status`',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Sweep index.
SET @i := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME   = 'bookings'
             AND INDEX_NAME   = 'idx_bookings_checkout_sweep');
SET @sql := IF(@i = 0,
  'CREATE INDEX `idx_bookings_checkout_sweep` ON `bookings` (`status`, `checkout_status`, `end_at`)',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
