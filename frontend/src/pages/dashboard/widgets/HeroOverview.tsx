// Top hero card — dark teal gradient, "Facility booking overview".
// Shows live clock, site filter dropdown, range toggle (7/30/90 days), and
// right-side circular occupancy gauge + 3-line status breakdown.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Check, ChevronDown, Globe } from 'lucide-react';
import { getHeroOverview, SAMPLE_DATA_BANNER, type HeroOverview as HeroOverviewData } from '../sampleData';
import type { Site } from '@/types';
import type { DashboardRange } from '../useLiveDashboardData';

type PresetDays = 7 | 30 | 90;
const PRESET_DAYS: readonly PresetDays[] = [7, 30, 90] as const;
// Hard cap on the custom range to protect the backend from a stray "pick 10
// years" that would scan half the bookings table. Two years comfortably
// covers quarterly / annual reviews.
const CUSTOM_MAX_DAYS = 730;

interface Props {
  // Fields fetched from the real backend. Any field present here wins
  // over the mock value from sampleData.ts; everything else keeps the
  // sample fallback so the widget never renders half-empty.
  liveOverlay?: Partial<HeroOverviewData>;
  // True when at least one real field was supplied — used to drop the
  // "SAMPLE DATA" badge once we're on live data.
  isLive?: boolean;
  // Site dropdown — populated from sitesApi.list() in the parent page.
  sites?: Site[];
  selectedSiteId?: number | null;
  onSiteChange?: (siteId: number | null) => void;
  // Date-window picker — controlled by the parent so the hook knows what
  // to request from gantt / peakTimes / etc.
  range?: DashboardRange;
  onRangeChange?: (next: DashboardRange) => void;
}

