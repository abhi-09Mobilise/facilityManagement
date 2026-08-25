// App shell - Tailwind + shadcn.
//
// Layout:
//   +------------------------------------------------------+
//   |               <header> (full width, h-16)            |
//   +----------+-------------------------------------------+
//   | <aside>  |                                           |
//   |  (md+)   |             <main>                        |
//   +----------+-------------------------------------------+
//
// Side nav structure (this rev):
//   - Dashboard      (single item, super_admin + tenant_admin)
//   - Platform       (super_admin only - Tenants, Lookups)
//   - Masters        (collapsible group: Sites, Floors, Facilities,
//                     Departments, Employees, Meal times)
//   - Booking        (everyone - Book a facility, Approvals)
//
// Masters auto-expands when any of its children is the active route.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Suspense } from 'react';
import PageSpinner from '@/components/PageSpinner';
import {
  Menu, LogOut, Building2, Users, Building, Layers,
  Sparkles, UsersRound, UtensilsCrossed, CalendarCheck, FolderCheck, BookOpen,
  X, LayoutDashboard, FolderTree, ChevronDown, ChevronRight, Coffee, Network,
  Warehouse, RefreshCw, Boxes, Activity, ShieldCheck,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { RefreshProvider, useRefresh } from '@/context/RefreshContext';
import { TenantScopeProvider, useTenantScope } from '@/context/TenantScopeContext';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Organisation, Role, Tenant } from '@/types';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  roles: Role[];
}

interface NavSection {
  key: string;
  label?: string;       // shown as a static header (no group control)
  groupKey?: string;    // if present, section is rendered as a collapsible group with this label/icon
  groupLabel?: string;
  groupIcon?: ReactNode;
  items: NavItem[];
}

// Prototype nav: "Live overview" is the admin home; the legacy dashboard
// (utilisation charts + Gantt) stays reachable as "Analytics".
const DASHBOARD: NavItem = {
  to: '/overview', label: 'Live overview', icon: <LayoutDashboard className="h-4 w-4" />,
  roles: ['super_admin', 'tenant_admin'],
};

const ANALYTICS: NavItem = {
  to: '/dashboard', label: 'Analytics', icon: <Activity className="h-4 w-4" />,
  roles: ['super_admin', 'tenant_admin'],
};

const PLATFORM: NavItem[] = [
  { to: '/admin/tenants', label: 'Tenants', icon: <Building2 className="h-4 w-4" />, roles: ['super_admin'] },
];

const MASTERS: NavItem[] = [
  // Phase B — hierarchy pages live under the shared /admin/masters/* shell
  // (tabs + cascade filter). Legacy /admin/<segment> URLs are still routed
  // for deep-link compatibility but the sidebar now points at the shell.
  { to: '/admin/masters/organisations', label: 'Organisations', icon: <Network className="h-4 w-4" />,        roles: ['super_admin', 'tenant_admin'] },
  { to: '/admin/masters/sites',         label: 'Sites',         icon: <Building className="h-4 w-4" />,       roles: ['super_admin', 'tenant_admin'] },
  { to: '/admin/masters/buildings',     label: 'Buildings',     icon: <Warehouse className="h-4 w-4" />,      roles: ['super_admin', 'tenant_admin'] },
  { to: '/admin/masters/floors',        label: 'Floors',        icon: <Layers className="h-4 w-4" />,         roles: ['super_admin', 'tenant_admin'] },
  { to: '/admin/masters/facilities',    label: 'Facilities',    icon: <Sparkles className="h-4 w-4" />,       roles: ['super_admin', 'tenant_admin'] },
  { to: '/admin/floor-3d',              label: '3D Studio',     icon: <Boxes className="h-4 w-4" />,          roles: ['super_admin', 'tenant_admin', 'org_admin'] },
  // Departments / Users / Meal times / Pantries are NOT part of the tabbed
  // shell — they still open on their own pages.
  { to: '/admin/departments',           label: 'Departments',   icon: <UsersRound className="h-4 w-4" />,     roles: ['super_admin', 'tenant_admin'] },
  { to: '/admin/users',                 label: 'Employees',     icon: <Users className="h-4 w-4" />,          roles: ['super_admin', 'tenant_admin'] },
  { to: '/admin/meal-times',            label: 'Meal times',    icon: <UtensilsCrossed className="h-4 w-4" />, roles: ['super_admin', 'tenant_admin'] },
  { to: '/admin/pantries',              label: 'Pantries',      icon: <Coffee className="h-4 w-4" />,         roles: ['super_admin', 'tenant_admin'] }, // F06
  // Configurable RBAC — the prototype's Roles & access matrix, editable.
  { to: '/admin/permissions',           label: 'Roles & permissions', icon: <ShieldCheck className="h-4 w-4" />, roles: ['super_admin', 'tenant_admin'] },
];

