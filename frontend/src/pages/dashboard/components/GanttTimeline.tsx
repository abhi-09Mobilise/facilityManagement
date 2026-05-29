// F08 - Resource scheduler (react-calendar-timeline) - polished build.
//
// - Resources (facilities) on the left sidebar
// - 24h timeline on the right with day + hour headers
// - Status-coloured bars with a custom renderer (rounded, padded, booker
//   name + start-end time inside the bar when room allows)
// - TodayMarker: red vertical line at "now"
// - Sticky header (scrolling the rows keeps the date/time scale visible)
// - Tailwind class on the bar overrides Library's default border/background
// - Click any bar to open the existing details modal

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import moment from 'moment';
import Timeline, {
  TimelineHeaders, SidebarHeader, DateHeader, TodayMarker,
} from 'react-calendar-timeline';
import 'react-calendar-timeline/style.css';
import { Loader2, ChevronLeft, ChevronRight, X, Building, ChevronDown, ChevronUp } from 'lucide-react';
import type { FacilityType } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { dashboardsApi, type GanttPayload, type GanttItem } from '@/api/dashboards.api';
import { sitesApi } from '@/api/sites.api';
import { tenantsApi } from '@/api/tenants.api';
import { useAuth } from '@/context/AuthContext';
import type { Site, Tenant, BookingStatus } from '@/types';

const DAY_MS  = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
// Initial visible window: 8 hours wide. Wide enough to read each hour
// label without clipping; narrow enough that mid-day bookings show up
// prominently. User can pan horizontally + scroll-zoom to see more.
const VISIBLE_HOURS = 8;

// "Near past hour" -> floor(now to top of hour) - 1 hour. That gives the
// admin context for what JUST ended without burying the active hour at
// the far-left edge. For non-today dates we just open at 08:00 local.
function defaultVisibleStart(dateYmd: string): number {
  const today = (() => {
    const d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  })();
  if (dateYmd === today) {
    const now = new Date();
    now.setMinutes(0, 0, 0);
    return now.getTime() - HOUR_MS;
  }
  return new Date(dateYmd + 'T08:00:00').getTime();
}

// Human-readable label for each facility type — used by the category
// header rows the Gantt now groups facilities under.
const TYPE_LABEL: Record<FacilityType, string> = {
  meeting_room:    'Meeting rooms',
  conference_room: 'Conference rooms',
  gym:             'Gyms',
  desk:            'Desks',
  swimming_pool:   'Swimming pools',
  other:           'Other',
};
// Display order. Stable so the lanes don't shuffle as data refreshes.
const TYPE_ORDER: FacilityType[] = [
  'meeting_room', 'conference_room', 'gym', 'desk', 'swimming_pool', 'other',
];

const STATUS_COLOR: Record<BookingStatus, string> = {
  approved:  '#1a3a6e',
  pending:   '#f59e0b',
  rejected:  '#94a3b8',
  cancelled: '#cbd5e1',
  completed: '#10b981',
};
const STATUS_LABEL: Record<BookingStatus, string> = {
  approved:  'Approved',
  pending:   'Pending',
  rejected:  'Rejected',
  cancelled: 'Cancelled',
  completed: 'Completed',
};

function localYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}
function tsOf(s: string): number { return new Date(s.replace(' ', 'T')).getTime(); }

// Heatmap colour scale: green (0%) → yellow (~50%) → red (100%) with a
// smooth HSL hue rotation, so every single percentage step picks up a
// distinct shade. Saturation and lightness shift too so the visual weight
// grows with occupancy — light pastel green at 5% reads very different
// from deep crimson at 100%.
function heatColor(pct: number): { fill: string; isDark: boolean } {
  const p = Math.max(0, Math.min(1, pct));
  const hue   = 130 - p * 130;       // 130 (green) → 60 (yellow @ 50%) → 0 (red)
  const sat   = 55 + p * 30;         // 55% → 85% — fuller colour as it fills
  const light = 72 - p * 28;         // 72% → 44% — darker toward red
  return {
    fill: `hsl(${hue.toFixed(0)}, ${sat.toFixed(0)}%, ${light.toFixed(0)}%)`,
    // Cells past ~55% utilisation are dark enough that white text reads better.
    isDark: p > 0.55,
  };
}

