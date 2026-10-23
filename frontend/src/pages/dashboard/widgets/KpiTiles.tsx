// 5 KPI cards shown directly below the hero. Each card has: title, icon,
// big number, secondary subtitle (optional trend chip), and a sparkline.

import { Building2, DoorOpen, CalendarDays, Star, Coffee, TrendingUp, TrendingDown, Fingerprint } from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer, YAxis } from 'recharts';
import { getKpiTiles, type KpiTile } from '../sampleData';
import { useThemeMode } from '@/context/ThemeContext';

// Turn a label like "Bookings · 30 days" into a safe SVG id fragment.
// url(#...) refs break if the id contains spaces or non-ascii characters,
// which is why the gradient-fill was rendering as a dark fallback.
function slug(label: string): string {
  return label.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const iconFor: Record<string, { Icon: React.ElementType; bg: string; fg: string }> = {
  'Total facilities':       { Icon: Building2,    bg: 'bg-blue-50 dark:bg-blue-950/40',   fg: 'text-blue-600 dark:text-blue-400' },
  'Booked today':           { Icon: DoorOpen,     bg: 'bg-orange-50 dark:bg-orange-950/40', fg: 'text-orange-600 dark:text-orange-400' },
  'Bookings · 30 days':     { Icon: CalendarDays, bg: 'bg-emerald-50 dark:bg-emerald-950/40',fg: 'text-emerald-600 dark:text-emerald-400' },
  'Average feedback':       { Icon: Star,         bg: 'bg-amber-50 dark:bg-amber-950/40',  fg: 'text-amber-600 dark:text-amber-400' },
  'Pantry orders':          { Icon: Coffee,       bg: 'bg-rose-50 dark:bg-rose-950/40',   fg: 'text-rose-600 dark:text-rose-400' },
  'Biometric mismatches':   { Icon: Fingerprint,  bg: 'bg-slate-100 dark:bg-slate-800', fg: 'text-slate-500 dark:text-slate-400' },
};

const sparkColorFor: Record<string, string> = {
  'Total facilities':       '#2563eb',
  'Booked today':           '#f97316',
  'Bookings · 30 days':     '#10b981',
  'Average feedback':       '#f59e0b',
  'Pantry orders':          '#f43f5e',
};

interface KpiTilesProps {
  // Overlay keyed by tile label. Any field present here overrides the
  // mock value for that specific tile (e.g. live `summary.total_facilities`
  // from dashboardsApi overrides the sample '48'). Missing labels fall
  // back to sample values.
  liveOverlay?: Record<string, Partial<KpiTile>>;
  // Called when a drilldown-enabled tile is clicked. Only the labels listed
  // in CLICKABLE_LABELS are wired up — everything else stays non-interactive
  // so we don't fake a drill-down the page can't service.
  onTileClick?: (label: string) => void;
}

// Tiles that have a drilldown panel. Non-matching labels render as static.
const CLICKABLE_LABELS = new Set<string>(['Booked today']);

export function KpiTiles({ liveOverlay, onTileClick }: KpiTilesProps = {}) {
  const tiles = getKpiTiles(liveOverlay);
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {tiles.map((t) => (
        <Tile
          key={t.label}
          tile={t}
          onClick={
            onTileClick && CLICKABLE_LABELS.has(t.label)
              ? () => onTileClick(t.label)
              : undefined
          }
        />
      ))}
    </div>
  );
}

