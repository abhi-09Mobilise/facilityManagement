// Scrollable activity feed showing latest check-ins, ratings, pantry orders,
// and new bookings across all selected sites.

import { Activity, CheckCircle2, Star, Coffee, CalendarDays } from 'lucide-react';
import { getRecentActivity, type ActivityItem } from '../sampleData';

const iconFor: Record<ActivityItem['icon'], { Icon: React.ElementType; bg: string; fg: string }> = {
  checkin: { Icon: CheckCircle2, bg: 'bg-emerald-50 dark:bg-emerald-950/40', fg: 'text-emerald-600 dark:text-emerald-400' },
  rating:  { Icon: Star,         bg: 'bg-amber-50 dark:bg-amber-950/40',   fg: 'text-amber-600 dark:text-amber-400'  },
  pantry:  { Icon: Coffee,       bg: 'bg-orange-50 dark:bg-orange-950/40',  fg: 'text-orange-600 dark:text-orange-400' },
  booking: { Icon: CalendarDays, bg: 'bg-blue-50 dark:bg-blue-950/40',    fg: 'text-blue-600 dark:text-blue-400'   },
};

interface Props {
  // When present and non-empty, replaces the mock feed entirely with
  // real booking rows from bookingsApi. Pass `null` or omit to keep
  // the sample data (used while the live hook is loading or empty).
  liveOverlay?: ActivityItem[] | null;
}

export function RecentActivity({ liveOverlay }: Props = {}) {
  const items = getRecentActivity(liveOverlay);

  return (
    <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200/70 dark:border-slate-700/70 shadow-sm p-5 h-full flex flex-col">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-lg bg-pink-50 text-pink-600 flex items-center justify-center shrink-0">
          <Activity className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Recent activity</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">Live across selected sites</p>
        </div>
      </div>

      <div className="mt-4 overflow-y-auto max-h-[360px] pr-1 flex-1">
        <ul className="divide-y divide-slate-100">
          {items.map((item) => <ActivityRow key={item.id} item={item} />)}
        </ul>
      </div>
    </div>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const { Icon, bg, fg } = iconFor[item.icon];
  return (
    <li className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <div className={`h-9 w-9 rounded-lg ${bg} ${fg} flex items-center justify-center shrink-0`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm leading-snug text-slate-700 dark:text-slate-300">
          <BoldParts text={item.title} />
        </div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug mt-0.5">{item.description}</div>
      </div>
      <span className="text-[11px] text-slate-400 dark:text-slate-500 shrink-0 pt-0.5">{item.ago}</span>
    </li>
  );
}

function BoldParts({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**')
          ? <strong key={i} className="font-semibold text-slate-900 dark:text-slate-100">{part.slice(2, -2)}</strong>
          : <span key={i}>{part}</span>
      )}
    </>
  );
}