// Scoped CSS overrides for react-calendar-timeline.
//
// Important: do NOT override layout properties (width, padding, position) on
// .rct-sidebar-row / .rct-header-root / .rct-sidebar — the lib calculates
// the sidebar width and row heights internally and uses these same class
// names for the header's left slot AND each body row. Restyling padding
// here shifts the header out of alignment with the rows. Only colour and
// typography are safe to change.
const TIMELINE_CSS = `
  .fm-tl .react-calendar-timeline { border: 0; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  .fm-tl .rct-header-root { background: hsl(var(--muted)) !important; border-bottom: 1px solid hsl(var(--border)) !important; }
  .fm-tl .rct-sidebar { background: hsl(var(--card)); border-right: 1px solid hsl(var(--border)); }
  .fm-tl .rct-sidebar-row { font-size: 13px; font-weight: 500; color: hsl(var(--foreground)); border-bottom: 1px solid hsl(var(--border)); }
  .fm-tl .rct-sidebar-row-odd  { background: hsl(var(--card)); }
  .fm-tl .rct-sidebar-row-even { background: hsl(var(--muted) / 0.3); }
  .fm-tl .rct-vertical-lines .rct-vl       { border-left: 1px solid hsl(var(--border) / 0.6); }
  .fm-tl .rct-vertical-lines .rct-vl-first { border-left: 1px solid hsl(var(--border)); }
  .fm-tl .rct-horizontal-lines .rct-hl-odd  { background: hsl(var(--card)); }
  .fm-tl .rct-horizontal-lines .rct-hl-even { background: hsl(var(--muted) / 0.3); }
  .fm-tl .rct-dateHeader { color: hsl(var(--muted-foreground)); font-size: 11px; border-bottom: 1px solid hsl(var(--border)); }
  .fm-tl .rct-dateHeader-primary { color: hsl(var(--foreground)); font-weight: 600; }
  .fm-tl .rct-item { border: 0 !important; padding: 0 !important; overflow: hidden; }
  .fm-tl .rct-item:hover { z-index: 5 !important; }
  .fm-tl .rct-today-marker { background: #dc2626 !important; width: 2px !important; }
  .fm-tl .rct-cursor-line { z-index: 4 !important; }
  .fm-tl .rct-horizontal-lines .rct-hl-odd,
  .fm-tl .rct-horizontal-lines .rct-hl-even { z-index: 1 !important; }
  .fm-tl .rct-vertical-lines .rct-vl { z-index: 1 !important; }
  /* Full-row darker tint for type-header rows. horizontalLineClassNamesForGroup
     stamps this class on both the sidebar row band AND the chart-area band so
     the section colour reads end-to-end, not just in the sidebar. */
  .fm-tl .rct-hl-fm-type-header,
  .fm-tl .rct-sidebar-row.rct-fm-type-header {
    background: hsl(var(--primary) / 0.10) !important;
    border-top:    1px solid hsl(var(--primary) / 0.25) !important;
    border-bottom: 1px solid hsl(var(--primary) / 0.25) !important;
  }
`;

