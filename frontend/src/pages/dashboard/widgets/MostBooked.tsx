// Horizontal bar chart: top 8 facilities by booking count. Toggle between
// per-facility and per-type grouping.

import { useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { getMostBooked, type MostBookedRow } from '../sampleData';
import { useChartColors } from './useChartColors';

interface Props {
  // Live top-N rows keyed by mode — the live hook aggregates the
  // gantt() items by facility and type.
  liveOverlay?: { facility: MostBookedRow[]; type: MostBookedRow[] } | null;
}

export function MostBooked({ liveOverlay }: Props = {}) {
  const [mode, setMode] = useState<'facility' | 'type'>('facility');
  const data = getMostBooked(mode, liveOverlay);
  const cc = useChartColors();

  return (
    <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200/70 dark:border-slate-700/70 shadow-sm p-5 h-[560px] flex flex-col">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-lg bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400 flex items-center justify-center shrink-0">
          <BarChart3 className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Most booked</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">Top 8 facilities by bookings</p>
        </div>
      </div>

      <div className="mt-4 self-start inline-flex rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 text-xs">
        <button
          type="button"
          onClick={() => setMode('facility')}
          className={'px-3 py-1 rounded-md transition-colors ' + (mode === 'facility' ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-semibold shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100')}
        >
          Facility
        </button>
        <button
          type="button"
          onClick={() => setMode('type')}
          className={'px-3 py-1 rounded-md transition-colors ' + (mode === 'type' ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-semibold shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100')}
        >
          Type
        </button>
      </div>

      <div className="mt-4 flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 24, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="g-mostBooked" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%"   stopColor="#3b82f6" />
                <stop offset="100%" stopColor="#6366f1" />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={cc.grid} horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10, fill: cc.tick }} tickLine={false} axisLine={false} />
            <YAxis
              type="category"
              dataKey="key"
              tick={{ fontSize: 11, fill: cc.tooltipText }}
              tickLine={false}
              axisLine={false}
              width={75}
            />
            <Tooltip
              contentStyle={{ borderRadius: 8, fontSize: 12, border: `1px solid ${cc.grid}`, backgroundColor: cc.tooltipBg, color: cc.tooltipText }}
              labelStyle={{ color: cc.tooltipText }}
              itemStyle={{ color: cc.tooltipText }}
              cursor={{ fill: cc.softBg }}
              formatter={(v: number) => [v.toLocaleString(), 'Bookings']}
            />
            <Bar dataKey="bookings" radius={[0, 6, 6, 0]} barSize={12} fill="url(#g-mostBooked)" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
