# 03 — Public portal (sites + facilities, no login)

**Goal.** Marketing-style read-only browser for tenants who want to expose their facility catalog publicly.

## Current state
No public surface. All `/api/*` routes require JWT.

## Schema delta

```sql
-- 024_public_portal.sql
ALTER TABLE tenants
  ADD COLUMN public_portal_enabled TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN public_slug VARCHAR(64) UNIQUE NULL;
ALTER TABLE facilities
  ADD COLUMN public_listed TINYINT(1) NOT NULL DEFAULT 0;
```

## API (no auth, rate-limited via `express-rate-limit`, 60 rpm/IP)
- `GET /public/t/:slug` — tenant landing (name, hero, sites count)
- `GET /public/t/:slug/sites` — list sites with facility counts
- `GET /public/t/:slug/sites/:siteId/facilities` — list `public_listed=1` facilities
- `GET /public/t/:slug/facilities/:id` — name, type, capacity, image, operating hours, *no* booker data

## Security guardrails
- Brand-new router `routes/public.routes.js` mounted at `/public` — no `requireAuth`.
- Whitelist columns in SELECTs; never return PII.
- Cache headers `Cache-Control: public, max-age=300`.

## UI
New route prefix `/p/:slug/*` outside `AppLayout`.

```
┌─ Acme Corp ─────────────────────────────────────────────────┐
│  Hero image + tagline                                       │
│  ┌─ Sites ───────────────────────────────────────────────┐  │
│  │  [Mumbai HQ]  [Bangalore]  [Pune]                     │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌─ Featured facilities ─────────────────────────────────┐  │
│  │  [card] [card] [card] [card]                          │  │
│  └───────────────────────────────────────────────────────┘  │
│   "Need to book? Sign in →"                                 │
└─────────────────────────────────────────────────────────────┘
```

## UX copy
- Disabled tenant: *"This page isn't live yet."* (404).
- CTA: *"Book this facility — sign in or ask your administrator."* (no inline booking).

## Effort
**M.**
