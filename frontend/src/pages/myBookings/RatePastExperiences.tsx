// "Rate your past experiences" section on /my-bookings.
//
// Lists completed bookings (status='completed' AND end_at < now) that
// the user hasn't rated yet. Each row has a Rate button that opens the
// RateBookingModal. Rated bookings disappear from the list after submit
// (optimistic update + state removal) so the user sees progress.
//
// Why a separate section (not inline in BookingsTable):
//   • BookingsTable is shared across facility pages — adding a Rate
//     column there would couple that component to the ratings concept.
//   • A dedicated section is more discoverable than a column action.
//   • Future: email-triggered flow lands on /rate/:token, this section
//     is the in-app fallback for users who come back without the email.

import { useEffect, useMemo, useState } from 'react';
import { Star, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ratingsApi, type Rating } from '@/api/ratings.api';
import type { LiveBooking } from '@/types';
import RateBookingModal from './RateBookingModal';

interface Props {
  bookings: LiveBooking[]; // all of the user's bookings (from MyBookingsPage)
}

export default function RatePastExperiences({ bookings }: Props) {
  // Keep track of which bookings this user has already rated so the row
  // can show "✓ Rated" vs "Rate" without a separate flag on LiveBooking.
  const [ratedMap, setRatedMap] = useState<Record<number, Rating>>({});
  const [loadingRated, setLoadingRated] = useState(true);
  const [activeBookingId, setActiveBookingId] = useState<number | null>(null);

  // Eligible = status 'completed' AND end_at in the past. Backend
  // enforces this too; the filter here just hides irrelevant rows up front.
  const eligible = useMemo(() => {
    const now = Date.now();
    return bookings
      .filter((b) => b.status === 'completed')
      .filter((b) => {
        const end = parseDt(b.end_at);
        return end ? end.getTime() < now : false;
      })
      .sort((a, b) => {
        // Most recently completed first — users remember the latest best.
        const ta = parseDt(a.end_at)?.getTime() ?? 0;
        const tb = parseDt(b.end_at)?.getTime() ?? 0;
        return tb - ta;
      });
  }, [bookings]);

  // Fetch existing ratings for the eligible bookings up front. Avoids
  // flashing "Rate" buttons for rows that are actually already rated.
  useEffect(() => {
    if (eligible.length === 0) { setLoadingRated(false); return; }
    let alive = true;
    setLoadingRated(true);
    Promise.allSettled(
      eligible.map((b) => ratingsApi.mineForBooking(b.id))
    ).then((results) => {
      if (!alive) return;
      const map: Record<number, Rating> = {};
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value.status && r.value.data?.rating) {
          map[eligible[i].id] = r.value.data.rating;
        }
      });
      setRatedMap(map);
      setLoadingRated(false);
    });
    return () => { alive = false; };
  }, [eligible]);

  // Rows that still need a rating (not in ratedMap).
  const unrated = useMemo(
    () => eligible.filter((b) => !ratedMap[b.id]),
    [eligible, ratedMap]
  );

  if (eligible.length === 0) return null;

  const activeBooking = activeBookingId !== null
    ? eligible.find((b) => b.id === activeBookingId) || null
    : null;

  return (
    <>
      <section className="mt-6 rounded-2xl border border-amber-200/60 bg-amber-50/40 p-5">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-lg bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
            <Star className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Rate your past experiences
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              {unrated.length === 0
                ? "You've rated every completed booking. Thanks!"
                : `${unrated.length} completed booking${unrated.length === 1 ? '' : 's'} waiting on your feedback`}
            </p>
          </div>
        </div>

        {loadingRated ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking your ratings…
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {eligible.slice(0, 8).map((b) => {
              const alreadyRated = ratedMap[b.id];
              return (
                <li
                  key={b.id}
                  className="flex items-center justify-between gap-3 rounded-lg bg-white dark:bg-slate-800 border border-slate-200/70 dark:border-slate-700/70 px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {b.facility_name || `Facility #${b.facility_id}`}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {formatSlotLabel(b.start_at, b.end_at)}
                    </div>
                  </div>
                  {alreadyRated ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="flex items-center gap-0.5">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <Star
                            key={n}
                            className={
                              'h-3.5 w-3.5 ' +
                              (n <= alreadyRated.stars
                                ? 'fill-amber-400 text-amber-400'
                                : 'text-slate-300 dark:text-slate-600')
                            }
                          />
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveBookingId(b.id)}
                        className="text-xs text-emerald-700 dark:text-emerald-300 hover:underline"
                      >
                        Edit
                      </button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => setActiveBookingId(b.id)}
                      className="shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      Rate
                    </Button>
                  )}
                </li>
              );
            })}
            {eligible.length > 8 && (
              <li className="text-[11px] text-slate-500 dark:text-slate-400 text-center pt-1">
                Showing 8 most recent — scroll past to find older bookings
              </li>
            )}
          </ul>
        )}
      </section>

      {activeBooking && (
        <RateBookingModal
          bookingId={activeBooking.id}
          facilityName={activeBooking.facility_name || `Facility #${activeBooking.facility_id}`}
          slotLabel={formatSlotLabel(activeBooking.start_at, activeBooking.end_at)}
          existing={ratedMap[activeBooking.id] ?? null}
          onClose={() => setActiveBookingId(null)}
          onSaved={(rating) => {
            setRatedMap((prev) => ({ ...prev, [activeBooking.id]: rating }));
          }}
        />
      )}
    </>
  );
}

function parseDt(s?: string): Date | null {
  if (!s) return null;
  const d = new Date(s.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatSlotLabel(startAt: string, endAt: string): string {
  const s = parseDt(startAt);
  const e = parseDt(endAt);
  if (!s || !e) return `${startAt} → ${endAt}`;
  const weekday = s.toLocaleDateString('en-GB', { weekday: 'short' });
  const date = s.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const hhmm = (d: Date) =>
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${weekday}, ${date} · ${hhmm(s)}–${hhmm(e)}`;
}
