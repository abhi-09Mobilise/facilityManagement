// Right-side slide-out panel triggered by clicking the "Booked today" KPI
// tile. Shows every non-cancelled booking whose window intersects today in
// a compact table (row-per-booking), enriched with site + organisation
// names resolved client-side from the lists the dashboard already has.
//
// Deliberately plain Tailwind rather than pulling in MUI's Drawer — the
// rest of the SpaceDesk dashboard is Tailwind + lucide-react, so this
// matches the existing look + keeps the bundle lean.

import { useEffect } from 'react';
import { X, Clock } from 'lucide-react';
import type { BookedTodayRow } from '../useLiveDashboardData';

interface Props {
  open: boolean;
  onClose: () => void;
  rows: BookedTodayRow[];
  totalFacilities: number;
}

export function BookedTodayDrawer({ open, onClose, rows, totalFacilities }: Props) {
  // Lock background scroll + close on Esc while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  const facilitiesTouched = new Set(rows.map((r) => r.facility_id)).size;
  const seatsTaken = rows.reduce((s, r) => s + (r.attendee_count || 1), 0);

  return (
    <>
      {/* Backdrop */}
      <div
        className={
          'fixed inset-0 bg-black/40 z-40 transition-opacity duration-200 ' +
          (open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none')
        }
        onClick={onClose}
        aria-hidden
      />

      {/* Panel — wider than the card version so the table fits without
          column truncation. Stays scrollable on narrower viewports. */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Today's bookings"
        className={
          'fixed top-0 right-0 h-full w-full sm:w-[720px] md:w-[880px] lg:w-[1020px] bg-white dark:bg-slate-900 shadow-2xl z-50 ' +
          'transform transition-transform duration-200 ease-out flex flex-col ' +
          (open ? 'translate-x-0' : 'translate-x-full')
        }
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Booked today
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {rows.length} booking{rows.length === 1 ? '' : 's'} ·{' '}
              {facilitiesTouched} / {totalFacilities} facilities ·{' '}
              {seatsTaken} seat{seatsTaken === 1 ? '' : 's'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto">
          {rows.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 dark:text-slate-400 py-16">
              <Clock className="h-10 w-10 mb-3 opacity-40" />
              <p className="text-sm">No bookings for today.</p>
              <p className="text-xs mt-1 opacity-70">
                When someone books a facility for today, it'll appear here.
              </p>
            </div>
          ) : (
            <BookingsTable rows={rows} />
          )}
        </div>
      </aside>
    </>
  );
}

function BookingsTable({ rows }: { rows: BookedTodayRow[] }) {
  return (
    <table className="w-full text-sm text-left border-collapse">
      <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800/80 backdrop-blur-sm text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
        <tr>
          <Th>ID</Th>
          <Th>Title</Th>
          <Th>Facility</Th>
          <Th>Site</Th>
          <Th>Organisation</Th>
          <Th>Time</Th>
          <Th align="right">Seats</Th>
          <Th>Booker</Th>
          <Th>Status</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
        {rows.map((r) => (
          <tr
            key={r.id}
            className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
          >
            <Td className="font-mono text-xs text-slate-500 dark:text-slate-400">#{r.id}</Td>
            <Td className="font-medium text-slate-900 dark:text-slate-100 max-w-[180px] truncate" title={r.title}>
              {r.title}
            </Td>
            <Td className="text-slate-700 dark:text-slate-300 max-w-[160px] truncate" title={r.facility_name}>
              {r.facility_name}
              {r.facility_type && (
                <span className="ml-1 text-[10px] text-slate-400 dark:text-slate-500 uppercase">
                  {prettyType(r.facility_type)}
                </span>
              )}
            </Td>
            <Td className="text-slate-700 dark:text-slate-300 max-w-[140px] truncate" title={r.site_name}>
              {r.site_name}
            </Td>
            <Td className="text-slate-700 dark:text-slate-300 max-w-[140px] truncate" title={r.organisation_name}>
              {r.organisation_name}
            </Td>
            <Td className="text-slate-700 dark:text-slate-300 whitespace-nowrap tabular-nums">
              {formatTimeRange(r.start_at, r.end_at)}
            </Td>
            <Td align="right" className="text-slate-700 dark:text-slate-300 tabular-nums">
              {r.attendee_count}
            </Td>
            <Td className="text-slate-700 dark:text-slate-300 max-w-[150px] truncate" title={r.booker_name}>
              <div className="truncate">{r.booker_name}</div>
              {r.department_name && (
                <div className="text-[10px] text-slate-400 dark:text-slate-500 truncate">
                  {r.department_name}
                </div>
              )}
            </Td>
            <Td>
              <StatusChip status={r.status} />
            </Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      scope="col"
      className={'px-3 py-2.5 ' + (align === 'right' ? 'text-right' : 'text-left')}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = '',
  align,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  align?: 'left' | 'right';
  title?: string;
}) {
  return (
    <td
      className={'px-3 py-3 align-top ' + (align === 'right' ? 'text-right ' : '') + className}
      title={title}
    >
      {children}
    </td>
  );
}

function StatusChip({ status }: { status: string }) {
  const palette: Record<string, string> = {
    approved:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    pending:   'bg-amber-100   text-amber-700   dark:bg-amber-900/40   dark:text-amber-300',
    completed: 'bg-blue-100    text-blue-700    dark:bg-blue-900/40    dark:text-blue-300',
  };
  const cls = palette[status] || 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-medium capitalize ${cls}`}>
      {status}
    </span>
  );
}

// "2026-10-19 14:30:00" + "2026-10-19 15:00:00"  →  "14:30 – 15:00"
function formatTimeRange(startAt: string, endAt: string): string {
  const start = extractTime(startAt);
  const end   = extractTime(endAt);
  return `${start} – ${end}`;
}

function extractTime(dt: string): string {
  // Accept both "YYYY-MM-DD HH:MM:SS" and ISO forms. Just slice the time
  // portion to keep this cheap and timezone-free.
  const m = /(\d{2}):(\d{2})/.exec(dt);
  return m ? `${m[1]}:${m[2]}` : dt;
}

function prettyType(t: string): string {
  return t.replace(/_/g, ' ');
}
