# SoCampus Facility Management — Project Status Report

**Date:** 31 August 2026
**Prepared for:** Puneet Yadav
**Basis:** actual repository code (backend + frontend + services), plus `Sprint_Dev_Backlog_v2.xlsx`, `Sprint_Plan_Weekly.xlsx`, `Milestone_Plan_Post_Benchmark.xlsx`, `Desk_Booking_Gap_Analysis_and_Milestones_v3.xlsx`, `Prototype_Page_Role_Mapping.xlsx`, `HLD_SoCampus_FM.docx`, `docs/*.md`

---

## 1. One-paragraph summary

You have a **fully working multi-tenant facility & meeting-room booking platform** already in production shape — booking engine, approval chains, seat-level picking, masters, public portal, pantry ordering, RBAC matrix, dashboards, emails. What you are building *now* is a specific enhancement programme on top of it: **desk booking with automatic release of no-shows, biometric attendance reconciliation, and a real analytics/reporting layer.** That programme is planned as 27 milestones over 15 weeks. **Week 1 of 15 is complete and verified in code. Week 2 has not started.**

**Progress against the enhancement programme: roughly 8–10% (Week 1 of 11 Phase-1 weeks done, plus the RBAC and UI-theme work that was delivered ahead of schedule).**

> ⚠️ **Note:** `README.md` in the repo is badly out of date (dated May). It says "Bookings module still to build" — bookings, approvals, pantries, public portal, dashboards, permissions and floor-scan have all shipped since. Do not use the README to judge status. Someone should refresh it.

---

## 2. What you ALREADY HAVE (verified in the code)

### 2.1 Core platform — done and working