const BOOKING: NavItem[] = [
  { to: '/facility',     label: 'Book a facility', icon: <CalendarCheck className="h-4 w-4" />, roles: ['super_admin', 'tenant_admin', 'approver', 'employee'] },
  { to: '/my-bookings',  label: 'My bookings',     icon: <BookOpen className="h-4 w-4" />,      roles: ['super_admin', 'tenant_admin', 'approver', 'employee'] },
  // Approvals is only useful to people who can actually approve - employees
  // never have anything in here. super_admin + tenant_admin keep access for
  // cross-cutting / override scenarios.
  { to: '/approvals',    label: 'Approvals',       icon: <FolderCheck className="h-4 w-4" />,   roles: ['super_admin', 'tenant_admin', 'approver'] },
];

const ROLE_LABEL: Record<Role, string> = {
  super_admin:  'Super admin',
  tenant_admin: 'Tenant admin',
  org_admin:    'Org admin',
  approver:     'Approver',
  employee:     'Employee',
};

// Prototype .tag styles: soft background + ink text per role.
const ROLE_CHIP_CLASS: Record<Role, string> = {
  super_admin:  'bg-violet-soft text-[#5B27B8]',
  tenant_admin: 'bg-teal-soft text-teal-ink',
  org_admin:    'bg-indigo-soft text-indigo-ink',
  approver:     'bg-amber-soft text-amber-ink',
  employee:     'bg-[#EDF0F5] text-mutedx',
};

// Persona avatar colors, matching the prototype's people palette.
const ROLE_AVATAR_BG: Record<Role, string> = {
  super_admin:  '#7A3BE8',
  tenant_admin: '#0E8C7F',
  org_admin:    '#3657E8',
  approver:     '#D98A0B',
  employee:     '#3657E8',
};

const HEADER_H = 64;
const SIDEBAR_W = 248;

// Global back button shown above every page's children (hidden on role-home routes).
import BackButton from '@/components/BackButton';
import { tenantsApi } from '@/api/tenants.api';
import { organisationsApi } from '@/api/organisations.api';

export default function AppLayout() {
  return (
    <TenantScopeProvider>
      <RefreshProvider>
        <AppLayoutInner />
      </RefreshProvider>
    </TenantScopeProvider>
  );
}

