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
import { sitesApi } from '@/api/sites.api';
import { tenantsApi } from '@/api/tenants.api';
import { useAuth } from '@/context/AuthContext';
import type { FacilityType, Site, Tenant } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
// Lazy — moment + react-calendar-timeline only ship when the admin clicks
// the Timeline tab. Wrapped in Suspense at the usage site below.
import { lazy, Suspense } from 'react';
import PageSpinner from '@/components/PageSpinner';
const GanttTimeline = lazy(() => import('./components/GanttTimeline'));

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
  const { user } = useAuth();
  const isSuper = user?.role === 'super_admin';

  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // F08
  const [tab, setTab] = useState<'overview' | 'timeline'>('overview');
  // Stacked-bar hover state: which specific segment is the cursor on?
  const [hovered, setHovered] = useState<{
    type: string; key: string; name: string; value: number; color: string;
  } | null>(null);

  // Drill-down: null = type overview (one bar per facility type, max 6 bars).
  // Set to a FacilityType to switch to the detail chart showing every
  // individual facility of that type as its own bar. Far fewer SVG nodes
  // than the old single-stacked chart → no recharts jank.
  const [pickedType, setPickedType] = useState<FacilityType | null>(null);
  // hovered state from the old stacked-chart design is no longer wired into
  // any chart — kept declared above so a future hover-aware view can reuse it.
  void hovered;

  // Scope pickers.
  //   super_admin → pick one tenant (cross-tenant aggregate froze the screen
  //                 with 1000+ facilities).
  //   tenant_admin → optional site filter so we don't fetch every facility
  //                  across every site.
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [sites,   setSites]   = useState<Site[]>([]);
  const [tenantId, setTenantId] = useState<number | ''>('');
  const [siteId,   setSiteId]   = useState<number | ''>('');

  // Load tenant list once (super_admin only) and auto-pick the first.
  useEffect(() => {
    if (!isSuper) return;
    tenantsApi.list({ limit: 200 }).then((r) => {
      const list = (r.data?.data || []) as Tenant[];
      setTenants(list);
      if (list.length > 0 && tenantId === '') setTenantId(list[0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuper]);

  // Site list reacts to the active tenant (super_admin) or to the user's
  // own tenant scope (tenant_admin). Always re-fetch when the tenant changes.
  useEffect(() => {
    // tenant_admin → API uses their tenant_id from the JWT; no param needed.
    // super_admin → only meaningful once a tenant is picked.
    if (isSuper && !tenantId) { setSites([]); return; }
    sitesApi.list({ limit: 200 }).then((r) => {
      setSites((r.data?.data || []) as Site[]);
    });
  }, [isSuper, tenantId]);

  // Reset the site filter when the tenant switches (super_admin only).
  useEffect(() => { setSiteId(''); }, [tenantId]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params: { tenant_id?: number; site_id?: number; limit?: number } = { limit: 150 };
      if (isSuper && tenantId) params.tenant_id = tenantId;
      if (siteId) params.site_id = siteId;
      const r = await dashboardsApi.tenantAdmin(params);
      if (r.status && r.data) setData(r.data);
      else setError(r.msg || 'Failed to load dashboard');
    } catch (e: unknown) {
      setError((e as { response?: { data?: { msg?: string } } })?.response?.data?.msg
        || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }
  // Re-fetch whenever the scope changes. The picker is the throttle: nothing
  // loads until the super_admin has chosen a tenant.
  useEffect(() => {
    if (isSuper && !tenantId) {
      setData(null);
      setLoading(false);
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuper, tenantId, siteId]);

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

  // Drill-down model: overview shows one bar per facility *type* (max 6
  // bars total — fast and readable). Clicking a type bar switches to the
  // detail view showing each individual facility of that type. Neither
  // view stacks, neither view re-renders per mouse-move, so recharts has
  // no per-segment state to chew on.

  const TYPE_DISPLAY_ORDER: FacilityType[] = [
    'meeting_room', 'conference_room', 'gym', 'desk', 'swimming_pool', 'other',
  ];
  const TYPE_LABEL: Record<FacilityType, string> = {
    meeting_room: 'Meeting rooms', conference_room: 'Conference rooms',
    gym: 'Gyms', desk: 'Desks', swimming_pool: 'Swimming pools', other: 'Other',
  };
  const TYPE_COLOR: Record<FacilityType, string> = {
    meeting_room: '#2563eb', conference_room: '#6366f1',
    gym: '#f97316', desk: '#16a34a',
    swimming_pool: '#0ea5e9', other: '#94a3b8',
  };

  // Bucket facilities by type once.
  const buckets = new Map<FacilityType, typeof per_facility>();
  for (const f of per_facility) {
    const t = (f.type || 'other') as FacilityType;
    if (!buckets.has(t)) buckets.set(t, []);
    buckets.get(t)!.push(f);
  }

  // -- Overview rows: one per type with totals --
  const overviewData = TYPE_DISPLAY_ORDER
    .map((t) => {
      const list = buckets.get(t);
      if (!list || list.length === 0) return null;
      let booked = 0;
      let open = 0;
      for (const f of list) {
        booked += Math.max(0, f.today_booked_minutes || 0);
        open   += Math.max(0, f.today_open_minutes   || 0);
      }
      return {
        type: t,
        label: TYPE_LABEL[t] || t,
        booked,
        open,
        count: list.length,
        color: TYPE_COLOR[t] || '#94a3b8',
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  // -- Detail rows: one per facility within the picked type --
  // Colour each bar by utilisation %: low = green, mid = amber, high = red.
  // Same scale used in the Gantt heatmap so the visual language is consistent.
  function utilColor(pct: number): string {
    const p = Math.max(0, Math.min(1, pct));
    const hue   = 130 - p * 130;   // 130 (green) → 60 (yellow) → 0 (red)
    const sat   = 55 + p * 30;
    const light = 55 - p * 10;
    return 'hsl(' + hue.toFixed(0) + ', ' + sat.toFixed(0) + '%, ' + light.toFixed(0) + '%)';
  }
  const detailData = pickedType
    ? (buckets.get(pickedType) || []).map((f) => {
        const open   = Math.max(0, f.today_open_minutes   || 0);
        const booked = Math.max(0, Math.min(open || Infinity, f.today_booked_minutes || 0));
        const pct = open > 0 ? booked / open : 0;
        return {
          id: f.id,
          name: f.name,
          booked,
          open,
          pct,
          color: utilColor(pct),
        };
      }).sort((a, b) => b.booked - a.booked)
    : [];

  const hasAnyOverview = overviewData.some((r) => r.booked > 0);
  const hasAnyDetail = detailData.some((r) => r.booked > 0);

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

      {/* Scope pickers — drive the API params + throttle data fetching */}
      <div className="flex flex-wrap items-center gap-2">
        {isSuper && (
          <select
            className="h-9 rounded border border-input bg-background px-2 text-sm w-full sm:w-auto sm:min-w-[220px]"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">Pick a tenant…</option>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        <select
          className="h-9 rounded border border-input bg-background px-2 text-sm w-full sm:w-auto sm:min-w-[180px]"
          value={siteId}
          onChange={(e) => setSiteId(e.target.value ? Number(e.target.value) : '')}
          disabled={isSuper && !tenantId}
        >
          <option value="">All sites</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {isSuper && !tenantId && (
          <span className="text-xs text-muted-foreground">
            Pick a tenant to load its dashboard
          </span>
        )}
      </div>

      {/* F08 - Tabs */}
      <div className="tabs-bar mb-4">
        <button onClick={() => setTab('overview')} className={tab === 'overview' ? 'tab-btn-active' : 'tab-btn'}>Overview</button>
        <button onClick={() => setTab('timeline')} className={tab === 'timeline' ? 'tab-btn-active' : 'tab-btn'}>Timeline</button>
      </div>

      {tab === 'timeline' ? (<Suspense fallback={<PageSpinner label="Loading timeline…" />}><GanttTimeline /></Suspense>) : (<>

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

      {/* ---- utilization bar chart with drill-down ---- */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base font-semibold">
              {pickedType
                ? "Today's bookings — " + (TYPE_LABEL[pickedType] || pickedType)
                : "Today's utilization by facility type"}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              {pickedType
                ? 'Each bar = one facility. Click Back to return to the type overview.'
                : 'Each bar = one type. Click a bar to drill into individual facilities.'}
            </p>
          </div>
          {pickedType && (
            <Button variant="outline" size="sm" onClick={() => setPickedType(null)}>
              ← Back
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {per_facility.length === 0 ? (
            <EmptyHint label="No active facilities yet." />
          ) : pickedType ? (
            // --------------------- DETAIL VIEW ---------------------
            !hasAnyDetail ? (
              <EmptyHint label="No bookings in this type today." />
            ) : (
              <div className="h-[360px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={detailData}
                    margin={{ top: 10, right: 16, left: 0, bottom: 60 }}
                    barCategoryGap="20%"
                  >
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11 }}
                      interval={0}
                      angle={-30}
                      textAnchor="end"
                      height={70}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 12 }}
                      tickFormatter={(v: number) => fmtMinutes(v)}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(15, 23, 42, 0.04)' }}
                      content={(p: unknown) => {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const tp = p as any;
                        if (!tp || !tp.active || !tp.payload || !tp.payload[0]) return null;
                        const d = tp.payload[0].payload as typeof detailData[number];
                        return (
                          <div style={{
                            background: 'white', border: '1px solid #e5e7eb',
                            borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                            padding: '8px 12px', minWidth: 180,
                          }}>
                            <strong style={{ fontSize: 13 }}>{d.name}</strong>
                            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                              {fmtMinutes(d.booked)} / {fmtMinutes(d.open)} booked
                            </div>
                            <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4, color: d.color }}>
                              {Math.round(d.pct * 100)}% utilised
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Bar
                      dataKey="booked"
                      radius={[6, 6, 0, 0]}
                      isAnimationActive={false}
                    >
                      {detailData.map((d) => (
                        <Cell key={d.id} fill={d.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )
          ) : (
            // --------------------- OVERVIEW VIEW ---------------------
            !hasAnyOverview ? (
              <EmptyHint label="No bookings" />
            ) : (
              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={overviewData}
                    margin={{ top: 10, right: 16, left: 0, bottom: 24 }}
                    barCategoryGap="25%"
                  >
                    <XAxis
                      dataKey="label"
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
                    <Tooltip
                      cursor={{ fill: 'rgba(15, 23, 42, 0.04)' }}
                      content={(p: unknown) => {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const tp = p as any;
                        if (!tp || !tp.active || !tp.payload || !tp.payload[0]) return null;
                        const d = tp.payload[0].payload as typeof overviewData[number];
                        return (
                          <div style={{
                            background: 'white', border: '1px solid #e5e7eb',
                            borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                            padding: '8px 12px', minWidth: 180,
                          }}>
                            <strong style={{ fontSize: 13 }}>{d.label}</strong>
                            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                              {d.count} {d.count === 1 ? 'facility' : 'facilities'}
                            </div>
                            <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>
                              {fmtMinutes(d.booked)} booked today
                            </div>
                            <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 6 }}>
                              Click bar to see individual facilities →
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Bar
                      dataKey="booked"
                      radius={[8, 8, 0, 0]}
                      isAnimationActive={false}
                      cursor="pointer"
                      onClick={(data: unknown) => {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const d = data as any;
                        const t = (d?.payload?.type || d?.type) as FacilityType | undefined;
                        if (t) setPickedType(t);
                      }}
                    >
                      {overviewData.map((d) => (
                        <Cell key={d.type} fill={d.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )
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
void Legend