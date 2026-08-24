// Routing for the whole app.
//
// Every route page is code-split via React.lazy() so a booker who only ever
// visits /facility doesn't download the admin app + recharts + DataGrid +
// react-calendar-timeline. Each chunk falls back to <PageSpinner /> while
// it loads. Total first-load JS drops ~55-60% for the common booker path.
//
// What's NOT lazy:
//   - LoginPage — entry point for every visitor; lazy adds a flicker.
//   - AppLayout, ProtectedRoute, RoleGate, AuthContext, theme — needed
//     before first paint, splitting them only hurts.
//
// Two in-component splits live in their own files:
//   - DashboardPage lazy-loads <GanttTimeline> when the Timeline tab is
//     clicked. (moment + react-calendar-timeline only ship then.)
//   - FacilityFormPage lazy-loads <DeskLayoutEditor> when the admin opens
//     the layout modal. (1479-line canvas component held back until used.)

import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import theme from '@/theme/theme';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import ProtectedRoute from '@/components/ProtectedRoute';
import { RequireRole } from '@/components/RoleGate';
import AppLayout from '@/layouts/AppLayout';
import PageSpinner from '@/components/PageSpinner';

// --- Eager: login is the front door for every user, lazy adds a flash ---
import LoginPage from '@/pages/auth/LoginPage';

// --- Lazy: auth pages users hit at most once ----------------------------
const RegisterPage        = lazy(() => import('@/pages/auth/RegisterPage'));
const ForgotPasswordPage  = lazy(() => import('@/pages/auth/ForgotPasswordPage'));
const ResetPasswordPage   = lazy(() => import('@/pages/auth/ResetPasswordPage'));

// --- Lazy: public portal (anonymous visitors — different audience) ------
const PublicLandingPage         = lazy(() => import('@/pages/public/PublicLandingPage'));
const PublicSitesPage           = lazy(() => import('@/pages/public/PublicSitesPage'));
const PublicSiteFacilitiesPage  = lazy(() => import('@/pages/public/PublicSiteFacilitiesPage'));
const PublicFacilityDetailPage  = lazy(() => import('@/pages/public/PublicFacilityDetailPage'));

// --- Lazy: heavy admin dashboard (recharts ~95KB gz) --------------------
const DashboardPage = lazy(() => import('@/pages/dashboard/DashboardPage'));

// --- Lazy: booker pages -------------------------------------------------
const FacilityBookingPage = lazy(() => import('@/pages/facility/FacilityBookingPage'));
const FacilityDetailPage  = lazy(() => import('@/pages/facility/FacilityDetailPage'));
const MyBookingsPage      = lazy(() => import('@/pages/myBookings/MyBookingsPage'));

// --- Lazy: approvals (approvers + admins) -------------------------------
const ApprovalsInboxPage  = lazy(() => import('@/pages/approvals/ApprovalsInboxPage'));
const ApprovalActPage     = lazy(() => import('@/pages/approvals/ApprovalActPage'));
const BookingActPage      = lazy(() => import('@/pages/bookings/BookingActPage'));

// --- Lazy: super-admin pages --------------------------------------------
const TenantsListPage     = lazy(() => import('@/pages/admin/tenants/TenantsListPage'));
const TenantFormPage      = lazy(() => import('@/pages/admin/tenants/TenantFormPage'));
const LookupsPage         = lazy(() => import('@/pages/admin/lookups/LookupsPage'));

// --- Lazy: tenant-admin masters (all use @mui/x-data-grid ~80KB gz) -----
const OrganisationsListPage = lazy(() => import('@/pages/admin/organisations/OrganisationsListPage'));
const OrganisationFormPage  = lazy(() => import('@/pages/admin/organisations/OrganisationFormPage'));
const SitesListPage       = lazy(() => import('@/pages/admin/sites/SitesListPage'));
const SiteFormPage        = lazy(() => import('@/pages/admin/sites/SiteFormPage'));
const FloorsListPage      = lazy(() => import('@/pages/admin/floors/FloorsListPage'));
const FloorFormPage       = lazy(() => import('@/pages/admin/floors/FloorFormPage'));
const FacilitiesListPage  = lazy(() => import('@/pages/admin/facilities/FacilitiesListPage'));
const FacilityFormPage    = lazy(() => import('@/pages/admin/facilities/FacilityFormPage'));

