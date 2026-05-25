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

  // Bar chart: facility name + percent of today's open hours that are booked.
  const barData = per_facility.map((f) => ({
    name: f.name,
    utilization: f.today_open_minutes > 0
      ? Math.round((f.today_booked_minutes / f.today_open_minutes) * 100)
      : 0,
  }));

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

      {/* ---- utilization bar chart ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">
            Today's utilization (% of open hours booked)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {per_facility.length === 0 ? (
            <EmptyHint label="No active facilities yet." />
          ) : (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData} margin={{ top: 10, right: 16, left: 0, bottom: 24 }}>
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 12 }}
                    angle={-20}
                    textAnchor="end"
                    interval={0}
                    height={60}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fontSize: 12 }}
                    tickFormatter={(v: number) => v + '%'}
                  />
                  <Tooltip formatter={(v: number) => v + '%'} />
                  <Bar dataKey="utilization" fill={OCCUPIED_BLUE} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---- per-facility pies ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Per-facility today</CardTitle>
        </CardHeader>
        <CardContent>
          {per_facility.length === 0 ? (
            <EmptyHint label="Add a facility to see per-facility breakdown." />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {per_facility.map((f) => <FacilityPie key={f.id} facility={f} />)}
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

function FacilityPie({ facility }: { facility: DashboardFacility }) {
  const open = Math.max(0, facility.today_open_minutes);
  const booked = Math.max(0, Math.min(facility.today_booked_minutes, open));
  const free = Math.max(0, open - booked);
  const pct = open > 0 ? Math.round((booked / open) * 100) : 0;

  // When the facility is closed today (no operating hours), show a neutral
  // grey ring so the card doesn't look broken.
  const showEmpty = open === 0;
  const pieData = showEmpty
    ? [{ name: 'Closed today', value: 1 }]
    : [
        { name: 'Booked', value: booked },
        { name: 'Free',   value: free },
      ];

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-1">
          <div className="min-w-0">
            <div className="font-semibold truncate" title={facility.name}>{facility.name}</div>
            <div className="text-xs text-muted-foreground">{facility.type.replace('_', ' ')}</div>
          </div>
          {facility.occupied_now ? (
            <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-700">
              occupied
            </span>
          ) : (
            <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700">
              free
            </span>
          )}
        </div>

        <div className="h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                innerRadius={45}
                outerRadius={70}
                paddingAngle={2}
                stroke="none"
                isAnimationActive={false}
              >
                {/* Recharts iterates direct children - do NOT wrap Cells in
                    a React Fragment (it sees just the Fragment and falls
                    back to default greys). Render the colors via .map(). */}
                {showEmpty
                  ? <Cell key="closed" fill={FREE_GRAY} />
                  : [OCCUPIED_BLUE, FREE_GREEN].map((c, i) => (
                      <Cell key={i} fill={c} />
                    ))}
              </Pie>
              {!showEmpty && (
                <Tooltip
                  formatter={(v: number, n: string) =>
                    [fmtMinutes(v), n] as [string, string]
                  }
                />
              )}
              {!showEmpty && (
                <Legend
                  verticalAlign="bottom"
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 12 }}
                />
              )}
            </PieChart>
          </ResponsiveContainer>
        </div>

        {showEmpty ? (
          <div className="text-center text-xs text-muted-foreground mt-1">
            Closed today
          </div>
        ) : (
          <div className="text-center mt-1">
            <span className="text-2xl font-bold text-brand-navy">{pct}%</span>
            <span className="text-xs text-muted-foreground ml-2">
              ({fmtMinutes(booked)} of {fmtMinutes(open)})
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyHint({ label }: { label: string }) {
  return <div className="text-center py-6 text-sm text-muted-foreground">{label}</div>;
}
