# 04 — 3D floor design per site

**Goal.** Users navigate a site as a 3D model and click a facility to open its booking page.

## Current state
None. Floors are flat rows in `floors`.

## Approach
Don't build a CAD tool — accept a **glTF (.glb)** upload per floor and place clickable hotspots that map to 3D objects by `meshName`.

## Schema delta

```sql
-- 025_3d_floors.sql
ALTER TABLE floors
  ADD COLUMN model_url VARCHAR(512) NULL,           -- S3/disk path to .glb
  ADD COLUMN model_uploaded_at DATETIME NULL;

CREATE TABLE facility_hotspots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  facility_id INT NOT NULL UNIQUE,
  floor_id INT NOT NULL,
  mesh_name VARCHAR(128) NOT NULL,    -- name of the node in the .glb to highlight
  label VARCHAR(64),
  CONSTRAINT fk_fh_fac FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE CASCADE,
  CONSTRAINT fk_fh_floor FOREIGN KEY (floor_id) REFERENCES floors(id) ON DELETE CASCADE
);
```

## API
- `POST /floors/:id/model` — multipart upload (.glb, max 25MB).
- `GET  /floors/:id/model` — returns `model_url` + hotspots array.
- `PUT  /facilities/:id/hotspot` — `{ floor_id, mesh_name, label }`.

## Frontend
- New page `/sites/:id/3d`.
- Library: **`@react-three/fiber` + `@react-three/drei`** (~120KB gz).
- Click a hotspot → `navigate('/facility/' + id)`.

```
┌─ Site: Mumbai HQ ─ [Floor 3 ▾] ─────────────────────────────┐
│                                                             │
│              [ 3D viewer canvas — orbit/zoom ]              │
│                                                             │
│   Hover: "Conference Room A — Capacity 12"                  │
│   Click: opens booking flow                                 │
└─────────────────────────────────────────────────────────────┘
```

## UX copy
- Missing model: *"3D view not available for this floor."* with admin CTA "Upload model".

## Effort & risks
**L.** Risks: model sourcing (admins won't have .glb — provide SketchUp/Blender export guide); mobile performance (2D fallback floorplan PNG).
