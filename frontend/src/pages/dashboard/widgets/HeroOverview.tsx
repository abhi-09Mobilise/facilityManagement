// Top hero card — dark teal gradient, "Facility booking overview".
// Shows live clock, site filter dropdown, range toggle (7/30/90 days), and
// right-side circular occupancy gauge + 3-line status breakdown.

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { getHeroOverview, SAMPLE_DATA_BANNER } from '../sampleData';

export function HeroOverview() {
  const data = getHeroOverview();
  const [range, setRange] = useState<7 | 30 | 90>(data.rangeDays);
  const [siteOpen, setSiteOpen] = useState(false);

  // Circular gauge calculation.
  const R = 68;
  const CIRC = 2 * Math.PI * R;
  const dash = (data.occupiedPercent / 100) * CIRC;

  return (
    <div className="relative overflow-hidden rounded-2xl p-6 md:p-8 bg-gradient-to-br from-emerald-900 via-teal-800 to-emerald-700 text-white shadow-lg">
      {/* subtle grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.08] pointer-events-none"
        style={{
          backgroundImage: 'linear-gradient(white 1px, transparent 1px), linear-gradient(90deg, white 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />

      <div className="relative flex flex-col lg:flex-row gap-6 lg:gap-10 lg:items-center justify-between">
        {/* Left: title + filters */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap text-xs">
            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-100">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 animate-pulse" />
              Live
            </span>
            <span className="text-emerald-100/80">{data.nowLabel}</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-400/20 text-amber-100 border border-amber-300/30 text-[10px] font-semibold tracking-wide">
              {SAMPLE_DATA_BANNER}
            </span>
          </div>

          <h1 className="mt-3 text-3xl md:text-4xl font-bold tracking-tight">
            Facility booking overview
          </h1>
          <p className="mt-1 text-sm text-emerald-100/80">
            {data.summary}
          </p>

          <div className="mt-5 flex items-center gap-3 flex-wrap">
            {/* Site filter — purely visual placeholder */}
            <button
              type="button"
              onClick={() => setSiteOpen((v) => !v)}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-sm backdrop-blur-sm border border-white/10"
            >
              {data.siteFilter}
              <ChevronDown className="h-4 w-4 opacity-70" />
            </button>

            {/* Range toggle */}
            <div className="inline-flex rounded-lg bg-white/10 p-1 text-sm border border-white/10">
              {[7, 30, 90].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRange(n as 7 | 30 | 90)}
                  className={
                    'px-3 py-1 rounded-md transition-colors ' +
                    (range === n ? 'bg-white text-emerald-900 font-semibold' : 'text-emerald-100 hover:bg-white/10')
                  }
                >
                  {n} days
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right: circular gauge + legend */}
        <div className="flex items-center gap-6 shrink-0">
          <div className="relative h-40 w-40 md:h-44 md:w-44">
            <svg viewBox="0 0 160 160" className="w-full h-full -rotate-90">
              <circle cx="80" cy="80" r={R} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="12" />
              <circle
                cx="80" cy="80" r={R} fill="none"
                stroke="#5eead4"
                strokeWidth="12"
                strokeLinecap="round"
                strokeDasharray={`${dash} ${CIRC - dash}`}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-3xl font-bold">{data.occupiedPercent}%</div>
              <div className="text-[11px] text-emerald-100/80 mt-0.5">occupied now</div>
            </div>
          </div>

          <div className="flex flex-col gap-3 text-sm min-w-[160px]">
            <StatRow dotColor="#fb923c" count={data.inUseNow} label="In use right now" />
            <StatRow dotColor="#60a5fa" count={data.startingWithin30Min} label="Starting within 30 min" />
            <StatRow dotColor="#34d399" count={data.availableToBook} label="Available to book" />
          </div>
        </div>
      </div>
    </div>
  );
}

function StatRow({ dotColor, count, label }: { dotColor: string; count: number; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: dotColor }} />
      <span className="text-2xl font-bold w-8 text-right">{count}</span>
      <span className="text-emerald-100/80 text-xs">{label}</span>
    </div>
  );
}
