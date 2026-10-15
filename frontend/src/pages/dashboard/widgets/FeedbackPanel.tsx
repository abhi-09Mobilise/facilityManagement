// Overall rating summary + per-facility feedback list with Needs attention /
// Top rated tabs. Each row has initials avatar, name, rating, review count,
// and the most-mentioned tag.

import { useState } from 'react';
import { Star } from 'lucide-react';
import { getFeedback, type FeedbackRow } from '../sampleData';

type Tab = 'needs' | 'top';

// Shared grid template so the sticky header and every row stay perfectly
// aligned. Using inline style (not Tailwind's arbitrary-value syntax) because
// `minmax()` contains a comma that trips Tailwind's class parser.
const GRID_STYLE: React.CSSProperties = {
  gridTemplateColumns: 'minmax(220px, 1fr) 80px 80px 140px',
};

// Avatar palette cycled deterministically by initials so each facility keeps
// a stable, visually distinct chip color.
const AVATAR_PALETTE: { bg: string; fg: string }[] = [
  { bg: 'bg-amber-100 dark:bg-amber-900/40',   fg: 'text-amber-700 dark:text-amber-300'   },
  { bg: 'bg-blue-100',    fg: 'text-blue-700 dark:text-blue-300'    },
  { bg: 'bg-purple-100',  fg: 'text-purple-700'  },
  { bg: 'bg-emerald-100 dark:bg-emerald-900/40', fg: 'text-emerald-700 dark:text-emerald-300' },
  { bg: 'bg-rose-100 dark:bg-rose-900/40',    fg: 'text-rose-700 dark:text-rose-300'    },
  { bg: 'bg-cyan-100',    fg: 'text-cyan-700'    },
];

function avatarColor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

interface Props {
  // Backend aggregation payload. When present (reviews > 0), replaces
  // the mock demo set. The widget's layout + styling is identical for
  // both — only the row data differs.
  liveOverlay?: {
    overall: number;
    reviews: number;
    distribution: { stars: 5 | 4 | 3 | 2 | 1; percent: number }[];
    needsAttention: FeedbackRow[];
    topRated: FeedbackRow[];
  } | null;
}

export function FeedbackPanel({ liveOverlay }: Props = {}) {
  const data = getFeedback(liveOverlay);
  const [tab, setTab] = useState<Tab>('needs');
  const rows = tab === 'needs' ? data.needsAttention : data.topRated;

  return (
    <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200/70 dark:border-slate-700/70 shadow-sm p-5 h-full flex flex-col">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
            <Star className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Feedback across facilities</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Ratings submitted after check-out</p>
          </div>
        </div>

        <div className="inline-flex rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setTab('needs')}
            className={'px-3 py-1 rounded-md transition-colors ' + (tab === 'needs' ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-semibold shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100')}
          >
            Needs attention
          </button>
          <button
            type="button"
            onClick={() => setTab('top')}
            className={'px-3 py-1 rounded-md transition-colors ' + (tab === 'top' ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-semibold shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100')}
          >
            Top rated
          </button>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 md:grid-cols-5 gap-5 flex-1 min-h-0">
        {/* Overall rating card */}
        <div className="md:col-span-2 rounded-xl bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200/40 dark:border-amber-700/40 p-5">
          <div className="text-5xl font-bold text-slate-900 dark:text-slate-100">
            {data.overall.toFixed(1)}
            <span className="text-xl text-slate-400 dark:text-slate-500 font-normal">/ 5</span>
          </div>
          <div className="mt-2 flex items-center gap-0.5 text-amber-500">
            {[1, 2, 3, 4, 5].map((n) => (
              <Star key={n} className={'h-4 w-4 ' + (n <= Math.round(data.overall) ? 'fill-amber-400' : 'text-amber-200')} />
            ))}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            {data.reviews.toLocaleString()} reviews · last 30 days
          </div>

          <div className="mt-5 space-y-1.5">
            {data.distribution.map((d) => (
              <div key={d.stars} className="flex items-center gap-2 text-xs">
                <span className="w-5 text-slate-600 dark:text-slate-400">{d.stars}★</span>
                <div className="flex-1 h-1.5 rounded-full bg-amber-100 dark:bg-amber-900/40 overflow-hidden">
                  <div className="h-full rounded-full bg-amber-400" style={{ width: `${d.percent}%` }} />
                </div>
                <span className="w-8 text-right text-slate-500 dark:text-slate-400">{d.percent}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* Facility list — fixed height, scrolls vertically and horizontally
            when the inner panel is narrower than the minimum grid width. */}
        <div className="md:col-span-3 min-w-0 flex flex-col min-h-0">
          <div className="flex-1 min-h-0 overflow-auto pr-1">
            <div
              className="sticky top-0 bg-white dark:bg-slate-800 z-10 grid gap-3 pb-2 border-b border-slate-200/70 dark:border-slate-700/70 text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide"
              style={GRID_STYLE}
            >
              <span>Facility</span>
              <span>Rating</span>
              <span>Reviews</span>
              <span>Most mentioned</span>
            </div>
            <ul className="divide-y divide-slate-100">
              {rows.map((r) => <FeedbackRowItem key={r.name} row={r} />)}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function FeedbackRowItem({ row }: { row: FeedbackRow }) {
  const { bg, fg } = avatarColor(row.initials);
  return (
    <li className="grid gap-3 items-center py-3" style={GRID_STYLE}>
      <div className="flex items-center gap-2.5 min-w-0">
        <div className={`h-9 w-9 rounded-full ${bg} ${fg} flex items-center justify-center text-xs font-semibold shrink-0`}>
          {row.initials}
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-sm text-slate-900 dark:text-slate-100 leading-snug">{row.name}</div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">{row.type} · {row.site}</div>
        </div>
      </div>
      <div className="flex items-center gap-1 text-sm font-semibold text-amber-600 dark:text-amber-400">
        <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
        {row.rating.toFixed(1)}
      </div>
      <div className="text-sm text-slate-700 dark:text-slate-300">{row.reviews}</div>
      <div className="min-w-0">
        <span className="inline-block px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] truncate max-w-full">
          {row.mostMentioned}
        </span>
      </div>
    </li>
  );
}
