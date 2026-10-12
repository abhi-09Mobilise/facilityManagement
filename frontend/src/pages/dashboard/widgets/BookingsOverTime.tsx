// Stacked area chart: bookings made vs check-ins completed, per day.
// Below the chart: 4 summary stat tiles (Checked in, Cancelled, No-shows, Busiest day).

import { Activity } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { getBookingsOverTime } from '../sampleData';

export function BookingsOverTime() {
  const { series, summary } = getBookingsOverTime();

  return (
    <div className="rounded-2xl bg-white border border-slate-200/70 shadow-sm p-5 h-full flex flex-col">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">Bookings over time</h3>
            <p className="text-xs text-slate-500">Bookings made vs. check-ins completed, per day</p>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs">
          <LegendDot color="#3b82f6" label="Bookings" />
          <LegendDot color="#10b981" label="Check-ins" />
        </div>
      </div>

      {/* Summary stat tiles */}
      <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile value={summary.checkedIn.toLocaleString()} label="Checked in" />
        <StatTile value={summary.cancelled.toLocaleString()} label="Cancelled" />
        <StatTile value={summary.noShows.toLocaleString()} label="No-shows (auto-released)" />
        <StatTile value={summary.busiest.count.toLocaleString()} label={`Busiest day · ${summary.busiest.day}`} />
      </div>

      <div className="mt-4 flex-1 min-h-[16rem]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="g-bookings" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="g-checkins" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis
              dataKey="day"
              tick={{ fontSize: 10, fill: '#64748b' }}
              tickLine={false}
              axisLine={false}
              interval={2}
            />
            <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} width={28} />
            <Tooltip
              contentStyle={{
                borderRadius: 8,
                border: 'none',
                backgroundColor: '#1e293b',
                padding: '8px 12px',
                fontSize: 12,
              }}
              labelStyle={{ color: '#f8fafc', fontWeight: 600, marginBottom: 4 }}
              itemStyle={{ padding: 0 }}
              separator=": "
              cursor={{ stroke: '#cbd5e1', strokeDasharray: '3 3' }}
            />
            <Area name="Bookings"  type="monotone" dataKey="bookings" stroke="#3b82f6" strokeWidth={2} fill="url(#g-bookings)" />
            <Area name="Check-ins" type="monotone" dataKey="checkins" stroke="#10b981" strokeWidth={2} fill="url(#g-checkins)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-slate-600">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg bg-slate-50 border border-slate-200/50 p-3">
      <div className="text-xl font-bold text-slate-900">{value}</div>
      <div className="text-[11px] text-slate-500 mt-0.5 leading-tight">{label}</div>
    </div>
  );
}
