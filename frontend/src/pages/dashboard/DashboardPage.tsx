// Tenant-admin dashboard.
//
// Three sections:
//   1. KPI tiles - Total facilities / Occupied now / Free now.
//   2. Today's utilization bar chart - one bar per facility, % booked.
//   3. Per-facility pies - booked vs free minutes today.
//
// Backed by /api/dashboards/tenant-admin. Refresh button re-fetches.

import { useEffect, useState } from 'react';
import {
  Loader2, RefreshCw, Building, Activity, CheckCircle2,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { dashboardsApi, type DashboardPayload, type DashboardFacility } from '@/api/dashboards.api';
import type { FacilityType } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import GanttTimeline from './components/GanttTimeline'; // F08

const NAVY = '#1a3a6e';
const OCCUPIED_BLUE = '#2563eb'; // tailwind blue-600 - pops on small pies
const NAVY_LIGHT = '#6b8bbf';
const FREE_GREEN = '#10b981'; // tailwind emerald-500
const FREE_GRAY  = '#e5e7eb'; // used only for the "Closed today" state

function fmtPct(numerator: number, denominator: number): string {
  if (denominator <= 0) return '0%';
  return Math.round((numerator / denominator) * 100) + '%';
}

function fmtMinutes(m: number): string {
  if (m <= 0) return '0m';
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h === 0) return rem + 'm';
  if (rem === 0) return h + 'h';
  return h + 'h ' + rem + 'm';
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // F08
  const [tab, setTab] = useState<'overview' | 'timeline'>('overview');
  // Stacked-bar hover state: which specific segment is the cursor on?
  // Drives a custom Tooltip content renderer that shows ONLY that segment,
  // not the whole stack's payload (Recharts' default).
  const [hovered, setHovered] = useState<{
    type: string; key: string; name: string; value: number; color: string;
  } | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await dashboardsApi.tenantAdmin();
      if (r.status && r.data) setData(r.data);
      else setError(r.msg || 'Failed to load dashboard');
    } catch (e: unknown) {
      setError((e as { response?: { data?: { msg?: string } } })?.response?.data?.msg
        || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-brand-navy" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="max-w-xl mx-auto mt-12">
        <Card>
          <CardContent className="p-6">
            <p className="text-destructive">{error || 'No data'}</p>
            <Button onClick={load} variant="outline" className="mt-4">
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { summary, per_facility, as_of } = data;

  // Stacked bar chart: one bar per facility *type*, stacked by individual
  // facility. Each segment height = that facility's booked minutes today.
  // Lets the admin see at a glance which specific facility is pulling the
  // weight in each type ("Gyms total 240 min, of which Cardio = 180").
  //
  // Y-axis is in minutes (concrete) rather than a percentage — % per
  // facility doesn't sum meaningfully when stacked.
  const TYPE_DISPLAY_ORDER: FacilityType[] = [
    'meeting_room', 'conference_room', 'gym', 'desk', 'swimming_pool', 'other',
  ];
  const TYPE_LABEL_BAR: Record<FacilityType, string> = {
    meeting_room: 'Meeting rooms', conference_room: 'Conference rooms',
    gym: 'Gyms', desk: 'Desks', swimming_pool: 'Swimming pools', other: 'Other',
  };
  // Stable palette of distinct hues. We cycle through if a single type
  // has more facilities than the palette length.
  const FACILITY_PALETTE = [
    '#2563eb', '#16a34a', '#f97316', '#a855f7', '#ec4899',
    '#0ea5e9', '#dc2626', '#14b8a6', '#ca8a04', '#6366f1',
    '#84cc16', '#f43f5e', '#06b6d4', '#d97706',
  ];

  // Bucket facilities by type, then pivot so each bar (= type) has one
  // numeric key per facility. Missing keys render no segment.
  const buckets = new Map<FacilityType, typeof per_facility>();
  for (const f of per_facility) {
    const t = (f.type || 'other') as FacilityType;
    if (!buckets.has(t)) buckets.set(t, []);
    buckets.get(t)!.push(f);
  }
  // Per-facility colour map (stable across renders so the same chart
  // colour follows the same facility across reloads in the same session).
  const facilityColors: Record<string, string> = {};
  // List of facility keys we need to render as <Bar> elements, in stack
  // order (so tooltips read top-to-bottom in a sensible order too).
  const facilityKeys: { key: string; name: string; type: FacilityType }[] = [];
  let colorIdx = 0;
  for (const t of TYPE_DISPLAY_ORDER) {
    const list = buckets.get(t);
    if (!list) continue;
    for (const f of list) {
      const key = 'f-' + f.id;
      facilityKeys.push({ key, name: f.name, type: t });
      facilityColors[key] = FACILITY_PALETTE[colorIdx % FACILITY_PALETTE.length];
      colorIdx++;
    }
  }
  // One row per type, containing each facility's booked_minutes as a
  // separate numeric column. Recharts stacks them with `stackId="util"`.
  const barData = TYPE_DISPLAY_ORDER.flatMap((t) => {
    const list = buckets.get(t);
    if (!list) return [];
    const row: Record<string, number | string> = {
      type: TYPE_LABEL_BAR[t] || t,
    };
    for (const f of list) {
      row['f-' + f.id] = Math.max(0, f.today_booked_minutes || 0);
    }
    return [row];
  });
  // For each type, find the last facility-key that actually has a non-zero
  // value — that's the topmost visible segment of its stack and gets the
  // rounded corners. Doing it per-row beats relying on Recharts' default
  // "round only the last Bar component" behaviour, which often misses when
  // the literal-last facility happens to be empty for a type.
  const topMostByType = new Map<string, string>();
  for (const row of barData) {
    let topKey = '';
    for (const fk of facilityKeys) {
      const v = Number(row[fk.key]) || 0;
      if (v > 0) topKey = fk.key;
    }
    if (topKey) topMostByType.set(String(row.type), topKey);
  }

  return (
    <div className="space-y-6 max-w-7xl">
      {/* ---- header ---- */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-brand-navy">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Live snapshot of facility utilization &middot; updated {new Date(as_of).toLocaleTimeString()}
          </p>
        </div>
        <Button onClick={load} variant="outline" size="sm">
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* F08 - Tabs */}
      <div className="tabs-bar mb-4">
        <button onClick={() => setTab('overview')} className={tab === 'overview' ? 'tab-btn-active' : 'tab-btn'}>Overview</button>
        <button onClick={() => setTab('timeline')} className={tab === 'timeline' ? 'tab-btn-active' : 'tab-btn'}>Timeline</button>
      </div>

      {tab === 'timeline' ? <GanttTimeline /> : (<>

      {/* ---- KPI tiles ---- */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiTile
          icon={<Building className="h-5 w-5" />}
          label="Total facilities"
          value={summary.total_facilities}
          accent="navy"
        />
        <KpiTile
          icon={<Activity className="h-5 w-5" />}
          label="Occupied right now"
          value={summary.occupied_now}
          accent="warning"
          sub={fmtPct(summary.occupied_now, summary.total_facilities) + ' of all facilities'}
        />
        <KpiTile
          icon={<CheckCircle2 className="h-5 w-5" />}
          label="Free right now"
          value={summary.free_now}
          accent="success"
        />
      </div>

      {/* ---- utilization bar chart (stacked by facility within each type) ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">
            Today's utilization by facility type
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Each bar = one type. Each segment = one facility's booked minutes today.
          </p>
        </CardHeader>
        <CardContent>
          {per_facility.length === 0 ? (
            <EmptyHint label="No active facilities yet." />
          ) : (
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={barData}
                  margin={{ top: 10, right: 16, left: 0, bottom: 24 }}
                  // Cap bar width so a chart with only 2-3 types doesn't get
                  // chunky landscape-width bars. Recharts shrinks below this
                  // if the chart is narrow.
                  barCategoryGap="25%"
                >
                  <XAxis
                    dataKey="type"
                    tick={{ fontSize: 12 }}
                    interval={0}
                    height={40}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    tickFormatter={(v: number) => fmtMinutes(v)}
                    axisLine={false}
                    tickLine={false}
                  />
                  {/* Custom tooltip content: only renders the segment under
                      the cursor (driven by `hovered` state). When nothing
                      is hovered the tooltip is empty / invisible. */}
                  <Tooltip
                    cursor={{ fill: 'rgba(15, 23, 42, 0.04)' }}
                    content={() => {
                      if (!hovered) return null;
                      return (
                        <div style={{
                          background: 'white',
                          border: '1px solid #e5e7eb',
                          borderRadius: 8,
                          boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                          padding: '8px 12px',
                          minWidth: 160,
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{
                              width: 10, height: 10, borderRadius: 2,
                              background: hovered.color,
                              flexShrink: 0,
                            }} />
                            <strong style={{ fontSize: 13 }}>{hovered.name}</strong>
                          </div>
                          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                            {hovered.type}
                          </div>
                          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 6 }}>
                            {fmtMinutes(hovered.value)} booked today
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Legend
                    verticalAlign="bottom"
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                    formatter={(value: string) => {
                      const fk = facilityKeys.find((k) => k.key === value);
                      return fk?.name || value;
                    }}
                  />
                  {facilityKeys.map(({ key, name }) => (
                    <Bar
                      key={key}
                      dataKey={key}
                      stackId="util"
                      fill={facilityColors[key]}
                      // White stroke separates stacked segments so they read
                      // as distinct facilities even when the colours are
                      // similar in tone.
                      stroke="#ffffff"
                      strokeWidth={2}
                      // Round corners only when this facility is the
                      // top-most non-zero segment of its bar (i.e. crowns
                      // the stack for THIS type). Cell-level radius keeps
                      // the cap on the actual bar top regardless of which
                      // Bar component is drawing last in the stack.
                      shape={(props: unknown) => {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const p = props as any;
                        const isTop = topMostByType.get(String(p.payload?.type)) === key;
                        const radius = isTop ? 'M' +
                          (p.x) + ',' + (p.y + 8) +
                          ' a 8,8 0 0 1 8,-8 h ' + (p.width - 16) +
                          ' a 8,8 0 0 1 8,8 v ' + (p.height - 8) +
                          ' h ' + (-p.width) + ' z'
                          : 'M' + p.x + ',' + p.y +
                            ' h ' + p.width +
                            ' v ' + p.height +
                            ' h ' + (-p.width) + ' z';
                        return (
                          <path d={radius} fill={p.fill} stroke="#ffffff" strokeWidth={2} />
                        );
                      }}
                      onMouseEnter={(data: unknown) => {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const d = data as any;
                        setHovered({
                          type: String(d.type || ''),
                          key,
                          name,
                          value: Number(d[key]) || 0,
                          color: facilityColors[key],
                        });
                      }}
                      onMouseLeave={() => setHovered(null)}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      </>)}  {/* F08 - end overview tab */}
    </div>
  );
}

// --------- helpers ---------

function KpiTile({ icon, label, value, sub, accent }: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  sub?: string;
  accent: 'navy' | 'warning' | 'success';
}) {
  const border = {
    navy:    'border-l-brand-navy',
    warning: 'border-l-amber-500',
    success: 'border-l-emerald-500',
  }[accent];
  const iconBg = {
    navy:    'bg-brand-navy-soft text-brand-navy',
    warning: 'bg-amber-100 text-amber-700',
    success: 'bg-emerald-100 text-emerald-700',
  }[accent];
  return (
    <Card className={cn('border-l-4', border)}>
      <CardContent className="p-5 flex items-start gap-4">
        <div className={cn('h-10 w-10 rounded-md flex items-center justify-center shrink-0', iconBg)}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
            {label}
          </div>
          <div className="text-3xl font-bold mt-0.5">{value}</div>
          {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyHint({ label }: { label: string }) {
  return <div className="text-center py-6 text-sm text-muted-foreground">{label}</div>;
}

void NAVY;
void OCCUPIED_BLUE;
void NAVY_LIGHT;
void FREE_GREEN;
void FREE_GRAY;
void Cell;
void Pie;
void PieChart;
void Legend;

ieChart;
void Legend;