function AppLayoutInner() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Master group is expanded by default when one of its items is the active
  // route; otherwise admins can toggle it.
  const isMasterActive = MASTERS.some((m) => location.pathname.startsWith(m.to));
  const [mastersOpen, setMastersOpen] = useState(isMasterActive);

  // Navbar-level Tenant + Organisation scope pickers.
  //   super_admin  → picks a tenant, then an org within that tenant
  //   tenant_admin → tenant is fixed to their JWT; only picks an org
  //   others       → no pickers rendered
  //
  // The picked values live in TenantScopeContext (session-persisted, cascading);
  // this component just owns the dropdown option lists.
  const isSuper       = user?.role === 'super_admin';
  const isTenantAdmin = user?.role === 'tenant_admin';
  const showTenantPicker = !!isSuper;
  const showOrgPicker    = !!(isSuper || isTenantAdmin);

  const scope = useTenantScope();

  const [tenants, setTenants]    = useState<Tenant[]>([]);
  const [organisations, setOrgs] = useState<Organisation[]>([]);

  // Load the tenant list once for super_admin. tenant_admin never needs it
  // (their tenant is on the JWT).
  useEffect(() => {
    if (!showTenantPicker) return;
    tenantsApi.list({ limit: 500 })
      .then((r) => {
        const list = (r.data?.data || []) as Tenant[];
        setTenants(list);
        // On first load, if scope has no tenant yet, default to the first one
        // so the org picker + downstream pages have a scope to work with.
        if (list.length > 0 && scope.tenantId === null) {
          scope.setTenantId(list[0].id);
        }
      })
      .catch(() => setTenants([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTenantPicker]);

  // Load orgs whenever the effective tenant changes.
  //   super_admin: uses scope.tenantId (from context)
  //   tenant_admin: uses user.tenant_id (fixed, JWT)
  useEffect(() => {
    if (!showOrgPicker) return;
    const effectiveTenantId = isTenantAdmin ? user?.tenant_id : scope.tenantId;
    if (!effectiveTenantId) { setOrgs([]); return; }
    organisationsApi.list({ limit: 500, tenant_id: effectiveTenantId })
      .then((r) => {
        const list = (r.data?.data || []) as Organisation[];
        setOrgs(list);
        // Auto-pick the first org if none currently selected so consumers
        // always have a scope. Cascade from tenantId change already wiped
        // organisationId, so this fires cleanly on tenant switch.
        if (list.length > 0 && scope.organisationId === null) {
          scope.setOrganisationId(list[0].id);
        }
      })
      .catch(() => setOrgs([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showOrgPicker, isTenantAdmin, scope.tenantId, user?.tenant_id]);

  if (!user) return null;

  function handleLogout() {
    logout();
    navigate('/login');
  }

  const brandTitle =
    user.role === 'super_admin' ? 'Facility Booking' : (user.tenant_name || 'Facility Booking');

  // Filter each NAV slot by role.
  const dashItem  = DASHBOARD.roles.includes(user.role) ? DASHBOARD : null;
  const analyticsItem = ANALYTICS.roles.includes(user.role) ? ANALYTICS : null;
  const platform  = PLATFORM.filter((i) => i.roles.includes(user.role));
  const masters   = MASTERS.filter((i) => i.roles.includes(user.role));
  const booking   = BOOKING.filter((i) => i.roles.includes(user.role));

  const sections = useMemo<NavSection[]>(() => {
    const out: NavSection[] = [];
    if (dashItem) out.push({ key: 'dashboard', items: analyticsItem ? [dashItem, analyticsItem] : [dashItem] });
    if (platform.length > 0) out.push({ key: 'platform', label: 'Platform', items: platform });
    if (masters.length > 0) out.push({
      key: 'masters',
      groupKey: 'masters',
      groupLabel: 'Masters',
      groupIcon: <FolderTree className="h-4 w-4" />,
      items: masters,
    });
    if (booking.length > 0) out.push({ key: 'booking', label: 'Booking', items: booking });
    return out;
  }, [dashItem, analyticsItem, platform, masters, booking]);

  const initials = (user.name?.[0] || user.username?.[0] || 'U').toUpperCase();

  function renderItem(n: NavItem, opts: { indent?: boolean } = {}) {
    return (
      <li key={n.to}>
        <NavLink
          to={n.to}
          onClick={() => setMobileOpen(false)}
          className={({ isActive }) => cn(
            'flex items-center gap-2.5 py-2 text-[13.5px] font-medium rounded-[9px] transition-colors min-w-0',
            opts.indent ? 'pl-9 pr-2.5' : 'px-2.5',
            isActive
              ? 'bg-indigo-soft text-indigo-ink [&_svg]:text-indigo'
              : 'text-inktext hover:bg-paper [&_svg]:text-mutedx'
          )}
        >
          <span className="shrink-0">{n.icon}</span>
          <span className="truncate">{n.label}</span>
        </NavLink>
      </li>
    );
  }

  // Prototype rail: logo block + persona card + sectioned nav + status foot.
  const railHeader = (
    <>
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <div className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-ink text-white">
          <Building2 className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="truncate font-display text-[15px] font-bold tracking-tight" title={brandTitle}>
            {brandTitle}
          </div>
          <div className="text-[11px] font-medium text-mutedx">Workplace booking</div>
        </div>
      </div>
      <div className="mx-3 mb-2 flex items-center gap-2.5 rounded-xl border border-line bg-[#FAFBFD] px-3 py-2.5">
        <div
          className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full font-display text-xs font-semibold text-white"
          style={{ backgroundColor: ROLE_AVATAR_BG[user.role] }}
        >
          {initials}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">{user.name || user.username}</div>
          <div className="truncate text-[11.5px] text-mutedx">{ROLE_LABEL[user.role]}</div>
        </div>
      </div>
    </>
  );

  const navList = (
    <nav className="px-2.5 py-1">
      {sections.map((section) => {
        // Collapsible group (Masters).
        if (section.groupKey) {
          const expanded = mastersOpen;
          return (
            <div key={section.key} className="mb-1">
              <button
                type="button"
                onClick={() => setMastersOpen((v) => !v)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-2.5 py-2 text-[13.5px] font-medium rounded-[9px] transition-colors',
                  'text-inktext hover:bg-paper [&_svg]:text-mutedx',
                  expanded && 'font-semibold'
                )}
                aria-expanded={expanded}
              >
                <span className="shrink-0">{section.groupIcon}</span>
                <span className="flex-1 text-left truncate">{section.groupLabel}</span>
                <span className="shrink-0">
                  {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </span>
              </button>
              {expanded && (
                <ul>
                  {section.items.map((it) => renderItem(it, { indent: true }))}
                </ul>
              )}
            </div>
          );
        }
        // Static section (Platform / Booking) with a prototype-style eyebrow.
        if (section.label) {
          return (
            <div key={section.key} className="mb-1">
              <div className="px-2.5 pt-3 pb-1 text-[10.5px] font-semibold uppercase tracking-[.1em] text-faint">
                {section.label}
              </div>
              <ul>{section.items.map((it) => renderItem(it))}</ul>
            </div>
          );
        }
        // Bare single-item section (Dashboard) - no header, no indent.
        return (
          <ul key={section.key} className="mb-1 pt-1">
            {section.items.map((it) => renderItem(it))}
          </ul>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen bg-paper overflow-x-hidden">
      {/* ============ HEADER (prototype topbar: light, bordered) ============ */}
      <header
        className="fixed top-0 inset-x-0 z-30 bg-card border-b border-line"
        style={{ height: HEADER_H }}
      >
        <div className="h-full flex items-center gap-2 px-3 sm:px-4 md:pl-[264px]">
          <button
            type="button"
            className="md:hidden grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-line bg-card text-inktext hover:bg-paper"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Brand shows here only on mobile; on md+ it lives in the rail */}
          <span
            className="md:hidden flex-1 min-w-0 font-display text-[15px] font-bold truncate"
            title={brandTitle}
          >
            {brandTitle}
          </span>
          <span className="hidden md:block flex-1" />

          <NavbarRefreshButton />

          {/* Navbar scope pickers.
              super_admin  → Tenant + Organisation
              tenant_admin → Organisation only (their tenant is fixed) */}
          <div className="hidden md:flex items-center gap-2 shrink-0">
            {showTenantPicker && (
              <select
                aria-label="Tenant"
                title="Tenant"
                className="h-9 rounded-[9px] border border-line-2 bg-card px-2.5 text-[12.5px] font-medium text-inktext min-w-[160px] max-w-[220px] focus:outline-none focus:ring-2 focus:ring-indigo/30 focus:border-indigo"
                value={scope.tenantId ?? ''}
                onChange={(e) => scope.setTenantId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">All tenants</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}
            {showOrgPicker && (
              <select
                aria-label="Organisation"
                title="Organisation"
                className="h-9 rounded-[9px] border border-line-2 bg-card px-2.5 text-[12.5px] font-medium text-inktext min-w-[160px] max-w-[220px] focus:outline-none focus:ring-2 focus:ring-indigo/30 focus:border-indigo disabled:opacity-50"
                value={scope.organisationId ?? ''}
                onChange={(e) => scope.setOrganisationId(e.target.value ? Number(e.target.value) : null)}
                disabled={organisations.length === 0}
              >
                <option value="">
                  {organisations.length === 0 ? 'No organisations' : 'All organisations'}
                </option>
                {organisations.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            )}
          </div>

          <span
            className={cn(
              'hidden sm:inline-flex items-center gap-1.5 shrink-0 px-2 py-0.5 rounded-full text-[11.5px] font-semibold',
              ROLE_CHIP_CLASS[user.role]
            )}
          >
            <i className="h-1.5 w-1.5 rounded-full bg-current" />
            {ROLE_LABEL[user.role]}
          </span>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="ml-1 rounded-full shrink-0 focus:outline-none focus:ring-2 focus:ring-indigo/40"
                aria-label="Account menu"
              >
                <Avatar className="h-[34px] w-[34px]">
                  <AvatarFallback
                    className="font-display text-xs font-semibold text-white"
                    style={{ backgroundColor: ROLE_AVATAR_BG[user.role] }}
                  >
                    {initials}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="truncate">{user.name || user.username}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={handleLogout}>
                <LogOut className="h-4 w-4" />
                Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* ============ SIDEBAR (md+) — prototype rail: full height, brand on top ============ */}
      <aside
        className="hidden md:flex md:flex-col fixed left-0 top-0 bottom-0 z-40 border-r border-line bg-card"
        style={{ width: SIDEBAR_W }}
      >
        {railHeader}
        {/* Sidebar stays scrollable in case the nav outgrows the viewport,
            but the scrollbar itself is hidden — cleaner look, matches the
            prototype. */}
        <div className="flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {navList}
        </div>
        <div className="border-t border-line px-4 py-3 text-[11.5px] text-mutedx">
          <span className="mr-1.5 inline-block h-[7px] w-[7px] rounded-full bg-teal shadow-[0_0_0_3px_#DCF3EE]" />
          All systems operational
        </div>
      </aside>

      {/* ============ MOBILE SLIDE-OVER ============ */}
      {mobileOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 z-40 bg-black/40"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <aside className="md:hidden fixed inset-y-0 left-0 z-50 w-[264px] max-w-[85vw] bg-card shadow-xl flex flex-col">
            <div className="flex items-start justify-between shrink-0">
              <div className="min-w-0 flex-1">{railHeader}</div>
              <Button
                variant="ghost" size="icon"
                className="m-2 shrink-0"
                aria-label="Close menu"
                onClick={() => setMobileOpen(false)}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {navList}
            </div>
          </aside>
        </>
      )}

      {/* ============ MAIN ============ */}
      <main
        className="min-w-0 overflow-x-hidden p-3 sm:p-4 md:p-6"
        style={{ paddingTop: HEADER_H + 16 }}
      >
        <div className="md:ml-[248px]">
          <BackButton />
          {/* Scoped Suspense: navbar + sidebar stay put while a
              lazy route chunk downloads. Only the outlet spins. */}
          <Suspense fallback={<PageSpinner />}>
            <Outlet />
          </Suspense>
        </div>
      </main>
    </div>
  );
}

// Sits in the header, invokes whichever page has registered a refresh
// handler via useRegisterRefresh(). Hidden until a page opts in so it
// doesn't confuse the user on pages that don't support it.
function NavbarRefreshButton() {
  const { canRefresh, trigger } = useRefresh();
  if (!canRefresh) return null;
  return (
    <button
      type="button"
      onClick={trigger}
      aria-label="Refresh"
      title="Refresh"
      className="shrink-0 p-2 rounded hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/40"
    >
      <RefreshCw className="h-5 w-5" />
    </button>
  );
}
