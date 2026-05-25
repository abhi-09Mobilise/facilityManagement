# Facility Booking - multi-tenant React + Node

Multi-tenant facility booking platform with three roles: **super_admin** (SaaS
owner), **tenant_admin** (an organization's admin), and **employee**. Express
+ raw MySQL backend, Vite + React + TS + MUI frontend.

## Role x master matrix

| Master                    | super_admin | tenant_admin (own tenant) | employee     |
|---------------------------|:-----------:|:-------------------------:|:------------:|
| Tenants                   | CRUD        | -                         | -            |
| Currencies / TZ / locale  | CRUD        | read                      | read         |
| Sites                     | any tenant  | CRUD                      | -            |
| Floors                    | any tenant  | CRUD                      | -            |
| Facilities + hours        | any tenant  | CRUD                      | read         |
| Departments               | any tenant  | CRUD                      | -            |
| Users (employees)         | any tenant  | CRUD (employees only)     | -            |
| Meal times                | any tenant  | CRUD                      | read         |
| Approval workflows + steps| any tenant  | CRUD                      | -            |

Super admins targeting a specific tenant pass `?tenant_id=N` on GET or
`tenant_id` in the body on POST. Tenant admins are always pinned to their
own `req.user.tenant_id`.

## Frontend route map

```
/login                          public
/register                       public

/                               role-aware redirect
                                  super_admin   -> /admin/tenants
                                  tenant_admin  -> /admin/sites
                                  employee      -> /facility

/facility                       all logged-in   - book a facility

/admin/tenants                  super_admin     - tenants list
/admin/tenants/new   /:id       super_admin     - tenant form
/admin/lookups                  super_admin     - currencies / timezones / locales (tabs)

/admin/sites                    super + tenant  - sites list
/admin/sites/new /:id           super + tenant  - site form
/admin/floors                   super + tenant  - floors list
/admin/floors/new /:id          super + tenant  - floor form
/admin/facilities               super + tenant  - facilities list
/admin/facilities/new /:id      super + tenant  - facility form (incl. operating hours)
/admin/departments              super + tenant  - departments list
/admin/departments/new /:id     super + tenant  - department form
/admin/meal-times               super + tenant  - meal times list
/admin/meal-times/new /:id      super + tenant  - meal time form
/admin/approval-workflows       super + tenant  - workflows list
/admin/approval-workflows/new /:id  super + tenant  - workflow form (incl. step chain)
/admin/users                    super + tenant  - employees list
/users/new                      super + tenant  - create employee
```

The sidebar in `AppLayout.tsx` filters items by `req.user.role`, grouped
under **Platform / Organisation / Booking** sections.

## Layout

```
FacilityManagement/
+- backend/                                Express + raw mysql2
|  +- scripts/migrate.js + migrations/...  12 SQL files
|  +- scripts/seed.js                      demo tenant + users + facilities
|  +- src/
|     +- middleware/auth.js                JWT (sub, role, tenant_id) + requireRole
|     +- utils/tenantScope.js              effectiveTenantId, scopeWhere, assertOwnership
|     +- routes/index.js                   wires 12 module routers under /api
|     +- modules/
|        +- auth, users, tenants, featureFlags, lookups, integrations,
|        +- sites, floors, facilities, departments, mealTimes, approvalWorkflows
+- frontend/                               React 18 + Vite + TS + MUI
   +- src/
      +- api/
      |  +- client.ts                      axios instance with JWT interceptor
      |  +- createCrudApi.ts               factory used by most module APIs
      |  +- {auth,users,tenants,featureFlags,lookups,integrations,
      |      sites,floors,facilities,departments,mealTimes,approvalWorkflows}.api.ts
      +- components/
      |  +- CrudTable.tsx                  generic list table (MUI DataGrid + delete)
      |  +- RoleGate.tsx                   inline gate + RequireRole route guard
      |  +- ProtectedRoute.tsx             auth gate
      |  +- PageHeader.tsx                 consistent page top bar
      |  +- ConfirmDialog.tsx
      +- context/AuthContext.tsx
      +- layouts/AppLayout.tsx             role-aware sidebar
      +- pages/
      |  +- auth/{LoginPage, RegisterPage}.tsx
      |  +- admin/<module>/<List|Form>Page.tsx        12 admin modules
      |  +- facility/FacilityBookingPage.tsx          live facilities + meal-times
      |  +- users/UserCreatePage.tsx                  create employee
      +- App.tsx                           routing + role-aware default
```

## Setup

```bash
# DB
mysql -e "CREATE DATABASE fm_db DEFAULT CHARACTER SET utf8mb4;"

# Backend
cd backend
cp .env.example .env       # set DB creds + JWT_SECRET
npm install
npm run migrate
npm run seed
npm run dev                # http://localhost:4000

# Frontend
cd ../frontend
npm install
npm run dev                # http://localhost:5173
```

## Seeded credentials

| Role         | Username      | Password    |
|--------------|---------------|-------------|
| super_admin  | superadmin    | super123    |
| tenant_admin | tenantadmin   | tenant123   |
| employee     | emp1          | emp123      |
| employee     | emp2          | emp123      |

## Cross-cutting rules

- Every tenant-scoped table carries `tenant_id`. Globals only: `tenants`,
  `currencies`, `timezones`, `locales`, `feature_flags`, `integrations`.
- Every backend controller uses `effectiveTenantId(req, override)` or
  `assertOwnership(req, table, id)` from `utils/tenantScope.js` to enforce
  isolation. Routers use `requireRole(...)` before the controller runs.
- The frontend mirrors this with `<RequireRole roles={[...]}>` and a sidebar
  that's filtered by `req.user.role`.
- Response envelope everywhere: `{ status, msg, data }`. The axios client
  unwraps `res.data` so callers get the envelope directly.
- Soft delete (`trash = 1`) on tenant-scoped resources; hard delete on
  lookups (currencies, timezones, locales, feature_flags, integrations).

## What's still to build

- **Bookings module (backend + frontend)** - schema is in place
  (`bookings`, `booking_guests`, `booking_meals`, `booking_approvals`).
  When this lands, `/facility` swaps mock recent/previous bookings for live data
  and a Bookings admin page can be added under `/admin/bookings`.
- **Approve / reject inbox** for managers - one row in `booking_approvals`
  per step; managers see their pending step decisions.
- **Tenant reports** - utilisation, no-shows, peak hours.
