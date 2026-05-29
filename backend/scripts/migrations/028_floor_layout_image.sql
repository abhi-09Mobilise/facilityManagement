-- F09 - Optional floor plan image attached to a Floor master.
--
-- When admins design a facility (desk or meeting_room) that lives on a
-- floor with this image set, the layout editor uses it as the default
-- canvas background, so multiple facilities on the same floor share a
-- consistent reference plan. MEDIUMTEXT keeps headroom for a base64
-- data URL (~ up to 1.5 MB after the SKILL upload cap on the frontend).

ALTER TABLE `floors`
  ADD COLUMN `layout_image_url` MEDIUMTEXT NULL AFTER `level_number`;
