// Public rating page — the destination of the "Rate this booking" link in
// the feedbackMailer email. No auth required: the signed token in the URL
// (`/rate/:token`) is the proof of identity.
//
// URL supports an optional `?stars=N` query param so the email can show
// 5 clickable star icons that each deep-link with the chosen rating
// pre-selected — one-click rating for users who don't want to add a
// comment or tags.

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Loader2, Star, CheckCircle2 } from 'lucide-react';
import { publicApi } from '@/api/public.api';
import { Button } from '@/components/ui/button';
import PublicShell from './components/PublicShell';

const PRESET_TAGS = [
  'Quiet', 'Clean & ready', 'Great Wi-Fi', 'Spacious',
  'Comfortable', 'Natural light',
  'Wi-Fi drops', 'AC too cold', 'Noisy', 'Cleanliness',
  'Booking overlap', 'Easy QR check-in',
];

interface BookingInfo {
  id: number;
  facility_name: string;
  facility_type: string;
  site_name: string | null;
  start_at: string;
  end_at: string;
}

export default function PublicRatePage() {
  const { token = '' } = useParams();
  const [searchParams] = useSearchParams();
  const presetStars = Number(searchParams.get('stars')) || 0;

  const [booking, setBooking] = useState<BookingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [existingLoaded, setExistingLoaded] = useState(false);

  const [stars, setStars] = useState<number>(0);
  const [hoverStar, setHoverStar] = useState<number>(0);
  const [comment, setComment] = useState<string>('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let alive = true;
    publicApi.getRatingBooking(token).then((r) => {
      if (!alive) return;
      if (r.status && r.data?.booking) {
        setBooking(r.data.booking);
        // Pre-fill from existing rating if the user already submitted once.
        const ex = r.data.existing_rating;
        if (ex) {
          setStars(ex.stars);
          setComment(ex.comment || '');
          setSelectedTags(ex.tags || []);
        } else if (presetStars >= 1 && presetStars <= 5) {
          // Pre-select stars from the email click so one tap submits.
          setStars(presetStars);
        }
        setExistingLoaded(true);
      } else {
        setLoadError(r.msg || 'Rating link is invalid or expired');
      }
    }).catch(() => {
      if (alive) setLoadError('Rating link is invalid or expired');
    }).finally(() => {
      if (alive) setLoading(false);
    });
    return () => { alive = false; };
  }, [token, presetStars]);

  function toggleTag(tag: string) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  async function handleSubmit() {
    if (stars < 1) { setSubmitError('Please pick a star rating'); return; }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const r = await publicApi.submitRating(token, {
        stars,
        comment: comment.trim() || undefined,
        tags: selectedTags.length > 0 ? selectedTags : undefined,
      });
      if (r.status) {
        setSubmitted(true);
      } else {
        setSubmitError(r.msg || 'Failed to submit rating');
      }
    } catch {
      setSubmitError('Failed to submit rating');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <PublicShell>
        <div className="page-shell flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" />
        </div>
      </PublicShell>
    );
  }

  if (loadError || !booking) {
    return (
      <PublicShell>
        <div className="page-shell">
          <div className="empty-state text-center py-16">
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">Link not valid</div>
            <div className="text-sm text-slate-600 dark:text-slate-400">{loadError || 'This rating link is invalid or expired.'}</div>
          </div>
        </div>
      </PublicShell>
    );
  }

  if (submitted) {
    return (
      <PublicShell>
        <div className="page-shell">
          <div className="max-w-md mx-auto text-center py-16">
            <CheckCircle2 className="h-14 w-14 text-emerald-500 dark:text-emerald-400 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">Thanks for your feedback!</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Your rating helps us improve <strong>{booking.facility_name}</strong> for everyone.
            </p>
          </div>
        </div>
      </PublicShell>
    );
  }

  const slotLabel = formatSlotLabel(booking.start_at, booking.end_at);

  return (
    <PublicShell>
      <div className="page-shell">
        <div className="max-w-xl mx-auto">
          <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/70 dark:border-slate-700/70 shadow-sm p-6">
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              {existingLoaded && stars > 0 && !submitted
                ? 'Update your rating'
                : 'Rate your experience'}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              <span className="font-semibold">{booking.facility_name}</span>
              {' '}<span className="text-slate-400 dark:text-slate-500">·</span>{' '}
              {booking.facility_type}
              {booking.site_name && (
                <>
                  {' '}<span className="text-slate-400 dark:text-slate-500">·</span>{' '}
                  {booking.site_name}
                </>
              )}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{slotLabel}</p>

            {/* Stars */}
            <div className="mt-6">
              <div className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">How was it?</div>
              <div className="flex items-center gap-1" onMouseLeave={() => setHoverStar(0)}>
                {[1, 2, 3, 4, 5].map((n) => {
                  const active = (hoverStar || stars) >= n;
                  return (
                    <button
                      key={n}
                      type="button"
                      onMouseEnter={() => setHoverStar(n)}
                      onClick={() => setStars(n)}
                      className="p-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 rounded"
                      aria-label={`${n} star${n > 1 ? 's' : ''}`}
                    >
                      <Star
                        className={
                          'h-10 w-10 transition-transform ' +
                          (active ? 'fill-amber-400 text-amber-400 scale-110' : 'text-slate-300 dark:text-slate-600')
                        }
                      />
                    </button>
                  );
                })}
                {stars > 0 && (
                  <span className="ml-3 text-sm font-medium text-slate-700 dark:text-slate-300">
                    {['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'][stars]}
                  </span>
                )}
              </div>
            </div>

            {/* Comment */}
            <div className="mt-5">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Comment <span className="text-slate-400 dark:text-slate-500 font-normal">(optional)</span>
              </label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value.slice(0, 500))}
                placeholder="Anything we should know?"
                rows={3}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 resize-none"
              />
              <div className="text-[11px] text-slate-400 dark:text-slate-500 text-right mt-0.5">{comment.length}/500</div>
            </div>

            {/* Tags */}
            <div className="mt-4">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Quick tags <span className="text-slate-400 dark:text-slate-500 font-normal">(optional)</span>
              </label>
              <div className="flex flex-wrap gap-1.5">
                {PRESET_TAGS.map((tag) => {
                  const picked = selectedTags.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleTag(tag)}
                      className={
                        'px-2.5 py-1 text-[11px] rounded-full border transition-colors ' +
                        (picked
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-600/40'
                          : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700')
                      }
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>

            {submitError && (
              <div className="mt-4 p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-700/40 text-xs text-rose-700 dark:text-rose-300">
                {submitError}
              </div>
            )}

            <div className="mt-6 flex justify-end">
              <Button
                onClick={handleSubmit}
                disabled={submitting || stars < 1}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {submitting ? 'Submitting…' : 'Submit rating'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </PublicShell>
  );
}

function formatSlotLabel(startAt: string, endAt: string): string {
  const s = parseDt(startAt);
  const e = parseDt(endAt);
  if (!s || !e) return `${startAt} → ${endAt}`;
  const weekday = s.toLocaleDateString('en-GB', { weekday: 'short' });
  const date = s.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const hhmm = (d: Date) =>
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${weekday}, ${date} · ${hhmm(s)}–${hhmm(e)}`;
}

function parseDt(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}
