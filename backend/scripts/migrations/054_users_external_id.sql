-- Embassy SSO handoff — add `external_id` to users.
--
-- When FMS is embedded under the Embassy app, the Embassy backend mints a
-- short-lived handoff JWT (signed with Embassy's private key) carrying the
-- Embassy user's identity in the `sub` claim. FMS looks that identity up
-- via `external_id` so email changes on either side don't break SSO.
--
-- Column is nullable + unique-when-set so:
--   - pre-existing FMS-only users stay untouched (no backfill needed)
--   - new Embassy users get an immutable mapping
--   - two users can both have external_id = NULL (local-only accounts)
--
-- Idempotent — uses information_schema guards so re-running the migration
-- on a DB that already has the column is a no-op (matches the pattern in
-- 036_organisation_id_columns.sql + 041_floors_building_id.sql).

-- ---- users.external_id -----------------------------------------------
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'users'
     AND COLUMN_NAME  = 'external_id'
);
SET @ddl := IF(
  @col_exists = 0,
  'ALTER TABLE `users` ADD COLUMN `external_id` VARCHAR(128) NULL AFTER `id`',
  'SELECT ''users.external_id already exists, skipping'' AS msg'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---- unique index (only enforced when non-null; MySQL allows multiple
-- NULLs in a UNIQUE column, which is exactly what we want) -------------
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'users'
     AND INDEX_NAME   = 'uk_users_external_id'
);
SET @ddl := IF(
  @idx_exists = 0,
  'CREATE UNIQUE INDEX `uk_users_external_id` ON `users` (`external_id`)',
  'SELECT ''uk_users_external_id already exists, skipping'' AS msg'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
