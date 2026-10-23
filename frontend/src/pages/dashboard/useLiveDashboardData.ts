// Phase 1 + 1.5 live-data hook for the SpaceDesk dashboard.
//
// Reuses existing wired APIs — no new backend endpoints introduced.
// Each getter in sampleData.ts can be fed an "overlay" of fields derived
// from these existing endpoints:
//
//   • dashboardsApi.tenantAdmin()      — summary + per-facility snapshot
//   • dashboardsApi.gantt(range)       — booking items across a time window
//   • bookingsApi.list({today})        — today's bookings for live state
//   • sitesApi.list()                  — sites list for the dropdown
//   • facilitiesApi.list()             — enrich facility rows with site_name
//
// Follows the exact fetch pattern used by the HEAD version of
// DashboardPage.tsx: tenant/org scope from `useTenantScope()`, an
// `alive` cleanup flag, loading + error state, and a `refresh()`
// trigger for the navbar refresh button.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  dashboardsApi,
  type DashboardPayload, type GanttPayload, type PeakTimesPayload, type PantryOrdersPayload,
  type BookingChannelPayload, type FeedbackPayload, type RecentActivityPayload,
} from '@/api/dashboards.api';
import { bookingsApi } from '@/api/bookings.api';
import { sitesApi } from '@/api/sites.api';
import { facilitiesApi } from '@/api/facilities.api';
import { useAuth } from '@/context/AuthContext';
import { useTenantScope } from '@/context/TenantScopeContext';
import type { LiveBooking, Site, Facility } from '@/types';
import type {
  HeroOverview, KpiTile, ActivityItem,
  LiveFacility, MostBookedRow, BookingsOverTimePoint, PeakCell,
} from './sampleData';

type RangeDays = 7 | 30 | 90;

/**
 * The dashboard's active date window — either a "last N days" preset or a
 * user-picked custom range. Centralised here so the hook, the hero, and the
 * owning page all speak the same type.
 *
 *   { kind: 'preset', days: 7 | 30 | 90 }
 *   { kind: 'custom', from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
 *
 * `from` must be <= `to`, `to` must be <= today. The custom range is capped
 * at 2 years so a stray pick doesn't fire a 10-year query against the DB.
 */
export type DashboardRange =
  | { kind: 'preset'; days: RangeDays }
  | { kind: 'custom'; from: string; to: string };

export interface LiveDashboardParams {
  siteId?: number | null;
  /** Preset or custom date window. Defaults to `{ kind: 'preset', days: 30 }`. */
  range?: DashboardRange;
}

// Enriched row shown in the "Booked today" drilldown drawer. Combines the
// raw booking fields with site + organisation names resolved client-side
// from the facilities + sites lists already fetched by the dashboard.
export interface BookedTodayRow {
  id: number;
  title: string;
  facility_id: number;
  facility_name: string;
  facility_type?: string;
  site_name: string;
  organisation_name: string;
  start_at: string;
  end_at: string;
  status: string;
  booker_name: string;
  department_name?: string;
  attendee_count: number;
}

