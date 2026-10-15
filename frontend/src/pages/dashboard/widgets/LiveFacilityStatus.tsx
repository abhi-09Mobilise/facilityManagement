// Horizontal row of state filter chips (All / In use / Starting soon /
// Available / Maintenance) followed by matching facility cards.

import { useState } from 'react';
import { LayoutGrid } from 'lucide-react';
import { getLiveFacilityStatus, type LiveFacility } from '../sampleData';

type State = LiveFacility['state'] | 'all';

const chipMeta: { state: State; label: string; dot: string }[] = [
  { state: 'all',             label: 'All',           dot: '#64748b' },
  { state: 'in_use',          label: 'In use',        dot: '#f97316' },
  { state: 'starting_soon',   label: 'Starting soon', dot: '#3b82f6' },
  { state: 'available',       label: 'Available',     dot: '#10b981' },
  { state: 'maintenance',     label: 'Maintenance',   dot: '#64748b' },
];

const stateMeta: Record<LiveFacility['state'], { label: string; dot: string; textClass: string }> = {
  in_use:        { label: 'In use',        dot: '#f97316', textClass: 'text-orange-700 dark:text-orange-300' },
  starting_soon: { label: 'Starting soon', dot: '#3b82f6', textClass: 'text-blue-700 dark:text-blue-300' },
  available:     { label: 'Available',     dot: '#10b981', textClass: 'text-emerald-700 dark:text-emerald-300' },
  maintenance:   { label: 'Maintenance',   dot: '#64748b', textClass: 'text-slate-700 dark:text-slate-300' },
};

interface Props {
  // Non-empty array REPLACES the mock list with real per-facility rows
  // from dashboardsApi.tenantAdmin() enriched with today's bookings.
  liveOverlay?: LiveFacility[] | null;
}

export function LiveFacilityStatus({ liveOverlay }: Props = {}) {
  const all = getLiveFacilityStatus(liveOverlay);
  const [filter, setFilter] = useState<State>('all');

  const counts: Record<State, number> = {
    all: all.length,
    in_use: all.filter((f) => f.state === 'in_use').length,
    starting_soon: all.filter((f) => f.state === 'starting_soon').length,
    available: all.filter((f) => f.state === 'available').length,
    maintenance: all.filter((f) => f.state === 'maintenance').length,
  };

  const visible = filter === 'all' ? all : all.filter((f) => f.state === filter);

  return (
    <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200/70 dark:border-slate-700/70 shadow-sm p-5 h-[560px] flex flex-col">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
          <LayoutGrid className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Live facility status</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">Which facilities are booked right now</p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 flex-wrap">
        {chipMeta.map((c) => (
          <button
            key={c.state}
            type="button"
            onClick={() => setFilter(c.state)}
            className={
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border transition-colors ' +
              (filter === c.state
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800')
            }
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.dot }} />
            {c.label}
            <span className={'ml-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ' + (filter === c.state ? 'bg-white dark:bg-slate-800/20 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400')}>
              {counts[c.state]}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 flex-1 min-h-0 overflow-y-auto content-start pr-1">
        {visible.map((f) => <FacilityCard key={f.id} facility={f} />)}
      </div>
    </div>
  );
}

function FacilityCard({ facility }: { facility: LiveFacility }) {
  const m = stateMeta[facility.state];
  return (
    <div className="rounded-lg border border-slate-200/70 dark:border-slate-700/70 p-3 pl-4 relative">
      <span className="absolute left-0 top-3 bottom-3 w-1 rounded-r-full" style={{ background: m.dot }} />
      <div className="font-semibold text-slate-900 dark:text-slate-100">{facility.name}</div>
      <div className="text-[11px] text-slate-500 dark:text-slate-400">{facility.type} · {facility.site}</div>
      <div className={`mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-medium ${m.textClass}`}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.dot }} />
        {m.label}
      </div>
      {facility.note && (
        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{facility.note}</div>
      )}
    </div>
  );
}
