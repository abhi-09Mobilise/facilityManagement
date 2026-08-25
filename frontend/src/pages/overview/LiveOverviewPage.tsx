// Live overview — super_admin / tenant_admin home, built 1:1 from the
// SoCampus Desk prototype's vOverview() (and the approved screenshot):
//
//   [site select] [● Live · HH:MM] [sweeper status]
//   [Live occupancy] [Bookings today] [Auto-released] [Biometric mismatches]
//   [Floors at <site> table + Live activity]   [Admin alerts | Release sweeper]
//
// Data honesty: occupancy / bookings / floors / activity are wired to real
// APIs. Auto-release, biometric and alerts don't exist in the backend yet
// (Phase 1 / Phase 2 builds) — those cards keep the prototype layout with
// truthful zero-states instead of invented numbers.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { dashboardsApi, type DashboardPayload } from '@/api/dashboards.api';
import { facilitiesApi } from '@/api/facilities.api';
import { bookingsApi } from '@/api/bookings.api';
import { sitesApi } from '@/api/sites.api';
import { useAuth } from '@/context/AuthContext';
import { useTenantScope } from '@/context/TenantScopeContext';
import type { Facility, LiveBooking, Site } from '@/types';
import { cn } from '@/lib/utils';

// ---------- tiny local atoms (prototype .tag / .kpi / .bar / .tl) ----------

