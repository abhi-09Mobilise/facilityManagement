# 06 — Per-facility pantry list (site-scoped menus)

**Goal.** While booking, user sees only the pantries assigned to that facility's site, and picks menu items.

## Current state
`meal_times` is tenant-wide. `CreateBookingPayload.meal_time_ids` already exists. No pantry concept.

## Schema delta

```sql
-- 027_pantries.sql
CREATE TABLE pantries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  site_id INT NOT NULL,
  name VARCHAR(128) NOT NULL,
  status TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT fk_pantry_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);
CREATE TABLE pantry_menu_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pantry_id INT NOT NULL,
  name VARCHAR(128) NOT NULL,
  meal_time_id INT,                  -- optional link to existing meal_times
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  status TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT fk_pmi_p FOREIGN KEY (pantry_id) REFERENCES pantries(id) ON DELETE CASCADE
);
CREATE TABLE facility_pantries (         -- many-to-many
  facility_id INT NOT NULL,
  pantry_id INT NOT NULL,
  PRIMARY KEY (facility_id, pantry_id),
  CONSTRAINT fk_fp_fac FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE CASCADE,
  CONSTRAINT fk_fp_p   FOREIGN KEY (pantry_id) REFERENCES pantries(id) ON DELETE CASCADE
);
CREATE TABLE booking_pantry_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id INT NOT NULL,
  menu_item_id INT NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  CONSTRAINT fk_bpo_b FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
);
```

## API
- Pantries CRUD (`tenant_admin`): `/pantries`, `/pantries/:id/menu`.
- Link: `PUT /facilities/:id/pantries` — `{ pantry_ids: [] }`.
- Booking page: `GET /facilities/:id/menu` returns pantries with their items.
- `CreateBookingPayload` gains `pantry_orders: [{menu_item_id, quantity}]`.

## UI
- New Masters child "Pantries".
- FacilityFormPage section "Available pantries" with multi-select.
- FacilityDetailPage adds an expandable "Order from pantry" panel during booking.

```
┌─ Order from pantry (optional) ─────────────────────────┐
│  Pantry: [Café 4F ▾]                                   │
│  ☐ Sandwich  ₹120   Qty [ ]                            │
│  ☐ Espresso  ₹ 60   Qty [ ]                            │
│  Total: ₹0                                             │
└────────────────────────────────────────────────────────┘
```

## Effort
**M.**
