// Weekday × hour heatmap with busiest-slot / busiest-hour / quietest-hour
// callouts and an "All facility types" filter dropdown.

import { useEffect, useRef, useState } from 'react';
import { Clock, Flame, Sun, Moon, ChevronDown } from 'lucide-react';
import { getPeakBookingTimes, type PeakCell } from '../sampleData';

const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const DAYS: PeakCell['weekday'][] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const FACILITY_TYPES = [
  'All facility types',
  'Conference Hall',
  'Discussion Cabin',
  'Hot Desk Zone',
  'Meeting Room',
  'Phone Booth',
  'Training Room',
];

interface Tooltip {
  x: number;
  y: number;
  day: string;
  hour: number;
  value: number;
}

export function PeakBookingTimes() {
  const { cells, busiestSlot, busiestHour, quietestWorking, maxPerSlot } = getPeakBookingTimes();
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterType, setFilterType] = useState<string>('All facility types');
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const filterRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside.
  useEffect(() => {
    if (!filterOpen) return;
    const handler = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [filterOpen]);

  // Build a lookup for cell -> count.
  const lookup = new Map<string, number>();
  cells.forEach((c) => lookup.set(`${c.weekday}-${c.hour}`, c.count));

  return (
    <div className="rounded-2xl bg-white border border-slate-200/70 shadow-sm p-5 h-full flex flex-col">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">Peak booking times</h3>
            <p className="text-xs text-slate-500">Bookings by start hour and weekday</p>
          </div>
        </div>

        <div ref={filterRef} className="relative">
          <button
            type="button"
            onClick={() => setFilterOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={filterOpen}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-emerald-400/60 text-emerald-700 text-xs font-medium bg-emerald-50/50 hover:bg-emerald-50"
          >
            {filterType}
            <ChevronDown className={'h-3.5 w-3.5 transition-transform ' + (filterOpen ? 'rotate-180' : '')} />
          </button>
          {filterOpen && (
            <ul
              role="listbox"
              className="absolute right-0 top-full mt-1 w-48 rounded-lg bg-white border border-slate-200 shadow-lg z-20 py-1 text-sm"
            >
              {FACILITY_TYPES.map((t) => {
                const selected = filterType === t;
                return (
                  <li key={t}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => { setFilterType(t); setFilterOpen(false); }}
                      className={
                        'w-full text-left px-3 py-1.5 transition-colors ' +
                        (selected
                          ? 'bg-slate-100 text-slate-900 font-medium'
                          : 'text-slate-700 hover:bg-slate-50')
                      }
                    >
                      {t}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <Callout
          Icon={Flame}
          iconBg="bg-orange-100 text-orange-600"
          label="Busiest slot"
          value={busiestSlot}
        />
        <Callout
          Icon={Sun}
          iconBg="bg-blue-100 text-blue-600"
          label="Busiest hour · busiest day"
          value={busiestHour}
        />
        <Callout
          Icon={Moon}
          iconBg="bg-emerald-100 text-emerald-600"
          label="Quietest working hour"
          value={quietestWorking}
        />
      </div>

      <div className="mt-5 overflow-x-auto">
        <div className="inline-block min-w-full">
          {/* Hour axis */}
          <div className="grid" style={{ gridTemplateColumns: '48px repeat(13, minmax(32px, 1fr))' }}>
            <div />
            {HOURS.map((h) => (
              <div key={h} className="text-[10px] font-medium text-slate-500 text-center pb-1.5">
                {h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`}
              </div>
            ))}
          </div>

          {DAYS.map((d) => (
            <div key={d} className="grid items-center" style={{ gridTemplateColumns: '48px repeat(13, minmax(32px, 1fr))' }}>
              <div className="text-xs font-medium text-slate-600 pr-2 text-right py-0.5">{d}</div>
              {HOURS.map((h) => {
                const v = lookup.get(`${d}-${h}`) || 0;
                const ratio = Math.min(1, v / maxPerSlot);
                const bg = ratioToBlue(ratio);
                const isHovered = tooltip?.day === d && tooltip?.hour === h;
                return (
                  <div
                    key={h}
                    onMouseEnter={(e) => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setTooltip({
                        x: rect.right + 8,
                        y: rect.bottom + 4,
                        day: d,
                        hour: h,
                        value: v,
                      });
                    }}
                    onMouseLeave={() => setTooltip(null)}
                    className={
                      'h-8 rounded-md m-[2px] cursor-pointer transition-colors ' +
                      (isHovered ? 'ring-2 ring-slate-900' : '')
                    }
                    style={{ background: bg }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3 text-[10px] text-slate-500">
        <span>Fewer</span>
        {[0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1.0].map((r, i) => (
          <span key={i} className="h-3 w-5 rounded" style={{ background: ratioToBlue(r) }} />
        ))}
        <span>More · up to {maxPerSlot} bookings per slot</span>
      </div>

      {tooltip && (
        <div
          className="fixed bg-slate-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl pointer-events-none z-50 whitespace-nowrap"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div className="font-semibold">
            {tooltip.day} {formatHour(tooltip.hour)}–{formatHour(tooltip.hour + 1)}
          </div>
          <div className="text-slate-300">{tooltip.value} bookings</div>
        </div>
      )}
    </div>
  );
}

function Callout({
  Icon,
  iconBg,
  label,
  value,
}: {
  Icon: React.ElementType;
  iconBg: string;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg bg-slate-50 border border-slate-200/70 p-3 flex items-center gap-3">
      <div className={`h-9 w-9 rounded-lg ${iconBg} flex items-center justify-center shrink-0`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="text-[11px] text-slate-500 leading-tight">{label}</div>
        <div className="text-sm font-semibold text-slate-900 truncate">{value}</div>
      </div>
    </div>
  );
}

function formatHour(h: number): string {
  return `${h.toString().padStart(2, '0')}:00`;
}

/**
 * Map 0..1 ratio to a shade of blue matching the heatmap style
 * (very light = few bookings; dark navy = many).
 */
function ratioToBlue(ratio: number): string {
  const steps = ['#eff6ff','#dbeafe','#bfdbfe','#93c5fd','#60a5fa','#3b82f6','#2563eb','#1e40af','#1e3a8a'];
  const idx = Math.round(ratio * (steps.length - 1));
  return steps[idx];
}
