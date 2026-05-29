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

import { useMemo, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Menu, LogOut, Building2, Users, Building, Layers,
  Sparkles, UsersRound, UtensilsCrossed, CalendarCheck, FolderCheck, BookOpen,
  X, LayoutDashboard, FolderTree, ChevronDown, ChevronRight, Coffee,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Role } from '@/types';

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

const DASHBOARD: NavItem = {
  to: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" />,
  roles: ['super_admin', 'tenant_admin'],
};

const PLATFORM: NavItem[] = [
  { to: '/admin/tenants', label: 'Tenants', icon: <Building2 className="h-4 w-4" />, roles: ['super_admin'] },
];

const MASTERS: NavItem[] = [
  { to: '/admin/sites',       label: 'Sites',       icon: <Building className="h-4 w-4" />,         roles: ['super_admin', 'tenant_admin'] },
  { to: '/admin/floors',      label: 'Floors',      icon: <Layers className="h-4 w-4" />,           roles: ['super_admin', 'tenant_admin'] },
  { to: '/admin/facilities',  label: 'Facilities',  icon: <Sparkles className="h-4 w-4" />,         roles: ['super_admin', 'tenant_admin'] },
  { to: '/admin/departments', label: 'Departments', icon: <UsersRound className="h-4 w-4" />,       roles: ['super_admin', 'tenant_admin'] },
  { to: '/admin/users',       label: 'Employees',   icon: <Users className="h-4 w-4" />,            roles: ['super_admin', 'tenant_admin'] },
  { to: '/admin/meal-times',  label: 'Meal times',  icon: <UtensilsCrossed className="h-4 w-4" />,  roles: ['super_admin', 'tenant_admin'] },
  { to: '/admin/pantries',    label: 'Pantries',    icon: <Coffee className="h-4 w-4" />,           roles: ['super_admin', 'tenant_admin'] }, // F06
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
  approver:     'Approver',
  employee:     'Employee',
};

const ROLE_CHIP_CLASS: Record<Role, string> = {
  super_admin:  'bg-white/20 text-white',
  tenant_admin: 'bg-emerald-400/30 text-white',
  approver:     'bg-amber-400/30 text-white',
  employee:     'bg-white/15 text-white',
};

const HEADER_H = 64;
const SIDEBAR_W = 248;

export default function AppLayout({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Master group is expanded by default when one of its items is the active
  // route; otherwise admins can toggle it.
  const isMasterActive = MASTERS.some((m) => location.pathname.startsWith(m.to));
  const [mastersOpen, setMastersOpen] = useState(isMasterActive);

  if (!user) return null;

  function handleLogout() {
    logout();
    navigate('/login');
  }

  const brandTitle =
    user.role === 'super_admin' ? 'Facility Booking' : (user.tenant_name || 'Facility Booking');

  // Filter each NAV slot by role.
  const dashItem  = DASHBOARD.roles.includes(user.role) ? DASHBOARD : null;
  const platform  = PLATFORM.filter((i) => i.roles.includes(user.role));
  const masters   = MASTERS.filter((i) => i.roles.includes(user.role));
  const booking   = BOOKING.filter((i) => i.roles.includes(user.role));

  const sections = useMemo<NavSection[]>(() => {
    const out: NavSection[] = [];
    if (dashItem) out.push({ key: 'dashboard', items: [dashItem] });
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
  }, [dashItem, platform, masters, booking]);

  const initials = (user.name?.[0] || user.username?.[0] || 'U').toUpperCase();

  function renderItem(n: NavItem, opts: { indent?: boolean } = {}) {
    return (
      <li key={n.to}>
        <NavLink
          to={n.to}
          onClick={() => setMobileOpen(false)}
          className={({ isActive }) => cn(
            'flex items-center gap-3 py-2 text-sm transition-colors min-w-0',
            opts.indent ? 'pl-10 pr-4' : 'px-4',
            isActive
              ? 'bg-brand-navy-soft text-brand-navy font-semibold'
              : 'text-foreground hover:bg-muted'
          )}
        >
          <span className="shrink-0">{n.icon}</span>
          <span className="truncate">{n.label}</span>
        </NavLink>
      </li>
    );
  }

  const navList = (
    <nav className="py-2">
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
                  'w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors',
                  'text-foreground hover:bg-muted',
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
        // Static section (Platform / Booking) - same as before.
        if (section.label) {
          return (
            <div key={section.key} className="mb-2">
              <div className="px-4 pt-3 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground">
                {section.label.toUpperCase()}
              </div>
              <ul>{section.items.map((it) => renderItem(it))}</ul>
            </div>
          );
        }
        // Bare single-item section (Dashboard) - no header, no indent.
        return (
          <ul key={section.key} className="mb-1">
            {section.items.map((it) => renderItem(it))}
          </ul>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen bg-brand-surface overflow-x-hidden">
      {/* ============ HEADER ============ */}
      <header
        className="fixed top-0 inset-x-0 z-30 bg-brand-navy text-white shadow"
        style={{ height: HEADER_H }}
      >
        <div className="h-full flex items-center gap-2 px-3 sm:px-4">
          <button
            type="button"
            className="md:hidden p-2 rounded hover:bg-white/10 shrink-0"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          <span className="flex-1 min-w-0 text-base font-semibold truncate" title={brandTitle}>
            {brandTitle}
          </span>

          <span
            className={cn(
              'hidden sm:inline-flex shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold',
              ROLE_CHIP_CLASS[user.role]
            )}
          >
            {ROLE_LABEL[user.role]}
          </span>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="ml-1 rounded-full shrink-0 focus:outline-none focus:ring-2 focus:ring-white/40"
                aria-label="Account menu"
              >
                <Avatar className="h-8 w-8 bg-white/15">
                  <AvatarFallback className="bg-white/15 text-white">{initials}</AvatarFallback>
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

      {/* ============ SIDEBAR (md+) ============ */}
      <aside
        className="hidden md:block fixed left-0 z-20 border-r bg-white"
        style={{ top: HEADER_H, bottom: 0, width: SIDEBAR_W }}
      >
        {/* Sidebar stays scrollable in case the nav outgrows the viewport,
            but the scrollbar itself is hidden — cleaner look, matches the
            mockup. Works in Chrome / Edge / Safari via ::-webkit-scrollbar
            and Firefox via scrollbar-width:none. */}
        <div className="h-full overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {navList}
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
          <aside className="md:hidden fixed inset-y-0 left-0 z-50 w-[248px] max-w-[85vw] bg-white shadow-xl flex flex-col">
            <div
              className="flex items-center justify-between px-4 border-b shrink-0"
              style={{ height: HEADER_H }}
            >
              <span className="text-base font-bold truncate" title={brandTitle}>{brandTitle}</span>
              <Button
                variant="ghost" size="icon"
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
        <div className="md:ml-[248px]">{children}</div>
      </main>
    </div>
  );
}
