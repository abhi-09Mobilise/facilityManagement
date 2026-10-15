// Rate modal — opens from the "Rate your past experiences" section on
// /my-bookings. Hits POST /api/ratings and closes on success.
//
// Why we don't inline this into BookingsTable: BookingsTable is a shared
// component (used in facility pages too). Keeping the rating workflow
// self-contained avoids coupling + prop-drilling across pages that don't
// care about ratings.

import { useState } from 'react';
import { Star, X } from 'lucide-react';
import { ratingsApi, type Rating } from '@/api/ratings.api';
import { Button } from '@/components/ui/button';

// Pre-defined tag choices — kept in sync with the mock "most mentioned"
// tags in sampleData.ts so dashboard "most mentioned" column surfaces
// meaningful values once real ratings start flowing.
const PRESET_TAGS = [
  'Quiet', 'Clean & ready', 'Great Wi-Fi', 'Spacious',
  'Comfortable', 'Natural light',
  'Wi-Fi drops', 'AC too cold', 'Noisy', 'Cleanliness',
  'Booking overlap', 'Easy QR check-in',
];

interface Props {
  bookingId: number;
  facilityName: string;      // "Shivalik"
  slotLabel: string;         // "Fri 10:00–11:00"
  existing?: Rating | null;  // pre-fill if updating an existing rating
  onClose: () => void;
  onSaved: (rating: Rating) => void;
}

export default function RateBookingModal({
  bookingId, facilityName, slotLabel, existing, onClose, onSaved,
}: Props) {
  const [stars, setStars] = useState<number>(existing?.stars ?? 0);
  const [hoverStar, setHoverStar] = useState<number>(0);
  const [comment, setComment] = useState<string>(existing?.comment ?? '');
  const [selectedTags, setSelectedTags] = useState<string[]>(existing?.tags ?? []);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleTag(tag: string) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  async function handleSubmit() {
    if (stars < 1) { setError('Please pick a star rating'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const res = await ratingsApi.create({
        booking_id: bookingId,
        stars,
        comment: comment.trim() || undefined,
        tags: selectedTags.length > 0 ? selectedTags : undefined,
      });
      if (res.status && res.data?.rating) {
        onSaved(res.data.rating);
        onClose();
      } else {
        setError(res.msg || 'Failed to submit rating');
      }
    } catch (e: unknown) {
      setError((e as { response?: { data?: { msg?: string } } })?.response?.data?.msg
        || 'Failed to submit rating');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-slate-100">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {existing ? 'Update your rating' : 'Rate your experience'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
              {facilityName} · {slotLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Stars */}
        <div className="p-5">
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
                      'h-8 w-8 transition-transform ' +
                      (active ? 'fill-amber-400 text-amber-400 scale-110' : 'text-slate-300 dark:text-slate-600')
                    }
                  />
                </button>
              );
            })}
            {stars > 0 && (
              <span className="ml-2 text-sm text-slate-600 dark:text-slate-400">
                {['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'][stars]}
              </span>
            )}
          </div>
        </div>

        {/* Comment */}
        <div className="px-5 pb-5">
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
          <div className="text-[11px] text-slate-400 dark:text-slate-500 text-right mt-0.5">
            {comment.length}/500
          </div>
        </div>

        {/* Tags */}
        <div className="px-5 pb-5">
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
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-50')
                  }
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-5 mb-3 p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-700/40 text-xs text-rose-700 dark:text-rose-300">
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || stars < 1}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {submitting ? 'Submitting…' : (existing ? 'Update rating' : 'Submit rating')}
          </Button>
        </div>
      </div>
    </div>
  );
}
