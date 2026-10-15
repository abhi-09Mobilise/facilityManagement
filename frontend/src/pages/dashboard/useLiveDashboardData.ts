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

export interface LiveDashboardParams {
  siteId?: number | null;
  rangeDays?: RangeDays;
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
  sites: Site[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useLiveDashboardData(params: LiveDashboardParams = {}): LiveDashboardData {
  const { siteId = null, rangeDays = 30 } = params;
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

    const today = isoDate(new Date());
    const rangeStart = isoDate(addDays(new Date(), -(rangeDays - 1)));

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
        to_date: today,
        limit: 100,
      }),
      dashboardsApi.gantt({ ...scoped, from: rangeStart, to: today }),
      dashboardsApi.peakTimes({ ...scoped, from: rangeStart, to: today }),
      dashboardsApi.pantryOrders({ ...scoped, from: rangeStart, to: today }),
      dashboardsApi.bookingChannel({ ...scoped, from: rangeStart, to: today }),
      dashboardsApi.feedback({ ...scoped, from: rangeStart, to: today }),
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
  }, [isSuper, scope.tenantId, scope.organisationId, siteId, rangeDays, nonce]);

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

    const siteCount = sites.length;
    const summary = siteCount > 0
      ? `${siteCount} site${siteCount === 1 ? '' : 's'} · ${total} facilities · ${occupied} in use · ${free} free`
      : `${total} facilities · ${occupied} in use · ${free} free`;

    return {
      occupiedPercent,
      inUseNow: occupied,
      availableToBook: free,
      startingWithin30Min: startingSoon,
      summary,
      rangeDays,
    };
  }, [dash, todayBookings, sites, rangeDays]);

  // --- KPI overlay ---------------------------------------------------
  const kpiOverlay = useMemo<Record<string, Partial<KpiTile>>>(() => {
    if (!dash) return {};
    const total = dash.summary.total_facilities;
    const occupied = dash.summary.occupied_now;
    const percent = total > 0 ? Math.round((occupied / total) * 100) : 0;
    const out: Record<string, Partial<KpiTile>> = {
      'Total facilities': {
        value: total.toLocaleString(),
        secondary: `${sites.length} site${sites.length === 1 ? '' : 's'}`,
      },
      'Booked right now': {
        value: occupied.toLocaleString(),
        secondary: `${percent}% occupied right now`,
      },
    };
    return out;
  }, [dash, sites]);

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

  return {
    heroOverlay, kpiOverlay, activityOverlay,
    facilityStatusOverlay, mostBookedOverlay, bookingsOverTimeOverlay, peakTimesOverlay,
    pantryOrdersOverlay, bookingChannelOverlay, feedbackOverlay,
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
