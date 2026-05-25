# Facility Booking — Feature Design Index

**Audience:** developers implementing the next phase.
**Style:** one file per feature. Schema deltas, endpoints, UX skeleton, effort.

## Files
| # | File | Effort |
|---|---|---|
| 1 | `01_per_slot_capacity.md` | M |
| 2 | `02_two_stage_approval.md` | M |
| 3 | `03_public_portal.md` | M |
| 4 | `04_3d_floor_design.md` | L |
| 5 | `05_ai_integration.md` | L |
| 6 | `06_per_facility_pantry.md` | M |
| 7 | `07_reschedule_cancel_via_mail.md` | S |
| 8 | `08_admin_gantt.md` | M |

## Cross-cutting context (read once)

**Stack.** Express + raw `mysql2/promise` + JWT. React 18 + Vite + Tailwind + shadcn/ui + recharts. Multi-tenant. Roles: `super_admin`, `tenant_admin`, `approver`, `employee`.

**Patterns to reuse — do not reinvent.**

| Concern | Reuse |
|---|---|
| Auth | `requireAuth`, `requireRole(...)` middleware |
| Tenant scoping | `utils/tenantScope.js` — `effectiveTenantId(req)`, `assertOwnership()` |
| Email | `utils/mailer.js` + `utils/mailTemplates.js` |
| Action tokens (mail links) | `utils/approvalActionTokens.js` — sha256 single-use, login required |
| Migrations | `scripts/migrations/NNN_<name>.sql`, run on boot, checksum tracked |
| Transactions / race safety | `withTransaction()` + `SELECT ... FOR SHARE` (see `bookings.controller.create`) |
| Approval chains | `chainMaterializer.js` |
| RBAC on routes | `requireRole('super_admin','tenant_admin')` |

**Effort scale.** S ≤ 2d • M = 3–5d • L = 1–2w • XL = 2–4w (per dev).

## Phasing recommendation

**Now (next 2 sprints):** 07 reschedule (S) · 01 per-slot capacity (M) · 06 pantry (M).
**Next (sprints 3–4):** 02 two-stage approval (M) · 08 gantt (M) · 03 public portal (M).
**Later (Q2):** 05 AI (L) · 04 3D (L).

## Cross-feature risks & open questions

| Risk | Mitigation |
|---|---|
| Per-slot capacity + shared-booking interaction | Override `max` *is* the per-slot capacity; SUM check unchanged. |
| Check-out cron drift | Switch to event-driven trigger on next read after `end_at`. |
| Public portal scraping | `express-rate-limit` + cache; never expose user PII. |
| AI booking confirmations | **Always** require explicit user click before `create_booking` tool fires. |
| 3D model sourcing | Ship 2D floorplan fallback first; treat 3D as enrichment. |
| Reschedule capacity collision | Re-run `checkAvailability()` inside the same `withTransaction`. |
| Mail tokens leaking via referer | Use POST-redirect-GET; strip token from URL after consume. |

**Open product questions:**
- Does check-out approval *block* anything, or is it just a record? (Suggest: record-only v1.)
- Public portal CTA → login, or → "request a tour" form?
- AI chat — opt-in per tenant via a `tenants.ai_enabled` flag?
