-- Mark pantry menu items as paid or free. When is_paid = 0 the `price`
-- column is ignored by the booker UI (we keep the column so historical
-- prices aren't lost when an admin toggles an item back to paid).

ALTER TABLE `pantry_menu_items`
  ADD COLUMN `is_paid` TINYINT(1) NOT NULL DEFAULT 0 AFTER `price`;

-- Backfill: anything with a non-zero price is assumed to have been paid,
-- everything else gets the new default (free).
UPDATE `pantry_menu_items`
   SET `is_paid` = 1
 WHERE `price` IS NOT NULL AND `price` > 0;
