-- T1.1 (M1): Prep the schema for the stable-desk-id backfill.
--
-- What this migration does:
--   1. Adds `bookings.legacy_desk_id` VARCHAR(64) NULL.
--      The backfill script (scripts/fix_desk_ids.js) copies the ORIGINAL
--      `bookings.desk_id` into this column BEFORE rewriting `desk_id`
--      to the new `FAC<facilityId>-D<seq>` format. This preserves a
--      complete rollback path — if the backfill has a bug we can UPDATE
--      bookings SET desk_id = legacy_desk_id WHERE legacy_desk_id IS
--      NOT NULL to fully reverse.
--
--   2. Leaves `bookings.desk_id` alone. The actual rewrite is done by
--      the backfill script (which runs OUTSIDE this migration and MUST
--      be executed manually — see docs/09/T1.1_runbook.md).
--
-- Idempotency:
--   Uses information_schema to skip the ADD COLUMN if the column already
--   exists so re-runs are safe.
--
-- Post-backfill cleanup (Phase 2, separate migration ~048):
--   Once the backfill is verified stable in production for at least one
--   release cycle, `legacy_desk_id` can be dropped in a follow-up
--   migration. Keeping it for now protects rollback.

-- Add legacy_desk_id column, guarded for idempotency.
SET @has_col := (
  SELECT COUNT(*)
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'bookings'
     AND COLUMN_NAME  = 'legacy_desk_id'
);
SET @stmt := IF(
  @has_col = 0,
  'ALTER TABLE `bookings` ADD COLUMN `legacy_desk_id` VARCHAR(64) NULL AFTER `desk_id`',
  'SELECT 1'
);
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

-- Covering index for rollback / audit queries. Guarded like above.
SET @has_idx := (
  SELECT COUNT(*)
    FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'bookings'
     AND INDEX_NAME   = 'idx_bookings_legacy_desk'
);
SET @stmt := IF(
  @has_idx = 0,
  'ALTER TABLE `bookings` ADD KEY `idx_bookings_legacy_desk` (`legacy_desk_id`)',
  'SELECT 1'
);
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;