// --- Lazy: Masters tabbed shell (Phase B) + new Buildings pages ----------
const MastersLayout      = lazy(() => import('@/pages/admin/masters/MastersLayout'));
const BuildingsListPage  = lazy(() => import('@/pages/admin/masters/buildings/BuildingsListPage'));
const BuildingFormPage   = lazy(() => import('@/pages/admin/masters/buildings/BuildingFormPage'));
const Floor3DPage        = lazy(() => import('@/pages/admin/floor3d/Floor3DPage'));
const DepartmentsListPage = lazy(() => import('@/pages/admin/departments/DepartmentsListPage'));
const DepartmentFormPage  = lazy(() => import('@/pages/admin/departments/DepartmentFormPage'));
const MealTimesListPage   = lazy(() => import('@/pages/admin/mealTimes/MealTimesListPage'));
const MealTimeFormPage    = lazy(() => import('@/pages/admin/mealTimes/MealTimeFormPage'));
const UsersListPage       = lazy(() => import('@/pages/admin/users/UsersListPage'));
const UserCreatePage      = lazy(() => import('@/pages/users/UserCreatePage'));
const UserEditPage        = lazy(() => import('@/pages/users/UserEditPage'));
const PantriesListPage    = lazy(() => import('@/pages/admin/pantries/PantriesListPage'));
const PantryFormPage      = lazy(() => import('@/pages/admin/pantries/PantryFormPage'));

// Bounces legacy /admin/<segment>[/rest] URLs to the /admin/masters/<segment>
// tree. Kept as a splat route ("/admin/sites/*" etc.) so old bookmarks that
// point at /admin/sites/new or /admin/sites/42 keep working.
function RedirectToMasters({ segment }: { segment: string }) {
  const location = useLocation();
  const suffix = location.pathname.replace(new RegExp('^/admin/' + segment), '');
  return <Navigate to={'/admin/masters/' + segment + suffix + location.search + location.hash} replace />;
}