| Area | What exists | Evidence |
|---|---|---|
| **Booking engine** | Create, availability check, cancel, reschedule, shared/capacity bookings, race-safe DB transactions (`FOR SHARE`), per-chair seat selection with clash detection, VIP chairs, guests, attendee counts | `bookings.controller.js` — 1,540 lines / 65 KB |
| **Approvals** | Multi-step approval chains per facility, two-stage (check-in/check-out) approvals, approver inbox, one-click approve/reject from email via signed tokens | `modules/approvals`, `chainMaterializer.js`, `ApprovalsInboxPage.tsx` |
| **Masters (org structure)** | Tenants → Organisations → Sites → Buildings → Floors → Facilities, plus Departments, Users, Meal times, Pantries, Lookups (currency/TZ/locale) — full CRUD with tenant + org scoping | 21 backend modules, 45 migrations (numbered to 047), `/admin/masters/*` pages |
| **Roles & permissions** | **Full-stack RBAC matrix** — 17 permission keys, global + per-tenant scopes, `requirePerm()`, inherited/override states, delegation ceiling rule (a tenant admin can never grant more than the super admin allowed) and sub-role rule | migration `045`, `modules/permissions/*`, `/admin/permissions` |
| **Booking policy rules** | Per-facility min-advance minutes, max-advance days, max bookings per user per day/week/month, per-slot capacity overrides, operating hours, offline capacity, T&Cs, requires-approval flag | migrations `023`, `031`, `032`, `034` |
| **Email layer** | Nodemailer + 12+ templates, recipient resolution incl. department managers, single-use action tokens for mail links, cron "booking ending soon" notices | `utils/mailer.js`, `mailTemplates.js`, `bookingActionTokens.js` |
| **Auth** | JWT, register/login, forgot + reset password, lockout fields, `?next=` deep-links | migration `018`, `modules/auth`, 4 auth pages |
| **Floor plan tooling** | 2D SVG layout editor (drag/rotate/resize desks, chairs, walls; metre scale; floor image upload), **computer-vision auto-detection of chairs & tables** via a Python FastAPI + OpenCV sidecar | `DeskLayoutEditor.tsx`, `floor-scan-svc/`, `modules/floorScan` |
| **Seat picker (booker side)** | Chairs colour-coded available / occupied / selected for the chosen time window | `DeskPicker.tsx` |
| **Public portal** | Unauthenticated tenant landing page → sites → facilities → facility detail | migration `026`, `/p/:slug/*`, 4 public pages |
| **Pantry / catering** | Per-facility pantries, paid items, order panel inside the booking flow | migrations `024`, `030`, `modules/pantries` |
| **Dashboards** | Tenant-admin dashboard (occupancy now, today's booked-vs-open minutes per facility), recharts KPI tiles, **Gantt timeline** view | `dashboards.controller.js`, `DashboardPage.tsx`, `GanttTimeline.tsx` |
| **Uploads** | Azure Blob sidecar service for images | `azure-blob-svc/`, `modules/uploads` |
| **Design system** | SoCampus Desk tokens (ink/indigo/teal, Space Grotesk / IBM Plex, 12px radius) in `globals.css` + `tailwind.config.js`; MUI theme rewritten incl. DataGrid skin; prototype app shell + rebuilt split-panel Login | `theme/`, `styles/`, `AppLayout.tsx`, `LoginPage.tsx` |
| **Live overview page** | `/overview` — 4 KPI cards, per-floor table, live activity feed, alerts + sweeper cards. **Layout is finished; ~6 cells are deliberate labelled placeholders** waiting on the auto-release build | `LiveOverviewPage.tsx` |

### 2.2 The enhancement programme — Week 1 delivered ✅

All five Week-1 tasks from the sprint backlog are in the repo:

| Task | What it did | Proof |
|---|---|---|
| T1.1 | Stable, permanent desk IDs (`FAC42-D007` format) + save-time validation rejecting duplicate or dangling IDs | migration `046_stable_desk_ids.sql`, `utils/deskLayout.js`, `scripts/fix_desk_ids.js`, `DESK_ID_CONFLICT` in `facilities.controller.js` |
| T1.2 | Layout editor auto-generates the stable ID; IDs are read-only in the chair inspector | `DeskLayoutEditor.tsx` |
| T1.3 | Booking a chair that doesn't exist in the layout now fails cleanly (`DESK_UNKNOWN`) | `bookings.controller.js` |
| T1.4 | **`occupancy_daily` analytics fact table** + nightly aggregator job + secured cron endpoint `POST /api/cron/aggregate-occupancy` (idempotent — re-running a day gives the same answer) | migration `047_occupancy_daily.sql`, `jobs/occupancyAggregator.js`, `cron.routes.js` |
| T1.5 | 90-day backfill script + the HReVO department/business-unit data contract written up | `scripts/backfill_occupancy.js`, `docs/09_hrevo_data_contract.md` |

**Delivered early / out of sequence (a real head start):** the entire RBAC permission matrix with the delegation model (planned as track RB.1, already done), the whole UI theme and app shell, the rebuilt Login page, and the Live Overview page layout.

---

## 3. The sprint file, explained in simple terms

This is the part that isn't obvious. There are **four planning spreadsheets and they are not four versions of the same thing** — they are four zoom levels of one plan.

### 3.1 What each file actually is

| File | Zoom level | Use it for | Trust it? |
|---|---|---|---|
| `Desk_Booking_Gap_Analysis_and_Milestones_v3.xlsx` | **The "why"** | Maps the client's 6 requirements from the BRD against what the code already does. Three sheets: gap analysis, first milestone attempt, phased sequence. | Gap-analysis sheet: yes, still accurate. **Its milestone numbers (M1–M24) are SUPERSEDED.** |
| `Milestone_Plan_Post_Benchmark.xlsx` | **The "what"** | The single source of truth for milestones **M1–M27** and effort (91 days Phase 1 + 31 days Phase 2 = **122 dev-days**). Rewritten after the 20-Aug competitor benchmark. | ✅ **This is the master milestone list.** Use these M-numbers everywhere. |
| `Sprint_Plan_Weekly.xlsx` | **The "when"** | 15 weeks × 8 sprints, showing which milestone each of the two developers owns each week, and the demo sentence for that week. One row = one week. | ✅ Current |
| `Sprint_Dev_Backlog_v2.xlsx` | **The "how"** | The developer-level task list — 70 rows, each one a 0.5–3 day piece of work naming the exact file, endpoint or table to touch. | ✅ Current — this is what devs work from |

**The chain is:** BRD requirement → gap analysis → milestone (M1–M27) → week (W1–W15) → task (T1.1, T1.2…) → a specific file in the repo.

### 3.2 Decoding the codes in the sprint backlog

| Code | Means |
|---|---|
| **W1, W2 … W15** | Calendar week number of the programme (not sprint number). |
| **S1 … S8** | Sprint. Each sprint = 2 weeks. So S1 = W1+W2, S2 = W3+W4, and so on. |
| **M1 … M27** | Milestone from the master milestone plan — the *business* deliverable ("auto-release sweeper"). |
| **T1.1, T2.4, T10.3** | A single developer task. The first number is the week, the second is the task within that week. So **T4.2 = week 4, task 2**. |
| **RB.1 … RB.5** | The **RBAC delegation track** — a side-stream of permission work threaded through weeks 3–7 instead of sitting in one week. Adds 6.5 days, absorbed by the W10 buffer. |
| **T12.x, T13.x…** | Deliberately vague. Phase 2 (biometric) tasks are *not yet broken down*, because they depend on the W12 "Count vs external vendor" decision. |
| **Dev A** | Backend lead — owns data model, APIs, jobs, sweeper, audit. |
| **Dev B** | Frontend lead — owns dashboards, exports, maps, QR, mobile. |
| **Est (d)** | Estimated days for that one task. |
| **Depends on** | The task that must finish first. `-` means it can start immediately. |
| **Done when** | The acceptance test. **This is the review checklist** — if you can't demonstrate this sentence, the task is not done. |

### 3.3 How to read one row (worked example)

> **W4 | T4.2 | M10 | Dev A |** *bookings.controller: POST /:id/check-in + /:id/check-out. Window: start − opensMin → start + graceMin…* **| Done when:** Postman flow: book → check-in inside window 200, outside window 422 CHECKIN_WINDOW; second call 200 no-op **| Est 2d | Depends on T4.1**

In plain English: *"In week 4, the backend developer adds two API endpoints so a user can check in and check out of their booking. Check-in is only allowed inside a time window around the booking start. Calling it twice must not break anything. This serves milestone M10 (check-in model). It takes 2 days and can't start until the database columns from T4.1 exist. It's finished when you can prove all three behaviours in Postman."*

### 3.4 The 15 weeks in plain English

**Phase 1 — weeks 1 to 11 — "stop desks being wasted by no-shows"**

| Weeks | Sprint | The plain-English story | Milestones |
|---|---|---|---|
| **W1** ✅ | S1 | Give every chair a permanent ID that never changes, and start recording daily occupancy facts so reports have history to read. | M1, M6 start |
| **W2** ⬜ | S1 | Let an admin take a desk out of service ("under maintenance until Friday"), and show the first 30-day occupancy trend chart. | M2, M6 |
| **W3** ⬜ | S2 | Let each site set its own grace period ("15 minutes here, 30 minutes there") and build the real analytics dashboard with a peak-hours heatmap. | M3, M7 |
| **W4** ⬜ | S2 | Build the check-in / check-out API, and a generic Excel + PDF export for any report. | M10, M8 |
| **W5** ⬜ | S3 | Put a "Check in" button in front of the user, and let admins schedule reports to be emailed automatically. | M11, M9 |
| **W6** ⬜ | S3 | **The centrepiece:** the auto-release sweeper — a background job that frees desks nobody checked into. Ships in *log-only* mode first (it records what it *would* have released without actually doing it). Plus start the live floor map. | M12, M4 start |
| **W7** ⬜ | S4 | An append-only audit log of every booking action (who, what, when, system-or-human), with an admin viewer. Finish the floor map. | M13, M4 |
| **W8** ⬜ | S4 | Close the loop: reminder emails before start, released-bookings report, and **QR codes printed on desks** you can scan with a phone to check in. | M14, M15, M17 |
| **W9** ⬜ | S5 | "Where is my team sitting today" + colleague search with privacy opt-out; release warning emails with a one-tap "I'm here, keep it" link; occupancy threshold alerts to admins. Also: **start biometric discovery meetings** (talking, not coding). | M16, M18, M19 |
| **W10** ⬜ | S5 | Remove every remaining placeholder from Live Overview, sweep old `requireRole` calls over to the permission matrix, and make the whole booking → check-in flow work properly on a phone. **Scope freezes Friday.** | M20, M5 |
| **W11** ⬜ | S6 | Stabilisation, load-test the sweeper with 5,000 bookings, and **flip one pilot floor to real enforcement** while everything else stays log-only. Use the pilot data to decide whether 15 or 30 minutes is the right grace period. Go/no-go on Friday. | M21 — **Phase 1 ships** |

**Phase 2 — weeks 12 to 15 — "prove people actually turned up"**

| Weeks | The plain-English story | Milestones |
|---|---|---|
| **W12** | Decide: reuse Mobilise's own **Count** IoT attendance product, or integrate an external biometric vendor? Sign the interface contract. Start ingesting attendance punches. | M22, M23 start |
| **W13** | Finish attendance ingestion (dedupe, employee-ID mapping, quarantine unmatched punches), then build the reconciliation engine that joins punches to bookings and classifies each one: *utilised / no-show / walk-in / on-site-but-not-checked-in*. | M23, M24 |
| **W14** | No-show analytics + compliance reports by department, and badge-swipe check-in riding on the same integration. | M25, M26 |
| **W15** | UAT, deployment, handover docs, and re-score against the 33-feature competitor benchmark (expect to go from ~18/33 to 25+/33). | M27 |

### 3.5 Three things about the plan you should know

1. **Capacity is tight.** 2 developers × ~4 productive days/week × 15 weeks = **~120 dev-days available vs 122 planned.** The only slack is the W10 buffer and flexible M26 scope. There is effectively **no room for a slipped week** — if W2 doesn't start soon, W15 moves.
2. **"Log-only first" is deliberate.** The sweeper will not actually release anybody's desk until a human decides it should (`tenant_settings.sweeper_mode`). This is copied from how Skedda rolled out the same feature — it lets you compare "would have released" against reality before you make anyone angry.
3. **One dependency is not in your control.** The HReVO data contract (for department / business-unit analytics cuts) was flagged in W1 as "escalate if no response by W2". `docs/09_hrevo_data_contract.md` is still marked **DRAFT — awaiting HReVO team confirmation**, and it blocks the W3 drill-downs. **That is your live risk today.**

---

## 4. What still needs to be BUILT

### 4.1 Phase 1 — nothing below exists yet (all verified absent from the code)

| # | Feature | Milestone | Why it matters |
|---|---|---|---|
| 1 | **Desk blocking & maintenance windows** — `desk_blocks` table, block/unblock UI in the layout editor, hatched blocked chairs in the picker, `409 DESK_BLOCKED` on booking | M2 (W2) | Today you can only switch off a whole facility or hold back N seats. No chair-level, date-ranged blocking. |
| 2 | **Occupancy reporting API** — `GET /api/reports/occupancy?from&to&group_by=site\|building\|floor\|department` reading the fact table | M6 (W2) | The fact table exists and is being filled, but **nothing reads it yet.** |
| 3 | **Occupancy trend chart, peak heatmap, drill-downs, auto-refresh** | M7 (W2–W3) | Dashboard is today-only. No history, no heatmap, no dept cuts. |
| 4 | **Grace-period & policy config** — schema + per-facility/per-site admin UI + `tenant_settings` table | M3 (W3) | No `grace_period_minutes` column exists anywhere. |
| 5 | **Check-in data model** — `checked_in_at` / `checked_out_at`, `released` status | M10 (W4) | Confirmed: the only "check-in" in the codebase refers to approval-workflow stages, not people arriving. |
| 6 | **Check-in / check-out API + UI + admin override** | M11 (W4–W5) | The whole point of R1. |
| 7 | **Excel/PDF export service** | M8 (W4) | Only one export exists today (facilities master list to Excel). No PDF anywhere. |
| 8 | **Scheduled report distribution** — subscriptions table, admin UI, cron renderer + emailer | M9 (W5) | Benchmark says only Eptura does this well — it's a differentiator. |
| 9 | **Auto-release sweeper** — race-safe, idempotent, log-only/enforce modes, heartbeat table | M12 (W6) | The headline feature. There is no `released` status in the enum, and `completed` is written only by `seed.js` — no runtime path ever completes or releases a booking. (A `jobs/checkoutSweeper.js` does exist, but it drives *approval-chain* check-out stages, not desk release. It's the pattern to copy, not the feature.) |
| 10 | **Floor-level live map** — `GET /api/floors/:id/live-map`, `/floors/:id/map` page, legend, zones, teammate dots | M4 (W6–W7) | Maps are per-facility today; there is no floor-level aggregate view and no live refresh. |
| 11 | **Booking audit log** — append-only table + admin viewer + CSV export | M13 (W7) | No audit table exists at all. Only `created_at`/`updated_at`. |
| 12 | **Released-bookings report + live KPIs** | M14 (W8) | Flips the Live Overview placeholders live. |
| 13 | **Reminder engine** — pre-start reminder, check-in expiry warning | M17 (W8) | Confirmations exist; reminders don't. |
| 14 | **QR check-in** — QR generation, printable label sheets, `/checkin` mobile scan page | M15 (W8) | Zero QR code anywhere in the repo today. |
| 15 | **Release notifications** — pre-release warning with one-tap "I'm here" link, post-release notice | M18 (W9) | Reuses the existing action-token infrastructure. |
| 16 | **Admin occupancy / no-show alerts** with per-tenant thresholds | M19 (W9) | Nothing exists. |
| 17 | **Team seating / find-a-colleague** — privacy setting (everyone/team/private), colleague search, teammate dots on map | M16 (W9) | Today only department managers can see team bookings, and only as a table. |
| 18 | **Central monitoring** — sweeper heartbeat, audit feed, alert feed, log-only↔enforce toggle | M20 (W10) | Removes the last Live Overview placeholders. |
| 19 | **Mobile optimisation pass** — 44px touch targets, responsive DataGrids, Lighthouse ≥ 85 | M5 (W10) | Shell is responsive; seat map and grid pages are not. |
| 20 | **RBAC extensions (RB.2–RB.5)** — permission-key nav gating, org-tier overrides, per-tenant module toggles, policy-change auditing | RBAC track (W3–W7) | Matrix exists; the SPA still gates navigation on hard-coded role arrays. |
| 21 | **Phase 1 stabilisation & pilot** | M21 (W11) | Regression suite, 5k-booking load test, pilot floor enforce. |

### 4.2 Phase 2 — biometric attendance (weeks 12–15)

No implementation exists. The only biometric references in the codebase are the clearly-labelled placeholder cells on the Live Overview page ("Biometric mismatches" KPI, "Biometric counts as check-in — No"). Zero references to *attendance* or *punch* anywhere.

- **M22** Decision + interface contract (Count-first evaluation vs external vendor; employee-ID mapping)
- **M23** `attendance_records` table + sync job + dedupe + quarantine + failure alerts
- **M24** Nightly reconciliation engine → utilised / no-show / walk-in / on-site-not-checked-in
- **M25** No-show analytics + department compliance reports + exports
- **M26** Badge / multi-method check-in (new milestone, added after the benchmark)
- **M27** UAT, rollout, handover, benchmark re-score

### 4.3 Scope the prototype introduced that is on NO plan yet — needs a decision

From `Prototype_Page_Role_Mapping.xlsx` → "Fit vs Current System". These five appear in the clickable prototype but sit outside M1–M27. **Someone has to decide: absorb into Phase 1, or push to Phase 3.**

| Item | Rough size | Note |
|---|---|---|
| Manager booking tools — book-on-behalf, "book together" (adjacent desks), lift no-show pause | 3–4 d | Suggest folding into M16 |
| No-show strike counter + 7-day self-booking pause policy | 2–3 d | Cheap once M12/M13 exist; policy fields belong in M3 |
| In-app notification centre + channel toggles (push/Teams/SMS) | 4–5 d | Email-only today. Recommend: in-app centre as Ph1 stretch, push/Teams to Ph3 |
| Walk-in seating by admin / kiosk mode | small + Ph3 | Assign-walk-in is small once M24 exists; kiosk is Ph3 |
| Personal QR badge in Settings | 1–2 d | Good fallback for a damaged desk QR; do it alongside M15 |

### 4.4 Phase 3 backlog — not committed, needed only for full category parity

SSO/SAML (8–10 d) · MS365/Outlook two-way sync (8–12 d) · Teams/Slack (10–15 d) · Native app or PWA (15–25 d) · Multi-location org hub (6–8 d) · Access-control integration (8–10 d) · Team neighbourhoods/zones (5–6 d) · Group booking (5–7 d) · Parking booking (10–15 d) · Visitor management (15–20 d)

---

## 5. Live risks and open decisions

| # | Risk / decision | Status | Suggested action |
|---|---|---|---|
| 1 | **HReVO data contract for department/BU** | `docs/09` still DRAFT. Was due W1, flagged "escalate if no response by W2". Blocks W3 drill-downs. | Escalate this week. Ship W3 with department-only cuts if BU isn't confirmed. |
| 2 | **W2 has not started** and capacity has ~0 slack (120 available vs 122 planned) | Behind | Either start W2 now, or formally re-baseline the W15 date. |
| 3 | **HReVO audit format** must be confirmed before the W7 audit-log schema is frozen | Open | Get a sample audit record before Monday of W7. |
| 4 | **Count vs external biometric vendor** (M22) | Discovery starts W9, must conclude by end of W10 | Book the Count/HReVO API walkthrough now — it's the gate on all of Phase 2. |
| 5 | **Grace period: 15 or 30 minutes?** | Deliberately deferred to W11 pilot data | No action — this is a correct decision, just don't let anyone force it early. |
| 6 | **The five unplanned prototype features** (§4.3) | Undecided | Decide before the W10 scope freeze, not after. |
| 7 | **opsSuite maintenance ticketing linkage** for blocked desks (M2 note) | Unresolved | Check before W2 build, or you duplicate a maintenance-state model. |
| 8 | **Stale README** claiming bookings aren't built | Misleading to anyone new | 30-minute fix; do it. |
| 9 | **Unwired code**: the 3D Floor Studio "save" only downloads a Blob (the real `POST /api/facilities/:id/layout-3d` is marked a follow-up in the code); `services/maskRcnnService.js` is required by nothing and points at a script path that doesn't exist. The *working* CV path is the separate FastAPI sidecar at `FLOOR_SCAN_SVC_URL`. | Dead weight | Decide keep-and-finish or park it. |
| 10 | **Permission keys exist ahead of their features** — `audit.view`, `admin.block_desks`, `booking.manual_release`, `seating.view_team`, `seating.view_all`, `analytics.export`, `reports.schedule` are all in the catalog with nothing behind them | Expected, but worth knowing | Good news: the sprint tasks that gate on these keys need no catalog work. Just don't mistake a populated matrix for populated features. |

---

## 6. Suggested next steps (this week)

1. **Chase the HReVO data contract.** It's the only dependency that isn't yours to solve, and it's already late.
2. **Start W2.** T2.1 (`048_desk_blocks.sql`) has no blockers and takes half a day.
3. **Get T2.5 done early** — the occupancy reporting endpoint. Everything analytics-shaped in W2, W3, W4, W7 and W10 depends on it, and the fact table it reads is already being populated.
4. **Book the Count API walkthrough** for Phase 2 discovery. Earlier is free; later is expensive.
5. **Put the five unplanned prototype items in front of whoever owns scope**, with a Ph1-or-Ph3 decision due before W10.
6. **Refresh the README** so it stops contradicting reality.

---

### Appendix: which planning file to open when

| Question | File |
|---|---|
| "Why are we building this?" | `Desk_Booking_Gap_Analysis_and_Milestones_v3.xlsx` → *Gap Analysis* sheet |
| "What are the deliverables and how many days?" | `Milestone_Plan_Post_Benchmark.xlsx` → *Milestones (Sequenced)* |
| "Who's doing what this week, and what's the demo?" | `Sprint_Plan_Weekly.xlsx` |
| "Which file/table/endpoint do I touch, and when is it done?" | `Sprint_Dev_Backlog_v2.xlsx` → *Sprint Backlog* |
| "What already exists so I don't rebuild it?" | `Sprint_Dev_Backlog_v2.xlsx` → *Already Delivered* sheet |
| "What does each screen show, per role?" | `Prototype_Page_Role_Mapping.xlsx` |
| "What's the exact DDL / algorithm / architecture decision?" | `HLD_SoCampus_FM.docx` (§4.1 schema, §5 flows, §8 ADRs) |
| "How do competitors score?" | `Competitor_Benchmark_5_Platforms.pdf`, `Competitor_Comparison_Matrix_v2.xlsx` |
