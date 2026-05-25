import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import type { Role } from '@/types';

/**
 * Inline gate - renders children only if the current user is one of `roles`.
 * Useful for hiding individual buttons/columns inside a page.
 */
export function RoleGate({ roles, children, fallback = null }: {
  roles: Role[];
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) return <>{fallback}</>;
  return <>{children}</>;
}

/**
 * Route guard - if the current user isn't one of `roles`, bounces them
 * to their role's home (or /login if not authed).
 */
export function RequireRole({ roles, children }: {
  roles: Role[];
  children: ReactNode;
}) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) {
    const home =
      user.role === 'super_admin' ? '/admin/tenants'
      : user.role === 'tenant_admin' ? '/admin/sites'
      : '/facility';
    return <Navigate to={home} replace />;
  }
  return <>{children}</>;
}
