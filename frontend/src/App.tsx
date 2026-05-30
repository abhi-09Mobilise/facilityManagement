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

import { Routes, Route, Navigate } from 'react-router-dom';
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
const SitesListPage       = lazy(() => import('@/pages/admin/sites/SitesListPage'));
const SiteFormPage        = lazy(() => import('@/pages/admin/sites/SiteFormPage'));
const FloorsListPage      = lazy(() => import('@/pages/admin/floors/FloorsListPage'));
const FloorFormPage       = lazy(() => import('@/pages/admin/floors/FloorFormPage'));
const FacilitiesListPage  = lazy(() => import('@/pages/admin/facilities/FacilitiesListPage'));
const FacilityFormPage    = lazy(() => import('@/pages/admin/facilities/FacilityFormPage'));
const DepartmentsListPage = lazy(() => import('@/pages/admin/departments/DepartmentsListPage'));
const DepartmentFormPage  = lazy(() => import('@/pages/admin/departments/DepartmentFormPage'));
const MealTimesListPage   = lazy(() => import('@/pages/admin/mealTimes/MealTimesListPage'));
const MealTimeFormPage    = lazy(() => import('@/pages/admin/mealTimes/MealTimeFormPage'));
const UsersListPage       = lazy(() => import('@/pages/admin/users/UsersListPage'));
const UserCreatePage      = lazy(() => import('@/pages/users/UserCreatePage'));
const UserEditPage        = lazy(() => import('@/pages/users/UserEditPage'));
const PantriesListPage    = lazy(() => import('@/pages/admin/pantries/PantriesListPage'));
const PantryFormPage      = lazy(() => import('@/pages/admin/pantries/PantryFormPage'));

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
        {/* Single outer Suspense — every lazy() page falls back to PageSpinner
            while its chunk downloads. One boundary is enough; nested lazies
            (GanttTimeline, DeskLayoutEditor) have their own local Suspense
            inside the page so the rest of the page stays visible. */}
        <Suspense fallback={<PageSpinner />}>
          <Routes>
            {/* Public */}
            <Route path="/login"           element={<LoginPage />} />
            <Route path="/register"        element={<RegisterPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password"  element={<ResetPasswordPage />} />

            {/* F03 - Public portal (no auth, no AppLayout) */}
            <Route path="/p/:slug"                                  element={<PublicLandingPage />} />
            <Route path="/p/:slug/sites"                            element={<PublicSitesPage />} />
            <Route path="/p/:slug/sites/:siteId/facilities"         element={<PublicSiteFacilitiesPage />} />
            <Route path="/p/:slug/facilities/:id"                   element={<PublicFacilityDetailPage />} />

            {/* Everything else is protected */}
            <Route
              path="/*"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <Routes>
                      <Route path="/" element={<RoleHomeRedirect />} />

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

                      {/* Super-admin + tenant-admin */}
                      <Route path="/admin/sites" element={
                        <RequireRole roles={['super_admin', 'tenant_admin']}><SitesListPage /></RequireRole>
                      } />
                      <Route path="/admin/sites/:id" element={
                        <RequireRole roles={['super_admin', 'tenant_admin']}><SiteFormPage /></RequireRole>
                      } />
                      <Route path="/admin/floors" element={
                        <RequireRole roles={['super_admin', 'tenant_admin']}><FloorsListPage /></RequireRole>
                      } />
                      <Route path="/admin/floors/:id" element={
                        <RequireRole roles={['super_admin', 'tenant_admin']}><FloorFormPage /></RequireRole>
                      } />
                      <Route path="/admin/facilities" element={
                        <RequireRole roles={['super_admin', 'tenant_admin']}><FacilitiesListPage /></RequireRole>
                      } />
                      <Route path="/admin/facilities/:id" element={
                        <RequireRole roles={['super_admin', 'tenant_admin']}><FacilityFormPage /></RequireRole>
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
                    </Routes>
                  </AppLayout>
                </ProtectedRoute>
              }
            />
          </Routes>
        </Suspense>
      </AuthProvider>
    </ThemeProvider>
  );
}
