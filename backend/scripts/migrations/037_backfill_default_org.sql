-- Backfill: give every existing tenant a "Default" organisation, then
-- point every existing site / department / user at it.
--
-- Idempotent by design — the INSERT uses WHERE NOT EXISTS against the
-- (tenant_id, slug='default') unique key, and the UPDATEs only touch rows
-- where organisation_id IS NULL. Re-running is a no-op.
--
-- IMPORTANT — trashed rows are backfilled TOO:
--   038 flips sites/departments to NOT NULL. That MODIFY COLUMN scans the
--   whole table, not just live rows, so if any trashed site or department
--   still has organisation_id IS NULL the alter fails. We therefore
--   backfill regardless of trash — a soft-deleted site pointing at a
--   Default org changes nothing at the app level (the UI still hides it
--   via WHERE trash=0) but keeps the schema migration clean.
--
-- Users with tenant_id IS NULL (super_admins) are intentionally skipped;
-- their organisation_id stays NULL, which is legal per the schema and
-- stays legal after 038 (users.organisation_id keeps NULLABLE).
--
-- Same reasoning applies to trashed tenants: they still get a Default org
-- so their (possibly trashed) children can point somewhere.

INSERT INTO `organisations` (`tenant_id`, `name`, `slug`, `status`, `trash`)
SELECT t.`id`, 'Default', 'default', 1, 0
  FROM `tenants` t
 WHERE NOT EXISTS (
         SELECT 1
           FROM `organisations` o
          WHERE o.`tenant_id` = t.`id`
            AND o.`slug` = 'default'
       );

UPDATE `sites`
   SET `organisation_id` = (
         SELECT `id`
           FROM `organisations`
          WHERE `tenant_id` = `sites`.`tenant_id`
            AND `slug` = 'default'
          LIMIT 1
       )
 WHERE `organisation_id` IS NULL;

UPDATE `departments`
   SET `organisation_id` = (
         SELECT `id`
           FROM `organisations`
          WHERE `tenant_id` = `departments`.`tenant_id`
            AND `slug` = 'default'
          LIMIT 1
       )
 WHERE `organisation_id` IS NULL;

UPDATE `users`
   SET `organisation_id` = (
         SELECT `id`
           FROM `organisations`
          WHERE `tenant_id` = `users`.`tenant_id`
            AND `slug` = 'default'
          LIMIT 1
       )
 WHERE `organisation_id` IS NULL
   AND `tenant_id` IS NOT NULL;