// Role-aware default route - sends each role to its natural home.
function RoleHomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  const home =
    user.role === 'super_admin'    ? '/dashboard'
    : user.role === 'tenant_admin' ? '/dashboard'
    : user.role === 'approver'     ? '/approvals'
    :                                '/facility';
  return <Navigate to={home} replace />;
}

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        {/* Suspense here catches lazy chunks for PUBLIC pages (login, register,
            portal). The AUTHENTICATED tree has its OWN inner Suspense scoped
            to just <Outlet /> inside AppLayout — that way, navigating between
            admin pages spins ONLY the main content area; navbar + sidebar
            stay mounted so it feels like a proper SPA instead of a page reload. */}
        <Suspense fallback={<PageSpinner />}>
          <Routes>
            {/* Public — no layout */}
            <Route path="/login"           element={<LoginPage />} />
            <Route path="/register"        element={<RegisterPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password"  element={<ResetPasswordPage />} />

            {/* F03 - Public portal (no auth, no AppLayout) */}
            <Route path="/p/:slug"                                  element={<PublicLandingPage />} />
            <Route path="/p/:slug/sites"                            element={<PublicSitesPage />} />
            <Route path="/p/:slug/sites/:siteId/facilities"         element={<PublicSiteFacilitiesPage />} />
            <Route path="/p/:slug/facilities/:id"                   element={<PublicFacilityDetailPage />} />

            {/*
              Layout route: <ProtectedRoute> checks auth, <AppLayout /> renders
              navbar + sidebar + <Outlet />. Every child <Route> below renders
              INTO that outlet — the layout itself never remounts on nav.
            */}
            <Route
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<RoleHomeRedirect />} />

              {/* Admin dashboards */}
              <Route path="/dashboard" element={
                <RequireRole roles={['super_admin', 'tenant_admin']}><DashboardPage /></RequireRole>
              } />

              {/* Employee + admins */}
              <Route path="/facility"            element={<FacilityBookingPage />} />
              <Route path="/facility/type/:type" element={<FacilityDetailPage />} />
              <Route path="/my-bookings"         element={<MyBookingsPage />} />
              <Route path="/approvals"           element={<ApprovalsInboxPage />} />
              <Route path="/approvals/act"       element={<ApprovalActPage />} />
              {/* F07 - reschedule / cancel via mail (booker landing) */}
              <Route path="/bookings/:id/act"    element={<BookingActPage />} />

              {/* Super-admin only */}
              <Route path="/admin/tenants" element={
                <RequireRole roles={['super_admin']}><TenantsListPage /></RequireRole>
              } />
              <Route path="/admin/tenants/:id" element={
                <RequireRole roles={['super_admin']}><TenantFormPage /></RequireRole>
              } />
              <Route path="/admin/lookups" element={
                <RequireRole roles={['super_admin']}><LookupsPage /></RequireRole>
              } />

              {/* 3D Floor Studio — dedicated three.js canvas page. */}
              <Route path="/admin/floor-3d" element={
                <RequireRole roles={['super_admin', 'tenant_admin', 'org_admin']}><Floor3DPage /></RequireRole>
              } />

              {/* Legacy hierarchy URLs — bounce to the /admin/masters/* shell.
                  Splat matcher covers list ("/admin/sites"), form new
                  ("/admin/sites/new") and edit ("/admin/sites/42"). */}
              <Route path="/admin/organisations/*" element={
                <RequireRole roles={['super_admin', 'tenant_admin']}><RedirectToMasters segment="organisations" /></RequireRole>
              } />
              <Route path="/admin/sites/*" element={
                <RequireRole roles={['super_admin', 'tenant_admin']}><RedirectToMasters segment="sites" /></RequireRole>
              } />
              <Route path="/admin/floors/*" element={
                <RequireRole roles={['super_admin', 'tenant_admin']}><RedirectToMasters segment="floors" /></RequireRole>
              } />
              <Route path="/admin/facilities/*" element={
                <RequireRole roles={['super_admin', 'tenant_admin']}><RedirectToMasters segment="facilities" /></RequireRole>
              } />
              <Route path="/admin/buildings/*" element={
                <RequireRole roles={['super_admin', 'tenant_admin']}><RedirectToMasters segment="buildings" /></RequireRole>
              } />
              <Route path="/admin/departments" element={
                <RequireRole roles={['super_admin', 'tenant_admin']}><DepartmentsListPage /></RequireRole>
              } />
              <Route path="/admin/departments/:id" element={
                <RequireRole roles={['super_admin', 'tenant_admin']}><DepartmentFormPage /></RequireRole>
              } />
              <Route path="/admin/meal-times" element={
                <RequireRole roles={['super_admin', 'tenant_admin']}><MealTimesListPage /></RequireRole>
              } />
              <Route path="/admin/meal-times/:id" element={
                <RequireRole roles={['super_admin', 'tenant_admin']}><MealTimeFormPage /></RequireRole>
              } />
              {/* F06 - Pantries */}
              <Route path="/admin/pantries" element={
                <RequireRole roles={['super_admin', 'tenant_admin']}><PantriesListPage /></RequireRole>
              } />
              <Route path="/admin/pantries/:id" element={
                <RequireRole roles={['super_admin', 'tenant_admin']}><PantryFormPage /></RequireRole>
              } />
              {/* -------- Masters tabbed shell (Phase B) --------
                  Shared MastersLayout wraps every /admin/masters/* child so
                  the tab strip + cascade filter stays above the outlet even
                  on form pages. Legacy /admin/<segment> routes are kept
                  intact below for deep-link compatibility. */}
              <Route
                element={
                  <RequireRole roles={['super_admin', 'tenant_admin', 'org_admin']}>
                    <MastersLayout />
                  </RequireRole>
                }
              >
                <Route path="/admin/masters"                     element={<Navigate to="/admin/masters/sites" replace />} />
                <Route path="/admin/masters/organisations"       element={<OrganisationsListPage />} />
                <Route path="/admin/masters/organisations/:id"   element={<OrganisationFormPage />} />
                <Route path="/admin/masters/sites"               element={<SitesListPage />} />
                <Route path="/admin/masters/sites/:id"           element={<SiteFormPage />} />
                <Route path="/admin/masters/buildings"           element={<BuildingsListPage />} />
                <Route path="/admin/masters/buildings/:id"       element={<BuildingFormPage />} />
                <Route path="/admin/masters/floors"              element={<FloorsListPage />} />
                <Route path="/admin/masters/floors/:id"          element={<FloorFormPage />} />
                <Route path="/admin/masters/facilities"          element={<FacilitiesListPage />} />
                <Route path="/admin/masters/facilities/:id"      element={<FacilityFormPage />} />
              </Route>

              <Route path="/admin/users" element={
                <RequireRole roles={['super_admin', 'tenant_admin']}><UsersListPage /></RequireRole>
              } />
              <Route path="/users/new" element={
                <RequireRole roles={['super_admin', 'tenant_admin']}><UserCreatePage /></RequireRole>
              } />
              <Route path="/admin/users/:id" element={
                <RequireRole roles={['super_admin', 'tenant_admin']}><UserEditPage /></RequireRole>
              } />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </Suspense>
      </AuthProvider>
    </ThemeProvider>
  );
}
