// Routing for the whole app.
//
//   /login, /register     -> public
//   /facility             -> any logged-in role
//   /dashboard            -> super_admin + tenant_admin (utilization graphs)
//   /admin/*              -> super_admin and/or tenant_admin per RequireRole
//   /approvals/act        -> any logged-in role (token-based deep link)
//   /                     -> role-aware redirect

import { Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import theme from '@/theme/theme';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import ProtectedRoute from '@/components/ProtectedRoute';
import { RequireRole } from '@/components/RoleGate';
import AppLayout from '@/layouts/AppLayout';

import LoginPage from '@/pages/auth/LoginPage';
import RegisterPage from '@/pages/auth/RegisterPage';
import ForgotPasswordPage from '@/pages/auth/ForgotPasswordPage';
import ResetPasswordPage from '@/pages/auth/ResetPasswordPage';

import DashboardPage from '@/pages/dashboard/DashboardPage';
import FacilityBookingPage from '@/pages/facility/FacilityBookingPage';
import MyBookingsPage from '@/pages/myBookings/MyBookingsPage';
import FacilityDetailPage from '@/pages/facility/FacilityDetailPage';
import ApprovalsInboxPage from '@/pages/approvals/ApprovalsInboxPage';
import ApprovalActPage from '@/pages/approvals/ApprovalActPage';
import BookingActPage from '@/pages/bookings/BookingActPage';

// Super-admin pages
import TenantsListPage from '@/pages/admin/tenants/TenantsListPage';
import TenantFormPage from '@/pages/admin/tenants/TenantFormPage';
import LookupsPage from '@/pages/admin/lookups/LookupsPage';

// Tenant-admin pages
import SitesListPage from '@/pages/admin/sites/SitesListPage';
import SiteFormPage from '@/pages/admin/sites/SiteFormPage';
import FloorsListPage from '@/pages/admin/floors/FloorsListPage';
import FloorFormPage from '@/pages/admin/floors/FloorFormPage';
import FacilitiesListPage from '@/pages/admin/facilities/FacilitiesListPage';
import FacilityFormPage from '@/pages/admin/facilities/FacilityFormPage';
import DepartmentsListPage from '@/pages/admin/departments/DepartmentsListPage';
import DepartmentFormPage from '@/pages/admin/departments/DepartmentFormPage';
import MealTimesListPage from '@/pages/admin/mealTimes/MealTimesListPage';
import MealTimeFormPage from '@/pages/admin/mealTimes/MealTimeFormPage';
import UsersListPage from '@/pages/admin/users/UsersListPage';
import UserCreatePage from '@/pages/users/UserCreatePage';
import UserEditPage from '@/pages/users/UserEditPage';
// F06 - Pantries
import PantriesListPage from '@/pages/admin/pantries/PantriesListPage';
import PantryFormPage from '@/pages/admin/pantries/PantryFormPage';
// F03 - Public portal
import PublicLandingPage from '@/pages/public/PublicLandingPage';
import PublicSitesPage from '@/pages/public/PublicSitesPage';
import PublicSiteFacilitiesPage from '@/pages/public/PublicSiteFacilitiesPage';
import PublicFacilityDetailPage from '@/pages/public/PublicFacilityDetailPage';

// Role-aware default route - sends each role to its natural home.
// super_admin + tenant_admin land on the new utilization dashboard.
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
        <Routes>
          {/* Public */}
          <Route path="/login"            element={<LoginPage />} />
          <Route path="/register"         element={<RegisterPage />} />
          <Route path="/forgot-password"  element={<ForgotPasswordPage />} />
          <Route path="/reset-password"   element={<ResetPasswordPage />} />

          {/* F03 - Public portal (no auth, no AppLayout) */}
          <Route path="/p/:slug"                                       element={<PublicLandingPage />} />
          <Route path="/p/:slug/sites"                                 element={<PublicSitesPage />} />
          <Route path="/p/:slug/sites/:siteId/facilities"              element={<PublicSiteFacilitiesPage />} />
          <Route path="/p/:slug/facilities/:id"                        element={<PublicFacilityDetailPage />} />

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
      </AuthProvider>
    </ThemeProvider>
  );
}
//    {/* Super-admin only */}
//                     <Route path="/admin/tenants" element={
//                       <RequireRole roles={['super_admin']}><TenantsListPage /></RequireRole>
//                     } />
//                     <Route path="*" element={<Navigate to="/" replace />} />
//                   </Routes>
//             </AppLayout>
//               </ProtectedRoute>
//             }
//           />
//         </Routes>
//       </AuthProvider>
//     </ThemeProvider>
//   );
// }
// {['super_admin', 'tenant_admin']}><UserEditPage /></RequireRole>
//                     } />

//                     <Route path="*" element={<Navigate to="/" replace />} />
//                   </Routes>
//             </AppLayout>
//               </ProtectedRoute>
//             }
//           />
//         </Routes>
//       </AuthProvider>
//     </ThemeProvider>
//   );
// }
