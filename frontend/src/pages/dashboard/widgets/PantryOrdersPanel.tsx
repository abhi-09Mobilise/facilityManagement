// Pantry orders summary: 4 KPI tiles (created / delivered / in progress /
// avg delivery), a daily bar chart, and the top-ordered items list.

import { Coffee } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { getPantryOrders, type PantryOrdersData } from '../sampleData';
import { useChartColors } from './useChartColors';

interface Props {
  // Live data from dashboardsApi.pantryOrders(). When present and the
  // backend reports at least one order, replaces the mock set. Delivery
  // lifecycle fields (delivered / inProgress / avgDeliveryMin) are
  // nullable — the KPI tiles render "—" for null values.
  liveOverlay?: PantryOrdersData | null;
}

export function PantryOrdersPanel({ liveOverlay }: Props = {}) {
  const data = getPantryOrders(liveOverlay);
  const cc = useChartColors();

  return (
    <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200/70 dark:border-slate-700/70 shadow-sm p-5">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-lg bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400 flex items-center justify-center shrink-0">
          <Coffee className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Pantry orders</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">Ordered by scanning the facility QR</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <KpiMini label="Orders created"  value={data.created.toLocaleString()}                                   bg="bg-rose-50 dark:bg-rose-950/40"    valueColor="text-slate-900 dark:text-slate-100" />
        <KpiMini label="Delivered"       value={data.delivered   == null ? '—' : data.delivered.toLocaleString()} bg="bg-emerald-50 dark:bg-emerald-950/40" valueColor={data.delivered   == null ? 'text-slate-400 dark:text-slate-500' : 'text-slate-900 dark:text-slate-100'} />
        <KpiMini label="In progress now" value={data.inProgress  == null ? '—' : data.inProgress.toLocaleString()} bg="bg-blue-50 dark:bg-blue-950/40"    valueColor={data.inProgress  == null ? 'text-slate-400 dark:text-slate-500' : 'text-slate-900 dark:text-slate-100'} />
        <KpiMini label="Avg. delivery"   value={data.avgDeliveryMin == null ? '—' : `${data.avgDeliveryMin} min`}  bg="bg-amber-50 dark:bg-amber-950/40"   valueColor={data.avgDeliveryMin == null ? 'text-slate-400 dark:text-slate-500' : 'text-slate-900 dark:text-slate-100'} />
      </div>

      <div className="mt-5 h-40">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.daily} margin={{ top: 0, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={cc.grid} vertical={false} />
            <XAxis dataKey="day" tick={{ fontSize: 10, fill: cc.tick }} tickLine={false} axisLine={false} interval={6} />
            <YAxis tick={{ fontSize: 10, fill: cc.tick }} tickLine={false} axisLine={false} width={24} />
            <Tooltip
              contentStyle={{ borderRadius: 8, fontSize: 12, border: `1px solid ${cc.grid}`, backgroundColor: cc.tooltipBg, color: cc.tooltipText }}
              labelStyle={{ color: cc.tooltipText }}
              itemStyle={{ color: cc.tooltipText }}
              cursor={{ fill: '#fed7aa', fillOpacity: 0.3 }}
            />
            <Bar dataKey="orders" fill="#f97316" radius={[4, 4, 0, 0]} barSize={10} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-5">
        <div className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-2.5">
          Most ordered items
        </div>
        <ul className="space-y-2.5">
          {data.topItems.map((item) => (
            <li key={item.name}>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-700 dark:text-slate-300">{item.name}</span>
                <span className="font-semibold text-slate-900 dark:text-slate-100">{item.orders}</span>
              </div>
              <div className="mt-1 h-1 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(item.orders / data.topItems[0].orders) * 100}%`,
                    background: item.color,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function KpiMini({ label, value, bg, valueColor }: { label: string; value: string; bg: string; valueColor: string }) {
  return (
    <div className={`rounded-lg ${bg} p-3`}>
      <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${valueColor}`}>{value}</div>
    </div>
  );
}
