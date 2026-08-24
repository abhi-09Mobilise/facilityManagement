-- Per-facility Terms & Conditions.
--
-- Tenants want different rules per room (gym requires shoes; pool requires
-- a swim cap; conference room requires food cleanup, etc.). One column on
-- facilities is enough — markdown or plain text, free-form, NULL means
-- "no T&Cs configured" and the booker sees no checkbox.
--
-- Stored as TEXT (up to ~64 KB) — admins rarely write more than a few
-- paragraphs but TEXT is the cheap insurance.

ALTER TABLE `facilities`
  ADD COLUMN `terms_and_conditions` TEXT NULL AFTER `description`;
