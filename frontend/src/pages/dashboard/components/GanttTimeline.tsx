// F08 - Gantt timeline (single-day, exact 15-minute grid).
//
// Grid lines are drawn as two stacked `repeating-linear-gradient` layers
// so they're pixel-perfect at ANY total width - the old absolute-positioned
// per-cell <div> approach drifted at later hours due to sub-pixel rounding.
//   - Hour lines: every 100% / 24, darker
//   - Quarter lines: every 100% / 96, faint
// The right edge is closed off with an explicit border-right so the 24:00
// boundary is visible.
//
// Click a bar -> opens an in-page details modal (no hover-only tooltips).

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Loader2, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { dashboardsApi, type GanttPayload, type GanttItem } from '@/api/dashboards.api';
import { sitesApi } from '@/api/sites.api';
import type { Site, BookingStatus } from '@/types';

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

const MIN_TIMELINE_PX = 1536;

// Local-date YYYY-MM-DD (no UTC drift from toISOString()).
function localYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

// Hour grid: solid 1px line every (100% / 24).
// Quarter grid: faint 1px line every (100% / 96).
// Both gradients hit position 0 of each cycle so quarter+hour stripes
// coincide at hour boundaries (the hour layer composites darker on top).
const GRID_BG: CSSProperties = {
  backgroundImage:
    'repeating-linear-gradient(to right, rgba(15,23,42,0.13) 0 1px, transparent 1px calc(100% / 24)), ' +
    'repeating-linear-gradient(to right, rgba(15,23,42,0.05) 0 1px, transparent 1px calc(100% / 96))',
  borderRight: '1px solid rgba(15,23,42,0.13)',
};

const HEADER_BG: CSSProperties = {
  backgroundImage:
    'repeating-linear-gradient(to right, rgba(15,23,42,0.13) 0 1px, transparent 1px calc(100% / 24))',
  borderRight: '1px solid rgba(15,23,42,0.13)',
};

export default function GanttTimeline() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<number | ''>('');
  const [date, setDate] = useState<string>(() => localYmd(new Date()));
  const [data, setData] = useState<GanttPayload | null>(null);
  const [loading, setLoading] = useState(false);

  // Click-to-open modal state
  const [selected, setSelected] = useState<GanttItem | null>(null);
  const [selectedFacility, setSelectedFacility] = useState<string>('');

  useEffect(() => {
    sitesApi.list({ limit: 100 }).then((r) => setSites(r.data?.data || []));
  }, []);

  const { from, to } = useMemo(() => {
    const d = new Date(date + 'T00:00:00');
    const next = new Date(d.getTime() + 24 * 60 * 60 * 1000);
    return { from: localYmd(d), to: localYmd(next) };
  }, [date]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    dashboardsApi.gantt({ site_id: siteId || undefined, from, to })
      .then((r) => { if (alive && r.status) setData(r.data || null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [siteId, from, to]);

  function shiftDay(delta: number) {
    const d = new Date(date + 'T00:00:00');
    setDate(localYmd(new Date(d.getTime() + delta * 24 * 60 * 60 * 1000)));
  }

  function tsOf(s: string): number {
    return new Date(s.replace(' ', 'T')).getTime();
  }

  function position(item: GanttItem): { left: number; width: number } | null {
    const start = tsOf(item.start_at);
    const end   = tsOf(item.end_at);
    const dayStart = new Date(from + 'T00:00:00').getTime();
    const dayEnd   = dayStart + 24 * 60 * 60 * 1000;
    if (end <= dayStart || start >= dayEnd) return null;
    const cs = Math.max(start, dayStart);
    const ce = Math.min(end,   dayEnd);
    const total = dayEnd - dayStart;
    return {
      left:  ((cs - dayStart) / total) * 100,
      width: Math.max(0.25, ((ce - cs) / total) * 100),
    };
  }

  function openDetails(it: GanttItem, facilityName: string) {
    setSelected(it);
    setSelectedFacility(facilityName);
  }

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-4">
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

      {!loading && data && data.facilities.length === 0 && (
        <div className="empty-state">No active facilities in that scope.</div>
      )}

      {!loading && data && data.facilities.length > 0 && (
        <div className="panel overflow-x-auto">
          {/* Header tick row: 24-col CSS grid for exact label alignment +
              gradient lines that line up with the body grid below. */}
          <div className="grid grid-cols-[120px_1fr] sm:grid-cols-[180px_1fr] border-b bg-muted/40">
            <div className="px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground font-semibold">
              Facility
            </div>
            <div className="relative h-8" style={{ minWidth: MIN_TIMELINE_PX, ...HEADER_BG }}>
              <div className="absolute inset-0 grid" style={{ gridTemplateColumns: 'repeat(24, 1fr)' }}>
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="text-[10px] text-muted-foreground flex items-center pl-1.5">
                    {String(h).padStart(2, '0')}:00
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Rows */}
          {data.facilities.map((f) => {
            const fItems = data.items.filter((i) => i.facility_id === f.id);
            return (
              <div key={f.id} className="grid grid-cols-[120px_1fr] sm:grid-cols-[180px_1fr] border-b">
                <div className="px-3 py-3 text-sm font-medium truncate" title={f.name}>{f.name}</div>
                <div className="relative" style={{ height: 44, minWidth: MIN_TIMELINE_PX, ...GRID_BG }}>
                  {fItems.map((it) => {
                    const pos = position(it);
                    if (!pos) return null;
                    return (
                      <button
                        key={it.id}
                        type="button"
                        onClick={() => openDetails(it, f.name)}
                        className="gantt-cell border-0 hover:opacity-90 active:scale-[0.99] transition-transform"
                        style={{
                          left:  pos.left + '%',
                          width: pos.width + '%',
                          top: 8,
                          background: STATUS_COLOR[it.status],
                          zIndex: 1,
                        }}>
                        <span className="pl-2 text-xs">
                          {it.booker_name || it.title || '#' + it.id}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Legend */}
      {!loading && data && data.facilities.length > 0 && (
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
          <span className="sm:ml-auto">15-minute grid · click a bar for details</span>
        </div>
      )}

      {/* Click-bar details modal */}
      {selected && (
        <BookingDetailsModal
          item={selected}
          facilityName={selectedFacility}
          onClose={() => setSelected(null)}
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
      <div className="bg-card border rounded-lg shadow-xl w-full max-w-md"
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
          <dd className="font-mono">{item.start_at}</dd>
          <dt className="text-muted-foreground">End</dt>
          <dd className="font-mono">{item.end_at}</dd>
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
