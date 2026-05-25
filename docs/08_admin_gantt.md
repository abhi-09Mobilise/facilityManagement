# 08 — Admin Gantt chart (facilities × time, drill-down)

**Goal.** Tenant admin sees all facilities on one timeline per site, can click a date or a facility to drill in.

## Current state
`/dashboard` has KPI tiles + bar + pies (recharts). No timeline visualization.

## Approach
Use **`vis-timeline`** (battle-tested, ~80KB gz). Recharts doesn't do horizontal Gantt well.

## API
- `GET /dashboards/gantt?site_id=&from=&to=` →

```json
{
  "facilities": [{"id":1,"name":"Pool"}],
  "items": [
    {"id":42,"facility_id":1,"title":"Ritesh A.",
     "start":"2026-05-25T07:00","end":"2026-05-25T08:00","status":"approved"}
  ]
}
```

Underlying SQL:
```sql
SELECT id, facility_id, title, start_at, end_at, status
  FROM bookings
 WHERE tenant_id = ?
   AND facility_id IN (?)
   AND start_at < ?    -- to
   AND end_at   > ?    -- from
```

## UI
New tab on `/dashboard`: "Timeline".

```
┌─ Timeline — Site [Mumbai HQ ▾] ─ [Today | Week | Month] ────────┐
│              09  10  11  12  13  14  15  16  17                 │
│  Pool       ████░░░░░░░████████████████░░░░░                    │
│  Gym        ░░░░██████████░░░░░░░░░░░░░░░░░                    │
│  Conf A     ░░██████░░░░░░░░░░░░██████████                    │
│                                                                 │
│  ▸ Click block: opens booking detail                            │
│  ▸ Click facility name: filters dashboard to that facility      │
└─────────────────────────────────────────────────────────────────┘
```

Colour code: approved = brand-navy, pending = amber, rejected = grey.

## Effort
**M.**
