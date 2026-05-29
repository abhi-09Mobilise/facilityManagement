-- Split facility capacity into online (bookable) + offline (reserved).
--
-- capacity stays = total seat count. offline_capacity is the number of
-- those seats that are NOT bookable via the system (held back for VIPs,
-- maintenance, walk-ins, etc). The booker pre-flight + create race-check
-- both treat (capacity - offline_capacity) as the cap.
--
-- Defaults to 0 so every existing facility is fully online unless an
-- admin opts a subset offline.

ALTER TABLE `facilities`
  ADD COLUMN `offline_capacity` INT NOT NULL DEFAULT 0 AFTER `capacity`;