function Tag({ tone, children }: { tone: 'teal' | 'amber' | 'coral' | 'grey' | 'indigo'; children: React.ReactNode }) {
  const cls = {
    teal:   'bg-teal-soft text-teal-ink',
    amber:  'bg-amber-soft text-amber-ink',
    coral:  'bg-coral-soft text-coral-ink',
    indigo: 'bg-indigo-soft text-indigo-ink',
    grey:   'bg-[#EDF0F5] text-mutedx',
  }[tone];
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap', cls)}>
      <i className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

function Kpi({ label, value, sub, valueClass }: {
  label: string; value: React.ReactNode; sub: React.ReactNode; valueClass?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-card px-4 py-3.5 shadow-card">
      <div className="text-[11px] font-semibold uppercase tracking-[.1em] text-mutedx">{label}</div>
      <div className={cn('mt-1.5 font-display text-[28px] font-bold leading-none tracking-tight', valueClass)}>
        {value}
      </div>
      <div className="mt-1 text-xs text-mutedx">{sub}</div>
    </div>
  );
}

function OccBar({ pct, danger }: { pct: number; danger?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-[90px] overflow-hidden rounded bg-[#EDF0F5]">
        <i
          className={cn('block h-full rounded', danger ? 'bg-coral' : 'bg-indigo')}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <span className="font-mono text-xs">{pct}%</span>
    </div>
  );
}

const fmtTime = (s?: string) => (s ? s.slice(11, 16) : '');

// -------------------------------- page --------------------------------

export default function LiveOverviewPage() {
  const { user } = useAuth();
  const scope = useTenantScope();
  const isSuper = user?.role === 'super_admin';
  const tenantId = isSuper ? (scope.tenantId ?? undefined) : undefined;

  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<number | ''>('');
  const [dash, setDash] = useState<DashboardPayload | null>(null);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [todayBookings, setTodayBookings] = useState<LiveBooking[]>([]);
  const [todayTotal, setTodayTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    sitesApi.list({ limit: 200, tenant_id: tenantId })
      .then((r) => setSites((r.data?.data || []) as Site[]))
      .catch(() => setSites([]));
  }, [tenantId]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const params = { tenant_id: tenantId, site_id: siteId || undefined };
    Promise.all([
      dashboardsApi.tenantAdmin({ ...params, limit: 200 }),
      facilitiesApi.list({ ...params, limit: 500 }),
      bookingsApi.list({ scope: 'tenant', tenant_id: tenantId, from_date: today, to_date: today, limit: 50 }),
    ])
      .then(([d, f, b]) => {
        if (!alive) return;
        setDash(d.data ?? null);
        setFacilities(((f.data?.data || []) as Facility[]));
        const pag = b.data; // envelope.data = Paginated<LiveBooking>
        setTodayBookings((pag?.data || []) as LiveBooking[]);
        setTodayTotal(pag?.total ?? (pag?.data?.length || 0));
      })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, siteId]);

  // ---- floors rollup: facility rows joined to dashboard live data ----
  const floors = useMemo(() => {
    if (!dash) return [];
    const liveById = new Map(dash.per_facility.map((p) => [p.id, p]));
    const byFloor = new Map<string, {
      name: string; sub: string; bookable: number; occupied: number;
      open: number; booked: number;
    }>();
    facilities.forEach((f) => {
      const key = String(f.floor_id ?? `site-${f.site_id}`);
      const row = byFloor.get(key) || {
        name: (f as { floor_name?: string }).floor_name || 'Unassigned floor',
        sub: f.site_name || '',
        bookable: 0, occupied: 0, open: 0, booked: 0,
      };
      const live = liveById.get(f.id);
      row.bookable += 1;
      if (live?.occupied_now) row.occupied += 1;
      row.open += live?.today_open_minutes || 0;
      row.booked += live?.today_booked_minutes || 0;
      byFloor.set(key, row);
    });
    return [...byFloor.values()]
      .map((r) => ({ ...r, occupancy: r.open > 0 ? Math.round((r.booked / r.open) * 100) : 0 }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [dash, facilities]);

  const summary = dash?.summary;
  const occPct = summary && summary.total_facilities > 0
    ? Math.round((summary.occupied_now / summary.total_facilities) * 100)
    : 0;
  const asOf = dash?.as_of ? new Date(dash.as_of) : new Date();
  const liveTime = `${String(asOf.getHours()).padStart(2, '0')}:${String(asOf.getMinutes()).padStart(2, '0')}`;
  const siteName = siteId ? (sites.find((s) => s.id === siteId)?.name ?? 'this site') : 'all locations';

  const activity = useMemo(
    () => [...todayBookings].sort((a, b) => b.id - a.id).slice(0, 7),
    [todayBookings],
  );
  const ACT_DOT: Record<string, string> = {
    approved: 'bg-indigo shadow-[0_0_0_1.5px_#3657E8]',
    pending: 'bg-amber shadow-[0_0_0_1.5px_#D98A0B]',
    completed: 'bg-teal shadow-[0_0_0_1.5px_#0E8C7F]',
    cancelled: 'bg-white shadow-[0_0_0_1.5px_#CBD2DE]',
    rejected: 'bg-coral shadow-[0_0_0_1.5px_#D8432A]',
  };
  const ACT_LABEL: Record<string, string> = {
    approved: 'Booking confirmed', pending: 'Approval requested',
    completed: 'Booking completed', cancelled: 'Booking cancelled', rejected: 'Booking rejected',
  };

  if (loading && !dash) {
    return <div className="grid place-items-center py-24"><Loader2 className="h-6 w-6 animate-spin text-mutedx" /></div>;
  }

  return (
    <div>
      {/* ---- header row: scope + live status ---- */}
      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <select
          aria-label="Location"
          className="h-9 rounded-[9px] border border-line-2 bg-card px-2.5 text-[12.5px] font-medium text-inktext min-w-[180px] focus:outline-none focus:ring-2 focus:ring-indigo/30 focus:border-indigo"
          value={siteId}
          onChange={(e) => setSiteId(e.target.value ? Number(e.target.value) : '')}
        >
          <option value="">All locations</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <Tag tone="teal">Live · {liveTime}</Tag>
        <span className="text-xs text-mutedx">
          Auto-release sweeper · switches on with the Phase 1 build
        </span>
      </div>

      {/* ---- KPI row (exact cards from the prototype) ---- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 sm:gap-4">
        <Kpi
          label="Live occupancy"
          value={`${occPct}%`}
          sub={<><b className="font-semibold text-inktext">{summary?.occupied_now ?? 0}</b> occupied of <b className="font-semibold text-inktext">{summary?.total_facilities ?? 0}</b> bookable</>}
        />
        <Kpi
          label="Bookings today"
          value={todayTotal}
          sub={<><b className="font-semibold text-inktext">{summary?.free_now ?? 0}</b> facilities free right now</>}
        />
        <Kpi
          label="Auto-released"
          value={<span className="text-faint">0</span>}
          sub={<>no-show release ships with Phase 1 · alert at 20%</>}
        />
        <Kpi
          label="Biometric mismatches"
          value={<span className="text-faint">—</span>}
          sub={<>connects with the biometric integration (Phase 2)</>}
        />
      </div>

      {/* ---- main grid: floors + activity | alerts + sweeper ---- */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="rounded-xl border border-line bg-card p-4 shadow-card sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="font-display text-[15px] font-semibold">Floors at {siteName}</h3>
            <Link
              to="/admin/masters/facilities"
              className="rounded-[9px] border border-line-2 bg-card px-3 py-1.5 text-xs font-medium text-inktext hover:bg-paper"
            >
              Manage desks
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line">
                  {['Floor', 'Bookable', 'Occupied now', 'Occupancy', 'Awaiting', 'Released', 'Grace'].map((h) => (
                    <th key={h} className="whitespace-nowrap px-2.5 py-2 text-left text-[11px] font-semibold uppercase tracking-[.08em] text-mutedx">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {floors.map((f) => (
                  <tr key={f.name + f.sub} className="border-b border-line last:border-0 hover:bg-[#FAFBFD]">
                    <td className="px-2.5 py-2.5">
                      <b className="font-semibold">{f.name}</b>
                      <span className="ml-1.5 text-xs text-mutedx">{f.sub}</span>
                    </td>
                    <td className="px-2.5 py-2.5 font-mono">{f.bookable}</td>
                    <td className="px-2.5 py-2.5 font-mono">{f.occupied}</td>
                    <td className="px-2.5 py-2.5"><OccBar pct={f.occupancy} danger={f.occupancy >= 85} /></td>
                    <td className="px-2.5 py-2.5 font-mono text-faint">—</td>
                    <td className="px-2.5 py-2.5 font-mono text-faint">—</td>
                    <td className="px-2.5 py-2.5 font-mono text-faint">—</td>
                  </tr>
                ))}
                {floors.length === 0 && (
                  <tr><td colSpan={7} className="px-2.5 py-8 text-center text-sm text-mutedx">No facilities in this scope yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-faint">
            Awaiting check-in, released counts and grace periods appear here once the Phase 1 check-in build is live.
          </p>

          <div className="my-3 h-px bg-line" />
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-display text-[15px] font-semibold">Live activity</h3>
            <span className="text-xs text-mutedx">today's bookings</span>
          </div>
          <div>
            {activity.map((b) => (
              <div key={b.id} className="grid grid-cols-[54px_18px_1fr] items-start gap-2 py-1.5">
                <div className="pt-0.5 font-mono text-[11.5px] text-mutedx">{fmtTime(b.start_at)}</div>
                <div className={cn('mt-1.5 h-2.5 w-2.5 justify-self-center rounded-full border-2 border-white', ACT_DOT[b.status] || ACT_DOT.cancelled)} />
                <div className="text-[12.5px]">
                  {ACT_LABEL[b.status] || 'Booking updated'} ·{' '}
                  <span className="rounded bg-[#EEF1F6] px-1.5 font-mono text-[12px]">{b.facility_name || `#${b.facility_id}`}</span>
                  <span className="block text-[11.5px] text-mutedx">
                    {(b.booker_name || b.booker_username || 'Unknown booker')} · {fmtTime(b.start_at)}–{fmtTime(b.end_at)}
                  </span>
                </div>
              </div>
            ))}
            {activity.length === 0 && (
              <div className="py-6 text-center text-sm text-mutedx">Nothing booked yet today.</div>
            )}
          </div>
        </div>

        <div>
          {/* ---- Admin alerts ---- */}
          <div className="rounded-xl border border-line bg-card p-4 shadow-card sm:p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display text-[15px] font-semibold">Admin alerts</h3>
              <Tag tone="grey">0 new</Tag>
            </div>
            <div className="rounded-xl border border-dashed border-line-2 px-6 py-7 text-center text-sm text-mutedx">
              No alerts yet. Occupancy and no-show alerts switch on with the Phase 1 reminder engine.
            </div>
          </div>

          {/* ---- Release sweeper card ---- */}
          <div className="mt-3.5 rounded-xl border border-line bg-card p-4 shadow-card sm:p-5">
            <h3 className="mb-2 font-display text-[15px] font-semibold">Today's release sweeper</h3>
            <div className="text-[13px]">
              {[
                ['Grace period', '15 min'],
                ['Reminder lead', '5 min before'],
                ['Biometric counts as check-in', 'No'],
                ['Queue', '0 pending · 0 failed'],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between py-1.5">
                  <span className="text-mutedx">{k}</span>
                  <b className="font-mono text-[12.5px] font-semibold">{v}</b>
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-faint">
              Planned defaults — the sweeper goes live with the Phase 1 auto-release build and becomes editable under Booking rules.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