function Tile({ tile, onClick }: { tile: KpiTile; onClick?: () => void }) {
  const { Icon, bg, fg } = iconFor[tile.label] ?? { Icon: Building2, bg: 'bg-slate-50 dark:bg-slate-800', fg: 'text-slate-600 dark:text-slate-400' };
  const sparkColor = sparkColorFor[tile.label] ?? '#64748b';
  const { mode } = useThemeMode();
  const dotStroke = mode === 'dark' ? '#141E2E' : 'white';
  const sparkData = tile.spark.map((v, i) => ({ i, v }));
  const gradientId = `spark-${slug(tile.label)}`;
  const lastIndex = sparkData.length - 1;

  // Force every sparkline into the BOTTOM THIRD of its 48px container.
  //
  // The dashboard reads "upar tange huye" when the final point of a
  // monotonically-increasing sparkline (Booked right now 10→28, Average
  // feedback 3.9→4.2) ends up near the top of the drawing area under
  // normal auto-scaling. Adding 2x the data range as headroom above the
  // actual max squeezes the visible data into the bottom ~33% of the
  // chart — so every line (regardless of trend) ends in the same low
  // band and the row of tiles looks uniformly aligned.
  const minVal = Math.min(...tile.spark);
  const maxVal = Math.max(...tile.spark);
  const range = maxVal - minVal || 1;
  const yDomain: [number, number] = [minVal, maxVal + range * 2];

  // Render a dot only on the final data point so every sparkline ends with
  // a visible marker (matches the reference). Recharts calls this per
  // point and expects a React element back — return an empty <g /> for
  // the ones we don't want to see.
  const endpointDot = (props: { cx?: number; cy?: number; index?: number }) => {
    if (props.index !== lastIndex || props.cx == null || props.cy == null) {
      return <g key={`spark-empty-${props.index}`} />;
    }
    return (
      <circle
        key={`spark-dot-${props.index}`}
        cx={props.cx}
        cy={props.cy}
        r={2.5}
        fill={sparkColor}
        stroke={dotStroke}
        strokeWidth={1.5}
      />
    );
  };

  // Capacity bar: for "Total facilities" we show a stacked site-mix bar as
  // the "spark" slot. Everything else uses an area/line sparkline.
  const isTotalFacilities = tile.label === 'Total facilities';

  const isClickable = typeof onClick === 'function';
  const interactiveClasses = isClickable
    ? 'cursor-pointer transition-shadow hover:shadow-md hover:border-slate-300 dark:hover:border-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500'
    : '';

  return (
    <div
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={isClickable ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); }
      } : undefined}
      className={`relative rounded-2xl bg-white dark:bg-slate-800 border border-slate-200/70 dark:border-slate-700/70 shadow-sm p-4 overflow-hidden flex flex-col ${interactiveClasses}`}
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{tile.label}</div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <div className={'text-3xl font-bold tracking-tight ' + (tile.valueMuted ? 'text-slate-400 dark:text-slate-500' : 'text-slate-900 dark:text-slate-100')}>{tile.value}</div>
            {tile.label === 'Average feedback' && <span className="text-slate-400 dark:text-slate-500 text-sm">/ 5</span>}
            {/* BUG-03 fix: denominator comes from the overlay's `max` (set to
                the real total-facilities count) instead of the hardcoded
                "/ 48". Hidden entirely when max is unknown. */}
            {tile.label === 'Booked today' && typeof tile.max === 'number' && (
              <span className="text-slate-400 dark:text-slate-500 text-sm">/ {tile.max}</span>
            )}
          </div>
        </div>
        <div className={`h-8 w-8 rounded-lg ${bg} ${fg} flex items-center justify-center shrink-0`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>

      {tile.trend && (
        <div className="mt-1.5 inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-semibold">
          {tile.trend.direction === 'up' ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {tile.trend.percent.toFixed(1)}%
        </div>
      )}

      {tile.secondary && (
        <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 leading-tight">{tile.secondary}</div>
      )}

      {/* Sparkline / mini-chart area at the bottom. mt-auto anchors every
          tile's chart to the card bottom so they all start at the same
          vertical position regardless of how tall the content above is
          (the "Bookings · 30 days" tile has an extra trend chip that was
          pushing its chart lower than the others). */}
      <div className="mt-auto h-12">
        {isTotalFacilities ? (
          <StackedSiteBar parts={tile.siteBreakdown} />
        ) : sparkData.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparkData} margin={{ top: 4, right: 6, bottom: 0, left: 2 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={sparkColor} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={sparkColor} stopOpacity={0.25} />
                </linearGradient>
              </defs>
              <YAxis hide domain={yDomain} />
              <Area type="monotone" dataKey="v" stroke={sparkColor} strokeWidth={2} fill={`url(#${gradientId})`} dot={endpointDot} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        ) : null}
      </div>
    </div>
  );
}

function StackedSiteBar({ parts }: { parts?: { name: string; count: number; color: string }[] }) {
  // BUG-03 fix: no more hardcoded "Mumbai 18 · Pune 14 · Bengaluru 16".
  // When the overlay doesn't supply a breakdown (loading / empty tenant),
  // render an empty bar + no label instead of fabricated numbers.
  const safe = Array.isArray(parts) ? parts.filter((p) => p && p.count > 0) : [];
  const total = safe.reduce((s, p) => s + p.count, 0);
  if (total === 0) {
    return (
      <div className="flex flex-col justify-end gap-1.5 h-full">
        <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800" />
      </div>
    );
  }
  // Only show the top 3 in the label line to keep the tile compact —
  // enough to communicate the mix without wrapping.
  const label = safe.slice(0, 3).map((p) => `${p.name} ${p.count}`).join(' · ');
  return (
    <div className="flex flex-col justify-end gap-1.5 h-full">
      <div className="flex h-2 w-full rounded-full overflow-hidden bg-slate-100 dark:bg-slate-800">
        {safe.map((p) => (
          <div key={p.name} style={{ width: `${(p.count / total) * 100}%`, background: p.color }} />
        ))}
      </div>
      <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight truncate">
        {label}
      </div>
    </div>
  );
}
