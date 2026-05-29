-- F09 - Desk layout canvas + per-desk bookings.
--
-- facilities.layout_json stores a JSON document describing how desks (and
-- optional meeting-room blocks) are placed on a grid. Shape:
--
--   {
--     "version": 1,
--     "rows":   8,
--     "cols":  12,
--     "cellSize": 72,
--     "desks": [
--       { "id": "D-01",  "label": "D-01",  "type": "desk",          "x": 0, "y": 0 },
--       { "id": "D-02",  "label": "D-02",  "type": "desk",          "x": 1, "y": 0 },
--       { "id": "MR-1",  "label": "MR-1",  "type": "meeting_room",  "x": 0, "y": 3 }
--     ]
--   }
--
-- A "desk" entry's `id` is a stable string the booker UI tags to a specific
-- booking. We store it on bookings.desk_id so future overlap checks can be
-- per-desk, not facility-wide.
--
-- desk_id is nullable: legacy bookings on non-desk facilities ignore it.
-- For 'desk'-type facilities the booking-create flow will require it.

ALTER TABLE `facilities`
  ADD COLUMN `layout_json` MEDIUMTEXT NULL AFTER `image_url`;

ALTER TABLE `bookings`
  ADD COLUMN `desk_id` VARCHAR(64) NULL AFTER `facility_id`,
  ADD INDEX `idx_bookings_desk_window` (`facility_id`, `desk_id`, `start_at`, `end_at`);
