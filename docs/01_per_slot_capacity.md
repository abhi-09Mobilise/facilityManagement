# 01 — Per-slot capacity

**Goal.** Admins define operating-hour *slots* with their own min/max attendees, instead of a single facility-wide capacity.

## Current state
- `facilities.capacity` is one integer.
- `facility_operating_hours` has `slot_minutes` but no per-slot capacity.
- `bookings.attendee_count` and FOR-SHARE capacity check already exist (migration 021); they compare against `facilities.capacity`.

## Schema delta

```sql
-- 022_per_slot_capacity.sql
CREATE TABLE facility_slot_overrides (
  id INT AUTO_INCREMENT PRIMARY KEY,
  facility_id INT NOT NULL,
  day_of_week TINYINT NOT NULL,        -- 0..6 Sun..Sat
  start_time TIME NOT NULL,
  end_time   TIME NOT NULL,
  min_attendees INT NOT NULL DEFAULT 1,
  max_attendees INT NOT NULL,
  status TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_slot (facility_id, day_of_week, start_time, end_time),
  CONSTRAINT fk_fso_fac FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE CASCADE
);
```

`facilities.capacity` becomes the **default** when no override matches.

## API additions
- `GET  /facilities/:id/slot-capacities`
- `PUT  /facilities/:id/slot-capacities` — replace-all (array of overrides)
- Modify `bookings.controller.checkAvailability`: resolve `effectiveCapacity(facility, startAt, endAt)` by selecting any matching override; reject if `attendee_count < min` or `seats_taken + attendees > max`.

## UI
FacilityFormPage gets a "Slot capacities" section under Operating Hours.

```
┌─ Slot capacities (optional, overrides default capacity) ───────┐
│ Mon  09:00–12:00   Min[ 2] Max[12]   [x]                       │
│ Mon  13:00–17:00   Min[ 1] Max[ 8]   [x]                       │
│ [+ Add slot]                                                   │
└────────────────────────────────────────────────────────────────┘
```

## UX copy
- Empty state: *"No overrides — every slot allows up to {capacity} attendees."*
- Validation: *"Min cannot exceed Max."* / *"This range overlaps with Mon 09:00–12:00."*

## Effort & risks
**M.** Risks: range overlap validation; use half-open intervals `[start, end)`.
