// Donut chart showing how users booked (QR walk-in / Mobile app / Web portal
// / Door tablet) with 4 small tiles below listing exact counts + percentages.

import { Clock, QrCode, Smartphone, Monitor, Tablet } from 'lucide-react';
import { ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { getBookingChannel, type ChannelSlice } from '../sampleData';

const channelIcon: Record<string, React.ElementType> = {
  'QR walk-in':  QrCode,
  'Mobile app':  Smartphone,
  'Web portal':  Monitor,
  'Door tablet': Tablet,
};

const channelBg: Record<string, string> = {
  'QR walk-in':  'bg-violet-50 dark:bg-violet-950/40 text-[#8b5cf6]',
  'Mobile app':  'bg-blue-50 dark:bg-blue-950/40',
  'Web portal':  'bg-emerald-50 dark:bg-emerald-950/40',
  'Door tablet': 'bg-amber-50 dark:bg-amber-950/40',
};

interface Props {
  // Backend returns full 4-slice donut; when total === 0 the hook passes
  // null so we fall back to the mock donut (empty circle looks weird).
  liveOverlay?: { slices: ChannelSlice[]; total: number } | null;
}

export function BookingChannel({ liveOverlay }: Props = {}) {
  const { slices, total } = getBookingChannel(liveOverlay);

  return (
    <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200/70 dark:border-slate-700/70 shadow-sm p-5 h-full flex flex-col">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-lg bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400 flex items-center justify-center shrink-0">
          <Clock className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Booking channel</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">How users booked their slot</p>
        </div>
      </div>

      {/* [&_*]:focus:outline-none kills the browser default focus rect that
          recharts' SVG elements show on click/tab — matches the clean
          look of the other charts in the dashboard. */}
      <div className="relative mt-4 mx-auto [&_*]:focus:outline-none" style={{ width: 200, height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              cx="50%" cy="50%"
              innerRadius={62} outerRadius={92}
              paddingAngle={3}
              dataKey="value"
              stroke="none"
              isAnimationActive={false}
            >
              {slices.map((s) => (
                <Cell key={s.name} fill={s.color} tabIndex={-1} style={{ outline: 'none' }} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">{total.toLocaleString()}</div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 -mt-0.5">total bookings</div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        {slices.map((s) => <ChannelTile key={s.name} slice={s} total={total} />)}
      </div>
    </div>
  );
}

function ChannelTile({ slice, total }: { slice: ChannelSlice; total: number }) {
  const Icon = channelIcon[slice.name] ?? QrCode;
  const bg = channelBg[slice.name] ?? 'bg-slate-50 dark:bg-slate-800';
  const pct = Math.round((slice.value / total) * 100);
  return (
    <div className="rounded-lg border border-slate-200/50 dark:border-slate-700/50 p-2.5 flex items-start gap-2">
      <div className={`h-7 w-7 rounded-md ${bg} flex items-center justify-center shrink-0`} style={{ color: slice.color }}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{slice.name}</div>
        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{slice.value.toLocaleString()}</div>
        <div className="text-[10px] text-slate-400 dark:text-slate-500">{pct}%</div>
      </div>
    </div>
  );
}