export function HeroOverview({
  liveOverlay,
  isLive,
  sites = [],
  selectedSiteId = null,
  onSiteChange,
  range,
  onRangeChange,
}: Props = {}) {
  const data = getHeroOverview(liveOverlay);

  // Local fallback when the parent isn't controlling the range (e.g. the
  // storybook / preview harness mounts the hero standalone).
  const [localRange, setLocalRange] = useState<DashboardRange>(
    range ?? { kind: 'preset', days: (data.rangeDays as PresetDays) ?? 30 }
  );
  const activeRange: DashboardRange = range ?? localRange;

  const [siteOpen, setSiteOpen] = useState(false);
  const siteWrapRef = useRef<HTMLDivElement | null>(null);

  // --- Custom-range popover state (open/close, draft from/to inputs). ---
  const [customOpen, setCustomOpen] = useState(false);
  const customWrapRef = useRef<HTMLDivElement | null>(null);
  const todayIso = useMemo(() => isoDateLocal(new Date()), []);
  // Draft values seed from the active range when the popover opens so the
  // user has a sensible starting point instead of blank inputs.
  const [draftFrom, setDraftFrom] = useState<string>('');
  const [draftTo, setDraftTo] = useState<string>('');
  const [draftError, setDraftError] = useState<string | null>(null);

  // Close dropdowns on outside click.
  useEffect(() => {
    if (!siteOpen) return;
    function onDoc(e: MouseEvent) {
      if (!siteWrapRef.current) return;
      if (!siteWrapRef.current.contains(e.target as Node)) setSiteOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [siteOpen]);

  useEffect(() => {
    if (!customOpen) return;
    function onDoc(e: MouseEvent) {
      if (!customWrapRef.current) return;
      if (!customWrapRef.current.contains(e.target as Node)) setCustomOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [customOpen]);

  // Circular gauge calculation.
  const R = 68;
  const CIRC = 2 * Math.PI * R;
  const dash = (data.occupiedPercent / 100) * CIRC;

  const selectedSite = sites.find((s) => s.id === selectedSiteId) || null;
  const siteLabel = selectedSite ? selectedSite.name : (data.siteFilter || 'All sites');

  function emitRange(next: DashboardRange): void {
    if (onRangeChange) onRangeChange(next);
    else setLocalRange(next);
  }

  function handlePresetPick(days: PresetDays): void {
    emitRange({ kind: 'preset', days });
    setCustomOpen(false);
  }

  function openCustomPopover(): void {
    // Seed draft inputs from the active range so the popover opens on
    // familiar numbers rather than blank fields.
    if (activeRange.kind === 'custom') {
      setDraftFrom(activeRange.from);
      setDraftTo(activeRange.to);
    } else {
      const to = todayIso;
      const from = isoDateLocal(addDaysLocal(new Date(), -(activeRange.days - 1)));
      setDraftFrom(from);
      setDraftTo(to);
    }
    setDraftError(null);
    setCustomOpen(true);
  }

  function applyCustomRange(): void {
    const err = validateCustomRange(draftFrom, draftTo, todayIso);
    if (err) { setDraftError(err); return; }
    emitRange({ kind: 'custom', from: draftFrom, to: draftTo });
    setCustomOpen(false);
  }

  function handleSitePick(id: number | null) {
    if (onSiteChange) onSiteChange(id);
    setSiteOpen(false);
  }

  return (
    <div className="relative rounded-2xl p-6 md:p-8 bg-gradient-to-br from-emerald-900 via-teal-800 to-emerald-700 dark:from-emerald-950 dark:via-teal-900 dark:to-emerald-900 text-white shadow-lg">
      {/* subtle grid pattern — wrapped in its own overflow-hidden layer
          so the hero itself doesn't clip the site dropdown when it opens
          beyond the hero's rounded corners. */}
      <div className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none">
        <div
          className="absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage: 'linear-gradient(white 1px, transparent 1px), linear-gradient(90deg, white 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
        />
      </div>

      <div className="relative flex flex-col lg:flex-row gap-6 lg:gap-10 lg:items-center justify-between">
        {/* Left: title + filters */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap text-xs">
            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-100">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 animate-pulse" />
              Live
            </span>
            <span className="text-emerald-100/80">{data.nowLabel}</span>
            {isLive ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-400/20 text-emerald-100 border border-emerald-300/30 text-[10px] font-semibold tracking-wide">
                LIVE DATA
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-400/20 text-amber-100 border border-amber-300/30 text-[10px] font-semibold tracking-wide">
                {SAMPLE_DATA_BANNER}
              </span>
            )}
          </div>

          <h1 className="mt-3 text-3xl md:text-4xl font-bold tracking-tight">
            Facility booking overview
          </h1>
          <p className="mt-1 text-sm text-emerald-100/80">
            {data.summary}
          </p>

          <div className="mt-5 flex items-center gap-3 flex-wrap">
            {/* Site filter — populated from sitesApi.list() */}
            <div ref={siteWrapRef} className="relative">
              <button
                type="button"
                onClick={() => setSiteOpen((v) => !v)}
                aria-haspopup="listbox"
                aria-expanded={siteOpen}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-sm backdrop-blur-sm border border-white/10"
              >
                {siteLabel}
                <ChevronDown className={'h-4 w-4 opacity-70 transition-transform ' + (siteOpen ? 'rotate-180' : '')} />
              </button>
              {siteOpen && (
                <div
                  role="listbox"
                  className="absolute left-0 top-full mt-2 w-64 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-2xl z-50 overflow-hidden"
                >
                  <div className="px-3 pt-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    Filter by site
                  </div>
                  <ul className="max-h-64 overflow-y-auto py-1 text-sm text-slate-700 dark:text-slate-300 [scrollbar-width:thin] [scrollbar-color:#cbd5e1_transparent]">
                    <SiteOption
                      icon={<Globe className="h-4 w-4" />}
                      label="All sites"
                      selected={selectedSiteId === null}
                      onClick={() => handleSitePick(null)}
                    />
                    {sites.length > 0 && (
                      <li className="my-1 mx-3 border-t border-slate-100 dark:border-slate-700" aria-hidden />
                    )}
                    {sites.map((s) => (
                      <SiteOption
                        key={s.id}
                        icon={<Building2 className="h-4 w-4" />}
                        label={s.name}
                        selected={selectedSiteId === s.id}
                        onClick={() => handleSitePick(s.id)}
                      />
                    ))}
                    {sites.length === 0 && (
                      <li className="px-3 py-3 text-slate-400 dark:text-slate-500 text-xs italic text-center">
                        No sites available
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>

            {/* Range toggle — 3 presets + Custom (opens a popover) */}
            <div ref={customWrapRef} className="relative">
              <div className="inline-flex rounded-lg bg-white/10 p-1 text-sm border border-white/10">
                {PRESET_DAYS.map((n) => {
                  const isActive = activeRange.kind === 'preset' && activeRange.days === n;
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => handlePresetPick(n)}
                      className={
                        'px-3 py-1 rounded-md transition-colors ' +
                        (isActive ? 'bg-white text-emerald-900 font-semibold' : 'text-emerald-100 hover:bg-white/10')
                      }
                    >
                      {n} days
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => (customOpen ? setCustomOpen(false) : openCustomPopover())}
                  className={
                    'px-3 py-1 rounded-md transition-colors inline-flex items-center gap-1 ' +
                    (activeRange.kind === 'custom'
                      ? 'bg-white text-emerald-900 font-semibold'
                      : 'text-emerald-100 hover:bg-white/10')
                  }
                  aria-expanded={customOpen}
                  aria-haspopup="dialog"
                >
                  {activeRange.kind === 'custom'
                    ? formatCustomChip(activeRange.from, activeRange.to)
                    : 'Custom'}
                  <ChevronDown className={'h-3.5 w-3.5 opacity-70 transition-transform ' + (customOpen ? 'rotate-180' : '')} />
                </button>
              </div>

              {customOpen && (
                <div
                  role="dialog"
                  aria-label="Pick a custom date range"
                  className="absolute left-0 top-full mt-2 w-72 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-2xl z-50 p-4"
                >
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
                    Custom range
                  </div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">From</label>
                  <input
                    type="date"
                    value={draftFrom}
                    max={draftTo || todayIso}
                    onChange={(e) => { setDraftFrom(e.target.value); setDraftError(null); }}
                    className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mt-3 mb-1">To</label>
                  <input
                    type="date"
                    value={draftTo}
                    min={draftFrom}
                    max={todayIso}
                    onChange={(e) => { setDraftTo(e.target.value); setDraftError(null); }}
                    className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  {draftError && (
                    <div className="mt-2 text-[11px] text-rose-600 dark:text-rose-400">{draftError}</div>
                  )}
                  <div className="mt-4 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setCustomOpen(false)}
                      className="px-3 py-1.5 text-xs font-medium rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={applyCustomRange}
                      className="px-3 py-1.5 text-xs font-semibold rounded-md bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      Apply
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: circular gauge + legend */}
        <div className="flex items-center gap-6 shrink-0">
          <div className="relative h-40 w-40 md:h-44 md:w-44">
            <svg viewBox="0 0 160 160" className="w-full h-full -rotate-90">
              <circle cx="80" cy="80" r={R} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="12" />
              <circle
                cx="80" cy="80" r={R} fill="none"
                stroke="#5eead4"
                strokeWidth="12"
                strokeLinecap="round"
                strokeDasharray={`${dash} ${CIRC - dash}`}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-3xl font-bold">{data.occupiedPercent}%</div>
              <div className="text-[11px] text-emerald-100/80 mt-0.5">occupied now</div>
            </div>
          </div>

          <div className="flex flex-col gap-3 text-sm min-w-[160px]">
            <StatRow dotColor="#fb923c" count={data.inUseNow} label="In use right now" />
            <StatRow dotColor="#60a5fa" count={data.startingWithin30Min} label="Starting within 30 min" />
            <StatRow dotColor="#34d399" count={data.availableToBook} label="Available to book" />
          </div>
        </div>
      </div>
    </div>
  );
}

function SiteOption({
  icon, label, selected, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={selected}
        onClick={onClick}
        className={
          'w-full flex items-center gap-2.5 px-3 py-2 transition-colors text-left ' +
          (selected
            ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-200 font-semibold'
            : 'hover:bg-slate-50 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-300')
        }
      >
        <span className={selected ? 'text-emerald-600 dark:text-emerald-300' : 'text-slate-400 dark:text-slate-500'}>{icon}</span>
        <span className="flex-1 truncate">{label}</span>
        {selected && <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-300 shrink-0" />}
      </button>
    </li>
  );
}

function StatRow({ dotColor, count, label }: { dotColor: string; count: number; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: dotColor }} />
      <span className="text-2xl font-bold w-8 text-right">{count}</span>
      <span className="text-emerald-100/80 text-xs">{label}</span>
    </div>
  );
}

// --- Custom range helpers --------------------------------------------------

/** YYYY-MM-DD in local time (not UTC — matches what the date <input> uses). */
function isoDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysLocal(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

/**
 * Validates a draft custom range. Returns a user-facing error string, or
 * null if the pair is good to apply.
 */
function validateCustomRange(from: string, to: string, todayIso: string): string | null {
  if (!from) return 'Pick a start date';
  if (!to) return 'Pick an end date';
  if (from > to) return 'Start date must be on or before end date';
  if (to > todayIso) return 'End date can\'t be in the future';
  const span = daysSpan(from, to);
  if (span > CUSTOM_MAX_DAYS) return `Range is capped at ${CUSTOM_MAX_DAYS} days (~2 years)`;
  return null;
}

function daysSpan(from: string, to: string): number {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 1;
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

/**
 * Compact "DD MMM – DD MMM" chip for the toggle button when a custom range
 * is active. Shows the year only when the range crosses year boundaries.
 */
function formatCustomChip(from: string, to: string): string {
  const f = new Date(from);
  const t = new Date(to);
  if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) return 'Custom';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const sameYear = f.getFullYear() === t.getFullYear();
  const left = `${f.getDate()} ${months[f.getMonth()]}${sameYear ? '' : ` ${f.getFullYear()}`}`;
  const right = `${t.getDate()} ${months[t.getMonth()]} ${t.getFullYear()}`;
  return `${left} – ${right}`;
}
