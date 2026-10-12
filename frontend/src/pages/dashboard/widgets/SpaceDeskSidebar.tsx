// Dark-forest-green left sidebar for the SpaceDesk dashboard.
//
// Only the SpaceDesk visual design is bespoke here — the nav items,
// labels, and routes mirror the generic AppLayout sidebar so that
// clicking any link lands on the same destination the main app sidebar
// would send you to.
//
// "Live overview" is the active item because this sidebar renders inside
// SpaceDeskDashboardPage, which is wired to /overview.

import { Link } from 'react-router-dom';
import {
  LayoutDashboard, Activity, Building2, FolderTree,
  CalendarCheck, BookOpen, FolderCheck, X,
} from 'lucide-react';

interface Props {
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

interface NavEntry {
  label: string;
  Icon: React.ElementType;
  to: string;
  badge?: number;
  active?: boolean;
}

// Top-level items (no section header), mirroring AppLayout's dashboard group.
const topItems: NavEntry[] = [
  { label: 'Live overview', Icon: LayoutDashboard, to: '/overview',  active: true },
  { label: 'Analytics',     Icon: Activity,        to: '/dashboard' },
];

const platformItems: NavEntry[] = [
  { label: 'Tenants', Icon: Building2, to: '/admin/tenants' },
];

// Masters appears between PLATFORM and BOOKING in AppLayout as its own
// collapsible group. Here it's rendered as a standalone nav item that
// opens the Masters shell.
const mastersItem: NavEntry = {
  label: 'Masters', Icon: FolderTree, to: '/admin/masters/sites',
};

const bookingItems: NavEntry[] = [
  { label: 'Book a facility', Icon: CalendarCheck, to: '/facility' },
  { label: 'My bookings',     Icon: BookOpen,      to: '/my-bookings' },
  { label: 'Approvals',       Icon: FolderCheck,   to: '/approvals' },
];

export function SpaceDeskSidebar({ mobileOpen, onCloseMobile }: Props) {
  return (
    <>
      {/* Mobile scrim */}
      {mobileOpen && (
        <div
          onClick={onCloseMobile}
          className="lg:hidden fixed inset-0 bg-black/40 z-40"
        />
      )}
      <aside
        className={
          'fixed lg:static top-0 left-0 h-full z-50 w-[232px] shrink-0 flex flex-col ' +
          'bg-[#071F1A] text-emerald-50 transition-transform lg:translate-x-0 ' +
          (mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0')
        }
      >
        {/* Brand row */}
        <div className="flex items-center justify-between px-4 pt-5 pb-6">
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 text-emerald-950 flex items-center justify-center shadow-md">
              <CalendarCheck className="h-5 w-5" />
            </div>
            <div className="text-lg font-bold tracking-tight text-white">SpaceDesk</div>
          </div>
          <button
            type="button"
            onClick={onCloseMobile}
            className="lg:hidden p-1 text-emerald-100/70 hover:text-white"
            aria-label="Close sidebar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Primary nav */}
        <nav className="px-3 flex-1 overflow-y-auto">
          {topItems.map((item) => <NavItem key={item.label} {...item} />)}

          <SectionLabel>Platform</SectionLabel>
          {platformItems.map((item) => <NavItem key={item.label} {...item} />)}

          {/* Masters sits between Platform and Booking (mirrors AppLayout). */}
          <div className="mt-5">
            <NavItem {...mastersItem} />
          </div>

          <SectionLabel>Booking</SectionLabel>
          {bookingItems.map((item) => <NavItem key={item.label} {...item} />)}
        </nav>

        {/* Bottom info card — "4 ways to book" */}
        <div className="p-3 pb-5">
          <div className="rounded-xl bg-emerald-950/40 border border-emerald-800/50 p-3.5">
            <div className="text-sm font-semibold text-white">4 ways to book</div>
            <p className="text-[11px] text-emerald-100/70 mt-1 leading-snug">
              Every facility can be booked from any channel.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {['QR', 'App', 'Portal', 'Tablet'].map((p) => (
                <span
                  key={p}
                  className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-emerald-800/50 text-emerald-100 border border-emerald-700/50"
                >
                  {p}
                </span>
              ))}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-200/50 px-3 mt-5 mb-1.5">
      {children}
    </div>
  );
}

function NavItem({ label, Icon, to, badge, active }: NavEntry) {
  return (
    <Link
      to={to}
      className={
        'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ' +
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#071F1A] ' +
        (active
          ? 'bg-emerald-900/70 text-white font-semibold shadow-sm border border-emerald-700/40'
          : 'text-emerald-100/80 hover:bg-emerald-900/50 hover:text-white border border-transparent')
      }
    >
      <Icon className={'h-4 w-4 shrink-0 ' + (active ? 'text-emerald-300' : 'text-emerald-200/60')} />
      <span className="flex-1 truncate">{label}</span>
      {badge !== undefined && (
        <span
          className={
            'text-[10px] font-semibold px-1.5 py-0.5 rounded-md border ' +
            (active
              ? 'bg-emerald-700/50 text-emerald-100 border-emerald-600/50'
              : 'bg-emerald-900/50 text-emerald-200/80 border-emerald-800/50')
          }
        >
          {badge}
        </span>
      )}
    </Link>
  );
}