export default function GanttTimeline() {
  const { user } = useAuth();
  const isSuper = user?.role === 'super_admin';

  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<number | ''>('');
  // F08 - super admins only: pick which tenant to view (or all tenants).
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState<number | ''>('');
  const [date, setDate] = useState<string>(() => localYmd(new Date()));
  const [data, setData] = useState<GanttPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [visibleStart, setVisibleStart] = useState<number>(() => defaultVisibleStart(localYmd(new Date())));
  const [visibleEnd,   setVisibleEnd]   = useState<number>(() => defaultVisibleStart(localYmd(new Date())) + VISIBLE_HOURS * HOUR_MS);

  // Per-type collapse state for the sectioned sidebar. Default = everything
  // expanded; clicking a type header hides its facilities until clicked again.
  // Persisted in localStorage so admins don't lose their layout on reload.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem('ganttCollapsedTypes');
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem('ganttCollapsedTypes', JSON.stringify(collapsed)); } catch { /* private mode */ }
  }, [collapsed]);
  function toggleType(t: FacilityType) {
    setCollapsed((prev) => ({ ...prev, [t]: !prev[t] }));
  }

  useEffect(() => {
    sitesApi.list({ limit: 100 }).then((r) => setSites(r.data?.data || []));
    if (isSuper) {
      tenantsApi.list({ limit: 200 }).then((r) => setTenants((r.data?.data || []) as Tenant[]));
    }
  }, [isSuper]);

  // When the super_admin switches tenant, the site list is no longer
  // valid (sites belong to tenants). Clear it so the user can re-pick.
  useEffect(() => { setSiteId(''); }, [tenantId]);

  const { from, to } = useMemo(() => {
    const d = new Date(date + 'T00:00:00');
    return { from: localYmd(d), to: localYmd(new Date(d.getTime() + DAY_MS)) };
  }, [date]);

  useEffect(() => {
    const start = defaultVisibleStart(date);
    setVisibleStart(start);
    setVisibleEnd(start + VISIBLE_HOURS * HOUR_MS);
  }, [date]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    dashboardsApi.gantt({
      site_id: siteId || undefined,
      tenant_id: isSuper ? (tenantId || undefined) : undefined,
      from, to,
    })
      .then((r) => { if (alive && r.status) setData(r.data || null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [siteId, tenantId, isSuper, from, to]);

  function shiftDay(delta: number) {
    const d = new Date(date + 'T00:00:00');
    setDate(localYmd(new Date(d.getTime() + delta * DAY_MS)));
  }

  // Build a sectioned group list: one HEADER row per facility type, then
  // its facilities listed underneath. The library doesn't natively support
  // tree groups, so we fake it by interleaving header rows with facility
  // rows and styling them differently in groupRenderer.
  //
  // Header IDs are namespaced (`type-meeting_room`) so they can't collide
  // with real numeric facility IDs that items attach to.
  //
  // Collapsing a section drops the facility rows from the list entirely
  // (and the items along with them — items orphaned to a missing group
  // simply don't render in react-calendar-timeline). The header row stays
  // visible so the section can be re-expanded.
  const groups = useMemo(() => {
    if (!data) return [];
    // Bucket facilities by type, preserving the typed display order.
    const byType = new Map<FacilityType, typeof data.facilities>();
    for (const f of data.facilities) {
      const t = (f.type || 'other') as FacilityType;
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t)!.push(f);
    }
    const out: Array<{
      id: number | string; title: string;
      _isHeader?: boolean; _type?: FacilityType; _count?: number;
    }> = [];
    for (const t of TYPE_ORDER) {
      const list = byType.get(t);
      if (!list || list.length === 0) continue;
      // No per-group height — every row uses the same lineHeight set on
      // the <Timeline> component so the visual rhythm stays consistent
      // whether you're looking at a header, an indented facility, or a
      // mix.
      out.push({
        id: 'type-' + t,
        title: TYPE_LABEL[t] || t,
        _isHeader: true,
        _type: t,
        _count: list.length,
      });
      if (!collapsed[t]) {
        for (const f of list) {
          out.push({ id: f.id, title: f.name });
        }
      }
    }
    return out;
  }, [data, collapsed]);

  // Real booking bars, attached to their facility rows.
  const bookingItems = useMemo(() => {
    if (!data) return [];
    return data.items.map((it) => ({
      id: it.id,
      group: it.facility_id,
      title: it.booker_name || it.title || ('Booking #' + it.id),
      start_time: tsOf(it.start_at),
      end_time:   tsOf(it.end_at),
      _status: it.status,
      _booker: it.booker_name,
      _bookingTitle: it.title,
    }));
  }, [data]);

  // Heatmap layer: one item per (type, hour) cell on the TYPE-HEADER row,
  // shaded by what fraction of that type's facilities are booked during
  // that hour. 11 meeting rooms, 3 booked at 7pm → 27% opacity cell.
  //
  // Sits on header rows only — so when a section is collapsed and only its
  // header is visible, the heatmap density survives. Booking bars on
  // facility rows are untouched.
  const heatmapItems = useMemo(() => {
    if (!data) return [];
    // type → list of facility ids
    const byType = new Map<FacilityType, number[]>();
    for (const f of data.facilities) {
      const t = (f.type || 'other') as FacilityType;
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t)!.push(f.id);
    }
    // Only "live" bookings count toward utilisation. Cancelled/rejected
    // don't, since they don't actually block a room.
    const live = data.items.filter((i) =>
      i.status === 'approved' || i.status === 'pending' || i.status === 'completed'
    );
    const dayStart = new Date(date + 'T00:00:00').getTime();
    const out: Array<{
      id: string; group: string; title: string;
      start_time: number; end_time: number;
      _isHeatmap: true; _pct: number; _booked: number; _total: number;
    }> = [];
    for (const [t, facIds] of byType) {
      const total = facIds.length;
      if (total === 0) continue;
      const facSet = new Set(facIds);
      for (let h = 0; h < 24; h++) {
        const hStart = dayStart + h * HOUR_MS;
        const hEnd   = hStart + HOUR_MS;
        const booked = new Set<number>();
        for (const b of live) {
          if (!facSet.has(b.facility_id)) continue;
          const bs = tsOf(b.start_at);
          const be = tsOf(b.end_at);
          if (bs < hEnd && be > hStart) booked.add(b.facility_id);
        }
        if (booked.size === 0) continue;  // skip empty cells to keep item count down
        out.push({
          id: 'heat-' + t + '-' + h,
          group: 'type-' + t,
          title: '',                      // never displayed
          start_time: hStart,
          end_time:   hEnd,
          _isHeatmap: true,
          _pct: booked.size / total,
          _booked: booked.size,
          _total: total,
        });
      }
    }
    return out;
  }, [data, date]);

  // Merge heatmap cells + real bookings. Order doesn't matter for the lib —
  // each item attaches to its group via `group` and is rendered there.
  const items = useMemo(() => [...heatmapItems, ...bookingItems], [heatmapItems, bookingItems]);

  function handleItemClick(itemId: number | string) {
    const id = typeof itemId === 'string' ? Number(itemId) : itemId;
    if (Number.isFinite(id)) setSelectedId(id);
  }

  function handleTimeChange(start: number, end: number) {
    setVisibleStart(start);
    setVisibleEnd(end);
  }

  const selectedItem: GanttItem | null = useMemo(() => {
    if (!selectedId || !data) return null;
    return data.items.find((i) => i.id === selectedId) || null;
  }, [selectedId, data]);
  const selectedFacility: string = useMemo(() => {
    if (!selectedItem || !data) return '';
    return data.facilities.find((f) => f.id === selectedItem.facility_id)?.name || '';
  }, [selectedItem, data]);

  // Custom item renderer: rounded + padded + booker + "HH:mm – HH:mm" when room.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function itemRenderer({ item, itemContext, getItemProps }: any) {
    // Heatmap cell on a type-header row — translucent grey scaled by
    // utilisation. Not clickable, no border, no label — it's a background
    // shade meant to read at a glance.
    if (item._isHeatmap) {
      // Green → yellow → red gradient driven by the cell's utilisation. Every
      // percentage step nudges the hue/lightness, so admins can read load at
      // a glance without needing a tooltip.
      const { fill, isDark } = heatColor(item._pct);
      const tipTitle = `${item._booked}/${item._total} booked  ·  ${Math.round(item._pct * 100)}%`;
      const props = getItemProps({
        style: {
          background: fill,
          border: 'none',
          borderRadius: 4,
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.35)',
          cursor: 'default',
          pointerEvents: 'none',          // don't intercept clicks
          padding: 0,
        },
        title: tipTitle,
      });
      return (
        <div {...props}>
          {itemContext.dimensions.width > 38 && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: '100%', width: '100%',
              fontSize: 10, fontWeight: 700,
              color: isDark ? 'rgba(255,255,255,0.95)' : 'rgba(15,23,42,0.80)',
              textShadow: isDark ? '0 1px 1px rgba(0,0,0,0.25)' : 'none',
              letterSpacing: '0.02em',
            }}>
              {item._booked}/{item._total}
            </div>
          )}
        </div>
      );
    }

    const status = (item._status || 'approved') as BookingStatus;
    const bg = STATUS_COLOR[status];
    const showTime = itemContext.dimensions.width > 110;
    const showBooker = itemContext.dimensions.width > 50;
    const startLabel = moment(item.start_time).format('HH:mm');
    const endLabel   = moment(item.end_time).format('HH:mm');
    const style: CSSProperties = {
      background: bg,
      color: '#fff',
      border: 'none',
      borderRadius: 6,
      boxShadow: itemContext.selected ? '0 0 0 2px #fff, 0 0 0 4px ' + bg : '0 1px 3px rgba(0,0,0,0.15)',
      padding: '4px 8px',
      cursor: 'pointer',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      fontSize: 12,
      lineHeight: 1.25,
    };
    const props = getItemProps({ style });
    return (
      <div {...props}>
        {showBooker && (
          <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {item._booker || item._bookingTitle || ('Booking #' + item.id)}
          </div>
        )}
        {showTime && (
          <div style={{ opacity: 0.85, fontSize: 10, whiteSpace: 'nowrap' }}>
            {startLabel} – {endLabel}
          </div>
        )}
      </div>
    );
  }

  // Custom sidebar group renderer.
  // Returns ONLY the inner content - the library already wraps it in an
  // element with class rct-sidebar-row and the correct width/height. Adding
  // another wrapper with that class (as we did originally) caused the body
  // sidebar rows to expand wider than the header's "Facility" slot and the
  // whole thing went out of alignment.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function groupRenderer({ group }: any) {
    // Type header row — vivid brand-coloured band, clickable to collapse.
    // The accent strip on the left + filled background make it read as a
    // section divider even at the same row height as the facilities under it.
    if (group._isHeader) {
      const t = group._type as FacilityType;
      const isCollapsed = !!collapsed[t];
      return (
        <div
          onClick={(e) => { e.stopPropagation(); toggleType(t); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '0 10px 0 0',
            height: '100%', width: '100%',
            background: 'linear-gradient(to right, hsl(var(--primary) / 0.18), hsl(var(--primary) / 0.06))',
            borderTop: '1px solid hsl(var(--primary) / 0.25)',
            borderBottom: '1px solid hsl(var(--primary) / 0.25)',
            cursor: 'pointer',
            fontSize: 12, fontWeight: 700,
            letterSpacing: '0.03em',
            color: 'hsl(var(--primary))',
          }}
        >
          {/* Solid colour stripe on the very left so the header reads as a
              divider band even at a glance. */}
          <span style={{
            width: 4, alignSelf: 'stretch',
            background: 'hsl(var(--primary))',
            marginRight: 8,
          }} />
          {isCollapsed
            ? <ChevronRight size={14} style={{ flexShrink: 0 }} />
            : <ChevronDown  size={14} style={{ flexShrink: 0 }} />}
          <span style={{
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            flex: 1, textTransform: 'uppercase',
          }}>
            {group.title}
          </span>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            // fontSize: 10, fontWeight: 700,
            padding: '2px 8px', borderRadius: '50%',
            background: 'hsl(var(--primary))',
            height : '50%',
            width : '20px',
            //color: 'hsl(var(--primary-foreground))',
          }}>
               <span style={{
               
            // fontSize: 10, fontWeight: 700,
            // padding: '2px 8px', borderRadius: '50%',
            // background: 'hsl(var(--primary))',
            // height : '50%',
            // width : '20px',
            // textAlign:'center',
            color: 'hsl(var(--primary-foreground))',
          }}>
            {group._count}
          </span>
            </div>       
        </div>
      );
    }

    // Regular facility row — deeper indent, smaller text, lighter icon
    // so the hierarchy reads at a glance.
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '0 12px 0 32px',         // deep left indent
        height: '100%', width: '100%',
      }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 18, height: 18, borderRadius: 4,
          background: 'hsl(var(--primary) / 0.08)',
          color: 'hsl(var(--primary) / 0.85)',
          flexShrink: 0,
        }}>
          <Building size={10} />
        </span>
        <span style={{
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          fontSize: 12,                    // smaller than header (12 vs 12 — but header is uppercase + bold)
          color: 'hsl(var(--foreground) / 0.85)',
          fontWeight: 500,
        }}>
          {group.title}
        </span>
      </div>
    );
  }
  // ChevronUp is reserved for a future "collapse all" affordance — silence
  // the unused-import warning until then.
  void ChevronUp;

  return (
    <div>
      <style>{TIMELINE_CSS}</style>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
        {/* F08 - super_admin tenant picker. Hidden for everyone else. */}
        {isSuper && (
          <select className="h-9 rounded border border-input bg-background px-2 text-sm w-full sm:w-auto sm:min-w-[200px]"
            value={tenantId} onChange={(e) => setTenantId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">All tenants</option>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        <select className="h-9 rounded border border-input bg-background px-2 text-sm w-full sm:w-auto sm:min-w-[180px]"
          value={siteId} onChange={(e) => setSiteId(e.target.value ? Number(e.target.value) : '')}>
          <option value="">All sites</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        <div className="inline-flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={() => shiftDay(-1)} aria-label="Previous day">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Input type="date"
            value={date}
            onChange={(e) => setDate(e.target.value || localYmd(new Date()))}
            className="w-auto" />
          <Button size="sm" variant="outline" onClick={() => shiftDay(1)} aria-label="Next day">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <Button size="sm" variant="ghost" className="sm:ml-auto"
          onClick={() => setDate(localYmd(new Date()))}>
          Today
        </Button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-6">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      )}

      {!loading && groups.length === 0 && (
        <div className="empty-state">No active facilities in that scope.</div>
      )}

      {!loading && groups.length > 0 && (
        <div
          className="panel p-0 overflow-hidden fm-tl"
          // The lib paints internal elements at z-index 40 (.rct-hl-*),
          // 51 (.rct-cursor-line) and 88 (.rct-item:hover) - all above
          // AppLayout's fixed navbar (z-30). Without a new stacking
          // context those poke through the navbar when the page scrolls.
          // `isolation: isolate` opens a fresh stacking context so any
          // z-index inside this panel can't paint above its siblings.
          style={{ isolation: 'isolate', position: 'relative', zIndex: 0 }}>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <Timeline
            groups={groups as any}
            items={items as any}
            visibleTimeStart={visibleStart}
            visibleTimeEnd={visibleEnd}
            onTimeChange={handleTimeChange}
            onItemSelect={handleItemClick}
            onItemClick={handleItemClick}
            // Uniform row height across the whole chart — applies to type
            // headers and the facilities under them so the visual rhythm
            // stays consistent. 44 is the sweet spot: tall enough to show
            // booker + time inside a booking bar, short enough to keep the
            // chart dense.
            lineHeight={44}
            itemHeightRatio={0.78}
            stackItems
            canMove={false}
            canResize={false}
            canChangeGroup={false}
            sidebarWidth={200}
            itemRenderer={itemRenderer}
            groupRenderer={groupRenderer}
            // Stamp the type-header rows with a custom class so we can tint
            // the entire row band (sidebar + chart area) via TIMELINE_CSS.
            // The lib applies whatever array we return to BOTH the
            // horizontal-line band and the sidebar row, which is exactly
            // what we need for a full-row colour.
            /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
            horizontalLineClassNamesForGroup={((group: any) =>
              group._isHeader ? ['rct-fm-type-header', 'rct-hl-fm-type-header'] : []
            ) as any}
          >
            {/* Do NOT set position:sticky on TimelineHeaders - the lib
                relies on absolute-positioned children inside the headers
                root and sticky breaks the sidebar/timeline column sync. */}
            <TimelineHeaders className="rct-header-root">
              <SidebarHeader>
                {({ getRootProps }) => {
                  // getRootProps returns the correct width (=== sidebarWidth)
                  // - don't overwrite it. Apply our look-and-feel via the
                  //   `style` arg to getRootProps, which merges.
                  const rootProps = getRootProps({
                    style: {
                      background: 'hsl(var(--muted))',
                      borderRight: '1px solid hsl(var(--border))',
                      display: 'flex',
                      alignItems: 'center',
                      padding: '0 12px',
                      fontWeight: 700,
                      fontSize: 12,
                      color: 'hsl(var(--muted-foreground))',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    },
                  });
                  return <div {...rootProps}>Facility</div>;
                }}
              </SidebarHeader>
              <DateHeader
                unit="primaryHeader"
                /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
                labelFormat={((interval: [moment.Moment, moment.Moment]) =>
                  interval[0].format('dddd, D MMMM YYYY')) as any}
              />
              <DateHeader
                unit="hour"
                /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
                labelFormat={((interval: [moment.Moment, moment.Moment]) =>
                  interval[0].format('HH:mm')) as any}
              />
            </TimelineHeaders>
            <TodayMarker />
          </Timeline>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <i className="inline-block w-3 h-3 rounded" style={{ background: STATUS_COLOR.approved }} /> Approved
        </span>
        <span className="flex items-center gap-1">
          <i className="inline-block w-3 h-3 rounded" style={{ background: STATUS_COLOR.pending }} /> Pending
        </span>
        <span className="flex items-center gap-1">
          <i className="inline-block w-3 h-3 rounded" style={{ background: STATUS_COLOR.completed }} /> Completed
        </span>
        <span className="flex items-center gap-1">
          <i className="inline-block w-3 h-3 rounded" style={{ background: STATUS_COLOR.rejected }} /> Rejected
        </span>
        <span className="flex items-center gap-1">
          <i className="inline-block w-[2px] h-3" style={{ background: '#dc2626' }} /> Now
        </span>
        {/* Heatmap colour-scale legend: green (free) → yellow (busy) → red (full). */}
        <span className="flex items-center gap-1">
          <i
            className="inline-block h-3 w-16 rounded"
            style={{
              background:
                'linear-gradient(to right, ' +
                heatColor(0).fill + ', ' +
                heatColor(0.5).fill + ', ' +
                heatColor(1).fill + ')',
            }}
          />
          <span>Utilisation</span>
          <span className="opacity-70">(0% → 100%)</span>
        </span>
        <span className="sm:ml-auto">Drag to pan · scroll to zoom · click a bar for details</span>
      </div>

      {selectedItem && (
        <BookingDetailsModal
          item={selectedItem}
          facilityName={selectedFacility}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

function BookingDetailsModal({ item, facilityName, onClose }: {
  item: GanttItem;
  facilityName: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-foreground/40"
      onClick={onClose}>
      <div
        className="bg-card border rounded-lg shadow-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b p-4">
          <div className="min-w-0">
            <h3 className="font-semibold truncate">Booking #{item.id}</h3>
            <p className="text-xs text-muted-foreground truncate">{facilityName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted-foreground hover:text-foreground p-1 rounded">
            <X className="h-4 w-4" />
          </button>
        </div>
        <dl className="p-4 grid grid-cols-[110px_1fr] gap-y-2 gap-x-3 text-sm">
          <dt className="text-muted-foreground">Title</dt>
          <dd>{item.title || <span className="text-muted-foreground italic">(untitled)</span>}</dd>
          <dt className="text-muted-foreground">Booker</dt>
          <dd>{item.booker_name || <span className="text-muted-foreground italic">unknown</span>}</dd>
          <dt className="text-muted-foreground">Start</dt>
          <dd className="font-mono">{moment(item.start_at.replace(' ', 'T')).format('ddd D MMM YYYY · HH:mm')}</dd>
          <dt className="text-muted-foreground">End</dt>
          <dd className="font-mono">{moment(item.end_at.replace(' ', 'T')).format('ddd D MMM YYYY · HH:mm')}</dd>
          <dt className="text-muted-foreground">Status</dt>
          <dd>
            <span className="chip" style={{ background: STATUS_COLOR[item.status], color: '#fff' }}>
              {STATUS_LABEL[item.status]}
            </span>
          </dd>
        </dl>
        <div className="border-t p-3 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}
// int/no-explicit-any */
//             horizontalLineClassNamesForGroup={((group: any) =>
//               group._isHeader ? ['rct-fm-type-header', 'rct-hl-fm-type-header'] : []
//             ) as any}
//           >
//             <TimelineHeaders className="rct-header-root">
//               <SidebarHeader>
//                 {({ getRootProps }) => {
//                   const rootProps = getRootProps({
//                     style: {
//                       background: 'hsl(var(--muted))',
//                       borderRight: '1px solid hsl(var(--border))',
//                       display: 'flex',
//                       alignItems: 'center',
//                       padding: '0 12px',
//                       fontWeight: 700,
//                       fontSize: 12,
//                       color: 'hsl(var(--muted-foreground))',
//                       textTransform: 'uppercase',
//                       letterSpacing: '0.04em',
//                     },
//                   });
//                   return <div {...rootProps}>Facility</div>;
//                 }}
//               </SidebarHeader>
//               <DateHeader
//                 unit="primaryHeader"
//                 /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
//                 labelFormat={((interval: [moment.Moment, moment.Moment]) =>
//                   interval[0].format('dddd, D MMMM YYYY')) as any}
//               />
//               <DateHeader
//                 unit="hour"
//                 /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
//                 labelFormat={((interval: [moment.Moment, moment.Moment]) =>
//                   interval[0].format('HH:mm')) as any}
//               />
//             </TimelineHeaders>
//             <TodayMarker />
//           </Timeline>
//         </div>
//       )}

//       <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
//         <span className="flex items-center gap-1">
//           <i className="inline-block w-3 h-3 rounded" style={{ background: STATUS_COLOR.approved }} /> Approved
//         </span>
//         <span className="flex items-center gap-1">
//           <i className="inline-block w-3 h-3 rounded" style={{ background: STATUS_COLOR.pending }} /> Pending
//         </span>
//         <span className="flex items-center gap-1">
//           <i className="inline-block w-3 h-3 rounded" style={{ background: STATUS_COLOR.completed }} /> Completed
//         </span>
//         <span className="flex items-center gap-1">
//           <i className="inline-block w-3 h-3 rounded" style={{ background: STATUS_COLOR.rejected }} /> Rejected
//         </span>
//         <span className="flex items-center gap-1">
//           <i className="inline-block w-[2px] h-3" style={{ background: '#dc2626' }} /> Now
//         </span>
//         <span className="flex items-center gap-1">
//           <i className="inline-block w-3 h-3" style={{ background: 'linear-gradient(to right, rgba(15,23,42,0.05), rgba(15,23,42,0.55))' }} />
//           Heatmap: cell shade = % of type booked
//         </span>
//         <span className="sm:ml-auto">Click a type header to collapse · drag to pan · scroll to zoom</span>
//       </div>

//       {selectedItem && (
//         <BookingDetailsModal
//           item={selectedItem}
//           facilityName={selectedFacility}
//           onClose={() => setSelectedId(null)}
//         />
//       )}
//     </div>
//   );
// }
// BookingDetailsModal
//           item={selectedItem}
//           facilityName={selectedFacility}
//           onClose={() => setSelectedId(null)}
//         />
//       )}
//     </div>
//   );
// }

// function BookingDetailsModal({ item, facilityName, onClose }: {
//   item: GanttItem;
//   facilityName: string;
//   onClose: () => void;
// }) {
//   return (
//     <div
//       className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-foreground/40"
//       onClick={onClose}>
//       <div
//         className="bg-card border rounded-lg shadow-xl w-full max-w-md"
//         onClick={(e) => e.stopPropagation()}>
//         <div className="flex items-start justify-between border-b p-4">
//           <div className="min-w-0">
//             <h3 className="font-semibold truncate">Booking #{item.id}</h3>
//             <p className="text-xs text-muted-foreground truncate">{facilityName}</p>
//           </div>
//           <button
//             type="button"
//             onClick={onClose}
//             aria-label="Close"
//             className="text-muted-foreground hover:text-foreground p-1 rounded">
//             <X className="h-4 w-4" />
//           </button>
//         </div>
//         <dl className="p-4 grid grid-cols-[110px_1fr] gap-y-2 gap-x-3 text-sm">
//           <dt className="text-muted-foreground">Title</dt>
//           <dd>{item.title || <span className="text-muted-foreground italic">(untitled)</span>}</dd>
//           <dt className="text-muted-foreground">Booker</dt>
//           <dd>{item.booker_name || <span className="text-muted-foreground italic">unknown</span>}</dd>
//           <dt className="text-muted-foreground">Start</dt>
//           <dd className="font-mono">{moment(item.start_at.replace(' ', 'T')).format('ddd D MMM YYYY · HH:mm')}</dd>
//           <dt className="text-muted-foreground">End</dt>
//           <dd className="font-mono">{moment(item.end_at.replace(' ', 'T')).format('ddd D MMM YYYY · HH:mm')}</dd>
//           <dt className="text-muted-foreground">Status</dt>
//           <dd>
//             <span className="chip" style={{ background: STATUS_COLOR[item.status], color: '#fff' }}>
//               {STATUS_LABEL[item.status]}
//             </span>
//           </dd>
//         </dl>
//         <div className="border-t p-3 flex justify-end gap-2">
//           <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
//         </div>
//       </div>
//     </div>
//   );
// }