export interface LiveDashboardData {
  heroOverlay: Partial<HeroOverview>;
  kpiOverlay: Record<string, Partial<KpiTile>>;
  activityOverlay: ActivityItem[] | null;
  facilityStatusOverlay: LiveFacility[] | null;
  mostBookedOverlay: {
    facility: MostBookedRow[];
    type: MostBookedRow[];
  } | null;
  bookingsOverTimeOverlay: {
    series: BookingsOverTimePoint[];
    summary: { checkedIn: number; cancelled: number; noShows: number; busiest: { day: string; count: number } };
  } | null;
  peakTimesOverlay: {
    cells: PeakCell[];
    busiestSlot: string;
    busiestHour: string;
    quietestWorking: string;
    maxPerSlot: number;
  } | null;
  pantryOrdersOverlay: PantryOrdersPayload | null;
  bookingChannelOverlay: BookingChannelPayload | null;
  feedbackOverlay: FeedbackPayload | null;
  // Enriched list for the "Booked today" drilldown panel. Non-cancelled
  // bookings whose window overlaps today, with site + org resolved.
  bookedTodayDetails: BookedTodayRow[];
  sites: Site[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const DEFAULT_RANGE: DashboardRange = { kind: 'preset', days: 30 };

export function useLiveDashboardData(params: LiveDashboardParams = {}): LiveDashboardData {
  const { siteId = null, range = DEFAULT_RANGE } = params;
  // Legacy derived value — several memos below still key on the preset number
  // (hero's "last N days" labels, chart titles). For custom ranges we fall
  // back to the inclusive day-span so those labels stay sensible.
  const rangeDays: number = range.kind === 'preset'
    ? range.days
    : daysBetween(range.from, range.to);
  // Stable primitive for dependency arrays — React can't deep-compare the
  // range object across renders, so we flatten it to a cache key.
  const rangeKey = range.kind === 'preset'
    ? `preset:${range.days}`
    : `custom:${range.from}:${range.to}`;
  const { user } = useAuth();
  const scope = useTenantScope();

  const [dash, setDash] = useState<DashboardPayload | null>(null);
  const [todayBookings, setTodayBookings] = useState<LiveBooking[]>([]);
  const [gantt, setGantt] = useState<GanttPayload | null>(null);
  const [peak, setPeak] = useState<PeakTimesPayload | null>(null);
  const [pantry, setPantry] = useState<PantryOrdersPayload | null>(null);
  const [channel, setChannel] = useState<BookingChannelPayload | null>(null);
  const [feedback, setFeedback] = useState<FeedbackPayload | null>(null);
  const [activity, setActivity] = useState<RecentActivityPayload | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const isSuper = user?.role === 'super_admin';

  useEffect(() => {
    if (isSuper && !scope.tenantId) {
      setDash(null);
      setTodayBookings([]);
      setGantt(null);
      setPeak(null);
      setPantry(null);
      setChannel(null);
      setFeedback(null);
      setActivity(null);
      setFacilities([]);
      setLoading(false);
      return;
    }

    let alive = true;
    setLoading(true);
    setError(null);

    // Build scope params conditionally — never pass `null` because some
    // backend validators reject it (we want the field to be omitted
    // entirely so the server infers the scope from the JWT).
    const scoped: { tenant_id?: number; organisation_id?: number; site_id?: number } = {};
    if (scope.tenantId) scoped.tenant_id = scope.tenantId;
    if (scope.organisationId !== null) scoped.organisation_id = scope.organisationId;
    if (siteId) scoped.site_id = siteId;

    // Sites/facilities lists are tenant/org scoped but NOT site scoped —
    // picking a site shouldn't shrink the dropdown choices.
    const listScope: { tenant_id?: number; organisation_id?: number } = {};
    if (scope.tenantId) listScope.tenant_id = scope.tenantId;
    if (scope.organisationId !== null) listScope.organisation_id = scope.organisationId;

    // Resolve the active window to concrete from/to dates. Preset windows
    // always end today; custom windows use whatever the user picked.
    const today = isoDate(new Date());
    // bookingsApi.list treats `to_date` as EXCLUSIVE (`b.start_at < ?`), so
    // querying "today's bookings" needs tomorrow as the upper bound — else
    // the WHERE collapses to `>= today AND < today` and returns zero rows.
    const tomorrow = isoDate(addDays(new Date(), 1));
    const windowTo = range.kind === 'custom' ? range.to : today;
    const windowFrom = range.kind === 'custom'
      ? range.from
      : isoDate(addDays(new Date(), -(range.days - 1)));

    // Promise.allSettled — one API blowing up (e.g. gantt missing a
    // required scope field on some backends) shouldn't zero out every
    // other overlay. Each result is handled independently so widgets
    // still get real data from the calls that succeeded.
    Promise.allSettled([
      dashboardsApi.tenantAdmin({ ...scoped, limit: 500 }),
      bookingsApi.list({
        ...(scoped.tenant_id ? { tenant_id: scoped.tenant_id } : {}),
        scope: 'tenant',
        from_date: today,
        to_date: tomorrow,
        limit: 100,
      }),
      dashboardsApi.gantt({ ...scoped, from: windowFrom, to: windowTo }),
      dashboardsApi.peakTimes({ ...scoped, from: windowFrom, to: windowTo }),
      dashboardsApi.pantryOrders({ ...scoped, from: windowFrom, to: windowTo }),
      dashboardsApi.bookingChannel({ ...scoped, from: windowFrom, to: windowTo }),
      dashboardsApi.feedback({ ...scoped, from: windowFrom, to: windowTo }),
      dashboardsApi.recentActivity({ ...scoped, limit: 20 }),
      sitesApi.list({ ...listScope, limit: 200 }),
      facilitiesApi.list({ ...listScope, limit: 500 }),
    ])
      .then((results) => {
        if (!alive) return;
        const [dashR, bookR, ganttR, peakR, pantryR, channelR, feedbackR, activityR, sitesR, facR] = results;

        if (dashR.status === 'fulfilled' && dashR.value.status && dashR.value.data) {
          setDash(dashR.value.data);
        } else if (dashR.status === 'rejected') {
          // eslint-disable-next-line no-console
          console.warn('[SpaceDesk] tenantAdmin failed:', dashR.reason);
        }

        if (bookR.status === 'fulfilled') {
          setTodayBookings(bookR.value.data?.data ?? []);
        } else {
          // eslint-disable-next-line no-console
          console.warn('[SpaceDesk] bookings.list failed:', bookR.reason);
        }

        if (ganttR.status === 'fulfilled' && ganttR.value.status && ganttR.value.data) {
          setGantt(ganttR.value.data);
        } else if (ganttR.status === 'rejected') {
          // eslint-disable-next-line no-console
          console.warn('[SpaceDesk] gantt failed:', ganttR.reason);
        }

        if (peakR.status === 'fulfilled' && peakR.value.status && peakR.value.data) {
          setPeak(peakR.value.data);
        } else if (peakR.status === 'rejected') {
          // eslint-disable-next-line no-console
          console.warn('[SpaceDesk] peakTimes failed:', peakR.reason);
        }

        if (pantryR.status === 'fulfilled' && pantryR.value.status && pantryR.value.data) {
          setPantry(pantryR.value.data);
        } else if (pantryR.status === 'rejected') {
          // eslint-disable-next-line no-console
          console.warn('[SpaceDesk] pantryOrders failed:', pantryR.reason);
        }

        if (channelR.status === 'fulfilled' && channelR.value.status && channelR.value.data) {
          setChannel(channelR.value.data);
        } else if (channelR.status === 'rejected') {
          // eslint-disable-next-line no-console
          console.warn('[SpaceDesk] bookingChannel failed:', channelR.reason);
        }

        if (feedbackR.status === 'fulfilled' && feedbackR.value.status && feedbackR.value.data) {
          setFeedback(feedbackR.value.data);
        } else if (feedbackR.status === 'rejected') {
          // eslint-disable-next-line no-console
          console.warn('[SpaceDesk] feedback failed:', feedbackR.reason);
        }

        if (activityR.status === 'fulfilled' && activityR.value.status && activityR.value.data) {
          setActivity(activityR.value.data);
        } else if (activityR.status === 'rejected') {
          // eslint-disable-next-line no-console
          console.warn('[SpaceDesk] recentActivity failed:', activityR.reason);
        }

        if (sitesR.status === 'fulfilled') {
          setSites(sitesR.value.data?.data ?? []);
        } else {
          // eslint-disable-next-line no-console
          console.warn('[SpaceDesk] sites.list failed:', sitesR.reason);
        }

        if (facR.status === 'fulfilled') {
          setFacilities(facR.value.data?.data ?? []);
        } else {
          // eslint-disable-next-line no-console
          console.warn('[SpaceDesk] facilities.list failed:', facR.reason);
        }

        // Only surface an error if EVERY call failed — otherwise we have
        // partial data to show.
        const allFailed = results.every((r) => r.status === 'rejected');
        if (allFailed) {
          const first = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
          const msg = (first?.reason as { response?: { data?: { msg?: string } } })?.response?.data?.msg
            || 'Failed to load live dashboard data';
          setError(msg);
        }
      })
      .finally(() => { if (alive) setLoading(false); });

    return () => { alive = false; };
    // Dependencies: refetch when scope / site / window changes. For custom
    // ranges we key on the from/to strings; for presets we key on the day
    // count. All collapsed into a single stable string via rangeKey below.
  }, [isSuper, scope.tenantId, scope.organisationId, siteId, rangeKey, nonce]);

  // --- Hero overlay --------------------------------------------------
  const heroOverlay = useMemo<Partial<HeroOverview>>(() => {
    if (!dash) return {};
    const total = dash.summary.total_facilities;
    const occupied = dash.summary.occupied_now;
    const free = dash.summary.free_now;
    const occupiedPercent = total > 0 ? Math.round((occupied / total) * 100) : 0;

    const now = Date.now();
    const thirtyMinMs = 30 * 60 * 1000;
    const startingSoon = todayBookings.filter((b) => {
      if (b.status === 'cancelled' || b.status === 'rejected') return false;
      const start = parseServerTs(b.start_at);
      if (!start) return false;
      const delta = start.getTime() - now;
      return delta > 0 && delta <= thirtyMinMs;
    }).length;

    // When a specific site is filtered in, the summary line should name
    // THAT site instead of the misleading tenant-wide site count.
    const selectedSiteName = siteId != null
      ? (sites.find((s) => s.id === siteId)?.name ?? null)
      : null;
    const siteCount = sites.length;
    const summary = selectedSiteName
      ? `${selectedSiteName} · ${total} facilities · ${occupied} in use · ${free} free`
      : siteCount > 0
        ? `${siteCount} site${siteCount === 1 ? '' : 's'} · ${total} facilities · ${occupied} in use · ${free} free`
        : `${total} facilities · ${occupied} in use · ${free} free`;

    const overlay: Partial<HeroOverview> = {
      occupiedPercent,
      inUseNow: occupied,
      availableToBook: free,
      startingWithin30Min: startingSoon,
      summary,
    };
    // Hero's sample type caps rangeDays at 7|30|90; only pass it when we're
    // in a preset window. Custom ranges leave rangeDays unset — the hero's
    // own label logic reads the full range object (see range prop).
    if (range.kind === 'preset') overlay.rangeDays = range.days;
    return overlay;
  }, [dash, todayBookings, sites, range, siteId]);

  // --- KPI overlay ---------------------------------------------------
  const kpiOverlay = useMemo<Record<string, Partial<KpiTile>>>(() => {
    if (!dash) return {};
    const total = dash.summary.total_facilities;
    const occupied = dash.summary.occupied_now;
    // "Booked today" stats — any booking whose window overlaps today
    // (not just "active right now"). The old right-now metric lives in
    // the Peak Booking Times heatmap, so the KPI tile now gives the
    // daily rollup instead.
    const bookedToday  = dash.summary.facilities_booked_today ?? 0;
    const bookingsToday = dash.summary.bookings_today ?? 0;
    const seatsToday    = dash.summary.seats_booked_today ?? 0;
    const todayPercent = total > 0 ? (bookedToday / total) * 100 : 0;

    // BUG-03 fix: real per-site breakdown for the stacked bar inside the
    // "Total facilities" tile. Replaces the hardcoded Mumbai/Pune/Bengaluru.
    // When a specific site is filtered in, skip the breakdown entirely —
    // a stacked bar of one site is meaningless and the tenant-wide
    // "Hyderabad 56 · Delhi 26 …" label contradicts the filter.
    const SITE_COLORS = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16'];
    const selectedSiteName = siteId != null
      ? (sites.find((s) => s.id === siteId)?.name ?? null)
      : null;
    const perSite = new Map<number, number>();
    if (siteId == null) {
      for (const f of facilities) {
        if (f.site_id == null) continue;
        perSite.set(f.site_id, (perSite.get(f.site_id) || 0) + 1);
      }
    }
    const siteNameById = new Map<number, string>();
    for (const s of sites) siteNameById.set(s.id, s.name);
    const siteBreakdown = Array.from(perSite.entries())
      .map(([sid, count], i) => ({
        name: siteNameById.get(sid) || `Site #${sid}`,
        count,
        color: SITE_COLORS[i % SITE_COLORS.length],
      }))
      .sort((a, b) => b.count - a.count);

    const out: Record<string, Partial<KpiTile>> = {
      'Total facilities': {
        value: total.toLocaleString(),
        secondary: selectedSiteName
          ? selectedSiteName
          : `${sites.length} site${sites.length === 1 ? '' : 's'}`,
        siteBreakdown: siteBreakdown.length > 0 ? siteBreakdown : undefined,
      },
      'Booked today': {
        value: bookedToday.toLocaleString(),
        // BUG-03 fix: real denominator from dashboard summary, not "/ 48".
        max: total,
        // Secondary mirrors the three numbers the user cares about —
        // bookings count, seats taken, and % of facilities utilised.
        // Percentage uses adaptive decimals so tiny values (0.04%) don't
        // round down to a misleading "0%".
        secondary: `${bookingsToday} booking${bookingsToday === 1 ? '' : 's'} · ${seatsToday} seat${seatsToday === 1 ? '' : 's'} · ${formatPercent(todayPercent)} occupied`,
      },
    };
    // BUG-04 fix: wire the "Bookings · N days" tile from the gantt payload
    // (which lists every booking in the active window). Counts non-cancelled
    // bookings so numbers match the Bookings-over-time chart and My bookings.
    if (gantt) {
      const inWindow = gantt.items.filter((it) => it.status !== 'cancelled' && it.status !== 'rejected').length;
      // Reflect the active range in the label so Custom (e.g. 60 days) reads correctly.
      const label = `Bookings · ${rangeDays} day${rangeDays === 1 ? '' : 's'}`;
      out[label] = {
        value: inWindow.toLocaleString(),
        secondary: `in the selected window`,
      };
      // Also populate the fixed "Bookings · 30 days" label used by sampleData,
      // in case the hero stays on the default preset — keeps the tile wired
      // whether the user tweaks the range or not.
      if (rangeDays === 30) {
        out['Bookings · 30 days'] = out[label];
      }
    }
    return out;
  }, [dash, sites, facilities, gantt, rangeDays, siteId]);

  // --- Recent activity overlay --------------------------------------
  // Prefer the dedicated /dashboards/recent-activity feed (unions new
  // bookings, QR check-ins, ratings, and pantry orders). If that endpoint
  // returned nothing — or hasn't resolved yet — fall back to the today-only
  // booking derivation so the panel never appears empty on a live tenant.
  const activityOverlay = useMemo<ActivityItem[] | null>(() => {
    if (activity && activity.items.length > 0) {
      return activity.items.map((e): ActivityItem => ({
        id: e.id,
        icon: e.icon,
        title: e.title,
        description: e.description,
        ago: e.ago,
      }));
    }
    if (todayBookings.length === 0) return null;
    const sorted = [...todayBookings].sort((a, b) => {
      const ta = parseServerTs(a.start_at)?.getTime() ?? 0;
      const tb = parseServerTs(b.start_at)?.getTime() ?? 0;
      return tb - ta;
    });
    return sorted.slice(0, 10).map((b): ActivityItem => {
      const actor = b.booker_name || b.booker_username || 'Someone';
      const target = b.facility_name || `Facility #${b.facility_id}`;
      return {
        id: `b-${b.id}`,
        icon: 'booking',
        title: `**${actor}** booked **${target}**`,
        description: `${formatSlot(b.start_at, b.end_at)} · ${b.status}`,
        ago: relativeTime(b.start_at),
      };
    });
  }, [activity, todayBookings]);

  // --- Live facility status overlay ---------------------------------
  // Combine per_facility snapshot with today's bookings to classify
  // each facility as in_use / starting_soon / available. We can't
  // derive 'maintenance' from the current API — those entries simply
  // won't appear until the backend adds the field.
  const facilityStatusOverlay = useMemo<LiveFacility[] | null>(() => {
    if (!dash) return null;

    // Build facility_id → site name map from the facilities list so we
    // can enrich the per_facility rows (which don't include site info).
    const siteByFacility = new Map<number, string>();
    for (const f of facilities) {
      if (f.site_name) siteByFacility.set(f.id, f.site_name);
    }

    const now = Date.now();
    const thirtyMinMs = 30 * 60 * 1000;

    // Build facility_id → next upcoming booking (next 30 min) map so
    // we can both flag "starting_soon" and craft the note text.
    const upcomingSoon = new Map<number, LiveBooking>();
    const inUseNoteByFacility = new Map<number, string>();
    for (const b of todayBookings) {
      if (b.status === 'cancelled' || b.status === 'rejected') continue;
      const s = parseServerTs(b.start_at);
      const e = parseServerTs(b.end_at);
      if (!s || !e) continue;
      const delta = s.getTime() - now;
      if (delta > 0 && delta <= thirtyMinMs) {
        const existing = upcomingSoon.get(b.facility_id);
        if (!existing || parseServerTs(existing.start_at)!.getTime() > s.getTime()) {
          upcomingSoon.set(b.facility_id, b);
        }
      } else if (s.getTime() <= now && now < e.getTime()) {
        // Currently in-use booking — build the note text.
        inUseNoteByFacility.set(b.facility_id, `In use · ${formatSlot(b.start_at, b.end_at)}`);
      }
    }

    return dash.per_facility.map((pf): LiveFacility => {
      let state: LiveFacility['state'];
      let note: string | undefined;

      if (pf.occupied_now) {
        state = 'in_use';
        note = inUseNoteByFacility.get(pf.id) || 'In use now';
      } else if (upcomingSoon.has(pf.id)) {
        state = 'starting_soon';
        const next = upcomingSoon.get(pf.id)!;
        const start = parseServerTs(next.start_at);
        const mins = start ? Math.max(1, Math.round((start.getTime() - now) / 60000)) : 30;
        note = `Starts in ${mins} min`;
      } else {
        state = 'available';
        note = pf.today_open_minutes > 0 ? 'Available now' : undefined;
      }

      return {
        id: `f-${pf.id}`,
        name: pf.name,
        type: pf.type,
        site: siteByFacility.get(pf.id) || '—',
        state,
        note,
      };
    });
  }, [dash, todayBookings, facilities]);

  // --- Most booked overlay -------------------------------------------
  // Aggregate the gantt range's items by facility and by type.
  const mostBookedOverlay = useMemo<LiveDashboardData['mostBookedOverlay']>(() => {
    if (!gantt) return null;
    const nameById = new Map<number, { name: string; type: string }>();
    for (const f of gantt.facilities) {
      nameById.set(f.id, { name: f.name, type: f.type });
    }

    const byFacility = new Map<string, number>();
    const byType = new Map<string, number>();
    for (const item of gantt.items) {
      if (item.status === 'cancelled' || item.status === 'rejected') continue;
      const meta = nameById.get(item.facility_id);
      if (!meta) continue;
      byFacility.set(meta.name, (byFacility.get(meta.name) ?? 0) + 1);
      byType.set(meta.type, (byType.get(meta.type) ?? 0) + 1);
    }

    const toSorted = (m: Map<string, number>, top: number): MostBookedRow[] =>
      Array.from(m.entries())
        .map(([key, bookings]) => ({ key, bookings }))
        .sort((a, b) => b.bookings - a.bookings)
        .slice(0, top);

    const facility = toSorted(byFacility, 8);
    const type = toSorted(byType, 8);
    if (facility.length === 0 && type.length === 0) return null;
    return { facility, type };
  }, [gantt]);

  // --- Bookings over time overlay ------------------------------------
  // Group gantt items by day over the selected range, counting:
  //   bookings = all non-cancelled items whose start_at falls on that day
  //   checkins = approved + completed (proxy for "actually used")
  const bookingsOverTimeOverlay = useMemo<LiveDashboardData['bookingsOverTimeOverlay']>(() => {
    if (!gantt) return null;

    // Bucket seed — one entry per day so the chart has a continuous x-axis
    // even on days with zero bookings.
    const bucketKeys: string[] = [];
    const buckets = new Map<string, { bookings: number; checkins: number }>();
    const start = addDays(new Date(), -(rangeDays - 1));
    for (let i = 0; i < rangeDays; i++) {
      const key = isoDate(addDays(start, i));
      bucketKeys.push(key);
      buckets.set(key, { bookings: 0, checkins: 0 });
    }

    let cancelled = 0;
    let noShows = 0;
    let checkedIn = 0;

    for (const item of gantt.items) {
      const d = parseServerTs(item.start_at);
      if (!d) continue;
      const key = isoDate(d);
      const bucket = buckets.get(key);
      if (item.status === 'cancelled') { cancelled++; continue; }
      if (item.status === 'rejected')  { noShows++; continue; }
      if (bucket) {
        bucket.bookings++;
        if (item.status === 'approved' || item.status === 'completed') {
          bucket.checkins++;
          checkedIn++;
        }
      }
    }

    const series: BookingsOverTimePoint[] = bucketKeys.map((k) => {
      const bk = buckets.get(k)!;
      return { day: formatDayLabel(k), bookings: bk.bookings, checkins: bk.checkins };
    });

    // Busiest day = highest bookings count
    let busiestKey = bucketKeys[0];
    let busiestCount = 0;
    for (const k of bucketKeys) {
      const c = buckets.get(k)!.bookings;
      if (c > busiestCount) { busiestKey = k; busiestCount = c; }
    }

    return {
      series,
      summary: {
        checkedIn,
        cancelled,
        noShows,
        busiest: { day: formatDayLabel(busiestKey), count: busiestCount },
      },
    };
  }, [gantt, rangeDays]);

  // --- Peak times overlay -------------------------------------------
  // Backend ships cells with hour 0..23. The widget renders business
  // hours (8..20) only — pass through everything so the widget's lookup
  // map covers the full range.
  const peakTimesOverlay = useMemo<LiveDashboardData['peakTimesOverlay']>(() => {
    if (!peak || peak.cells.length === 0) return null;
    return {
      cells: peak.cells.map((c) => ({
        weekday: c.weekday,
        hour: c.hour,
        count: c.count,
      })),
      busiestSlot: peak.busiestSlot,
      busiestHour: peak.busiestHour,
      quietestWorking: peak.quietestWorking,
      maxPerSlot: peak.maxPerSlot,
    };
  }, [peak]);

  // --- Pantry orders overlay ----------------------------------------
  // Backend already returns the exact shape the widget consumes (even
  // the null delivery-lifecycle fields match the widget's expectations).
  // Just pass it through; `null` return signals "fall back to sample".
  const pantryOrdersOverlay = pantry;

  // --- Booking channel overlay --------------------------------------
  // Backend always returns all four slices (zero-counts included). We
  // only hand the overlay to the widget when at least one booking was
  // tagged — otherwise fall back to the mock donut so the widget
  // doesn't render a blank circle.
  const bookingChannelOverlay = channel && channel.total > 0 ? channel : null;

  // --- Feedback overlay ---------------------------------------------
  // Fall back to the mock widget only when there are literally zero
  // ratings in the window — otherwise real data (even a single rating)
  // wins so the dashboard reflects reality.
  const feedbackOverlay = feedback && feedback.reviews > 0 ? feedback : null;

  // --- Booked-today details for the KPI tile drawer -----------------
  // Resolve facility → site → organisation names from the lists already
  // fetched above (sites, facilities), so the drawer can show rich
  // context without hitting a new endpoint. Cancelled/rejected rows are
  // excluded to match the backend COUNT used in the tile summary.
  const bookedTodayDetails = useMemo<BookedTodayRow[]>(() => {
    if (!todayBookings || todayBookings.length === 0) return [];
    const facilityById = new Map<number, Facility>();
    for (const f of facilities) facilityById.set(f.id, f);
    const siteById = new Map<number, Site>();
    for (const s of sites) siteById.set(s.id, s);
    const out: BookedTodayRow[] = [];
    for (const b of todayBookings) {
      if (b.status === 'cancelled' || b.status === 'rejected') continue;
      const fac = facilityById.get(b.facility_id);
      const site = fac?.site_id != null ? siteById.get(fac.site_id) : undefined;
      const bookerFirst = (b.booker_name || '').trim();
      const bookerLast  = ((b as unknown as { booker_lname?: string }).booker_lname || '').trim();
      const booker = [bookerFirst, bookerLast].filter(Boolean).join(' ') || b.booker_username || `#${b.user_id}`;
      out.push({
        id: b.id,
        title: b.title || `Booking #${b.id}`,
        facility_id: b.facility_id,
        facility_name: b.facility_name || fac?.name || `Facility #${b.facility_id}`,
        facility_type: b.facility_type || fac?.type,
        site_name: site?.name || fac?.site_name || '—',
        organisation_name: (site as unknown as { organisation_name?: string })?.organisation_name
          || (fac as unknown as { organisation_name?: string })?.organisation_name
          || '—',
        start_at: b.start_at,
        end_at: b.end_at,
        status: b.status,
        booker_name: booker,
        department_name: b.department_name || undefined,
        attendee_count: Number((b as unknown as { attendee_count?: number }).attendee_count || 1),
      });
    }
    // Sort by start time so the earliest booking shows first.
    out.sort((a, b) => a.start_at.localeCompare(b.start_at));
    return out;
  }, [todayBookings, facilities, sites]);

  return {
    heroOverlay, kpiOverlay, activityOverlay,
    facilityStatusOverlay, mostBookedOverlay, bookingsOverTimeOverlay, peakTimesOverlay,
    pantryOrdersOverlay, bookingChannelOverlay, feedbackOverlay,
    bookedTodayDetails,
    sites,
    loading, error, refresh,
  };
}

// --- Formatting helpers -------------------------------------------
function formatSlot(startAt: string, endAt: string): string {
  const s = parseServerTs(startAt);
  const e = parseServerTs(endAt);
  if (!s || !e) return `${startAt} → ${endAt}`;
  const hhmm = (d: Date) =>
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${hhmm(s)}–${hhmm(e)}`;
}

function relativeTime(serverTs: string): string {
  const d = parseServerTs(serverTs);
  if (!d) return '';
  const diffMs = d.getTime() - Date.now();
  const absMin = Math.round(Math.abs(diffMs) / 60000);
  if (absMin < 1) return 'just now';
  if (absMin < 60) return diffMs < 0 ? `${absMin}m ago` : `in ${absMin}m`;
  const absHr = Math.round(absMin / 60);
  if (absHr < 24) return diffMs < 0 ? `${absHr}h ago` : `in ${absHr}h`;
  const absDay = Math.round(absHr / 24);
  return diffMs < 0 ? `${absDay}d ago` : `in ${absDay}d`;
}

// Backend returns timestamps as 'YYYY-MM-DD HH:MM:SS' (space, not 'T').
// Treat them as local-timezone values to match the rest of the app.
function parseServerTs(ts: string): Date | null {
  if (!ts) return null;
  const normalised = ts.includes('T') ? ts : ts.replace(' ', 'T');
  const d = new Date(normalised);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

// Inclusive day count between two YYYY-MM-DD strings — e.g. 2026-10-01 →
// 2026-10-07 is 7 days. Used to translate a custom date range into the
// "last N days" number that chart aggregations still key on.
function daysBetween(from: string, to: string): number {
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 1;
  const ms = b.getTime() - a.getTime();
  return Math.max(1, Math.round(ms / (24 * 60 * 60 * 1000)) + 1);
}

/**
 * Adaptive-precision percentage formatter for KPI tiles.
 *
 * Rounding a tiny ratio like 2/5000 (0.04%) to a whole number produces
 * "0%", which reads as "nothing booked" even when there IS activity. This
 * widens the decimals as the value shrinks so small-but-non-zero numbers
 * stay visible.
 *
 *   100     → "100%"
 *    12.3   → "12%"
 *     4.56  → "4.6%"
 *     0.42  → "0.42%"
 *     0.04  → "0.04%"
 *     0.001 → "0.001%"
 *     0     → "0%"
 */
function formatPercent(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '0%';
  const abs = Math.abs(n);
  if (abs >= 10)  return `${Math.round(n)}%`;
  if (abs >= 1)   return `${n.toFixed(1)}%`;
  if (abs >= 0.1) return `${n.toFixed(2)}%`;
  // Very small — up to 3 significant figures, trim trailing zeros.
  return `${Number(n.toPrecision(2))}%`;
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

function formatDayLabel(isoDay: string): string {
  // "YYYY-MM-DD" → "D MMM" (e.g. "8 Sept") to match the mock labels.
  const parts = isoDay.split('-');
  if (parts.length !== 3) return isoDay;
  const day = Number(parts[2]);
  const month = Number(parts[1]) - 1;
  if (Number.isNaN(day) || month < 0 || month > 11) return isoDay;
  return `${day} ${MONTH_SHORT[month]}`;
}
