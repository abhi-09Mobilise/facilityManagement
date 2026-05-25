// /bookings/:id/act?token=...&action=cancel|reschedule
//
// Email-link landing page for booker actions (F07). Flow:
//   1. Read :id, ?token, ?action from URL.
//   2. If not logged in, bounce to /login?next=... so the booker signs in.
//   3. Hit GET /bookings/:id/act. Backend verifies token + user; on
//      action=cancel it cancels and returns ok. On action=reschedule it
//      returns ok and we render the reschedule form below.
//   4. For reschedule, on submit we POST /bookings/:id/reschedule with the
//      same token.

import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams, Link as RouterLink, useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle, CalendarClock, Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { bookingsApi } from '@/api/bookings.api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Action = 'cancel' | 'reschedule';

export default function BookingActPage() {
  const { id } = useParams<{ id: string }>();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const bookingId = useMemo(() => Number(id || 0), [id]);
  const token = useMemo(() => sp.get('token') || '', [sp]);
  const action = useMemo<Action>(() => (sp.get('action') === 'cancel' ? 'cancel' : 'reschedule'), [sp]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [validated, setValidated] = useState(false);
  const [cancelled, setCancelled] = useState(false);

  const [newDate, setNewDate] = useState('');
  const [newStart, setNewStart] = useState('');
  const [newEnd, setNewEnd] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [rescheduled, setRescheduled] = useState<{ start: string; end: string } | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      const back = `/bookings/${bookingId}/act?token=${encodeURIComponent(token)}&action=${action}`;
      navigate(`/login?next=${encodeURIComponent(back)}`, { replace: true });
    }
  }, [user, authLoading, bookingId, token, action, navigate]);

  useEffect(() => {
    if (!user) return;
    if (!token || !bookingId) {
      setError('Missing booking id or token.');
      setLoading(false);
      return;
    }
    let cancelledCall = false;
    (async () => {
      try {
        const r = await bookingsApi.act(bookingId, token, action);
        if (cancelledCall) return;
        if (!r.status) {
          setError(r.msg || 'This link is invalid or has expired.');
        } else {
          setValidated(true);
          if (action === 'cancel') setCancelled(true);
        }
      } catch (e: unknown) {
        const msg = (e as { response?: { data?: { msg?: string } } })?.response?.data?.msg
          || (e as Error)?.message
          || 'Something went wrong.';
        if (!cancelledCall) setError(msg);
      } finally {
        if (!cancelledCall) setLoading(false);
      }
    })();
    return () => { cancelledCall = true; };
  }, [user, bookingId, token, action]);

  async function handleReschedule(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!newDate || !newStart || !newEnd) {
      setError('Pick a date, start and end time.');
      return;
    }
    const startAt = newDate + ' ' + newStart + ':00';
    const endAt   = newDate + ' ' + newEnd   + ':00';
    setSubmitting(true);
    try {
      const r = await bookingsApi.reschedule(bookingId, { token, start_at: startAt, end_at: endAt });
      if (r.status) {
        setRescheduled({ start: startAt, end: endAt });
      } else {
        setError(r.msg || 'Reschedule failed.');
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { msg?: string } } })?.response?.data?.msg
        || (err as Error)?.message
        || 'Reschedule failed.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-[60vh] flex items-start sm:items-center justify-center p-4 sm:p-6">
      <div className="panel panel-pad w-full max-w-xl">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Validating link…
          </div>
        )}

        {!loading && error && (
          <div className="text-center py-6 space-y-3">
            <XCircle className="h-10 w-10 mx-auto text-destructive" />
            <h2 className="page-title">Link can't be used</h2>
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button asChild variant="outline" size="sm">
              <RouterLink to="/my-bookings">Go to my bookings</RouterLink>
            </Button>
          </div>
        )}

        {!loading && cancelled && (
          <div className="text-center py-6 space-y-3">
            <CheckCircle className="h-10 w-10 mx-auto text-emerald-600" />
            <h2 className="page-title">Booking cancelled</h2>
            <p className="text-sm text-muted-foreground">
              Booking #{bookingId} has been cancelled. Any pending approvers have been notified.
            </p>
            <Button asChild size="sm">
              <RouterLink to="/my-bookings">View my bookings</RouterLink>
            </Button>
          </div>
        )}

        {!loading && rescheduled && (
          <div className="text-center py-6 space-y-3">
            <CheckCircle className="h-10 w-10 mx-auto text-emerald-600" />
            <h2 className="page-title">Booking rescheduled</h2>
            <p className="text-sm text-muted-foreground">
              Booking #{bookingId} now runs <b>{rescheduled.start}</b> {'→'} <b>{rescheduled.end}</b>.
            </p>
            <Button asChild size="sm">
              <RouterLink to={'/my-bookings?highlight=' + bookingId}>View details</RouterLink>
            </Button>
          </div>
        )}

        {!loading && validated && action === 'reschedule' && !rescheduled && (
          <>
            <div className="flex items-center gap-2 mb-1">
              <CalendarClock className="h-5 w-5 text-primary" />
              <h2 className="page-title">Reschedule booking #{bookingId}</h2>
            </div>
            <p className="page-subtitle mb-4">Pick a new date and time. We will re-check capacity in case anything changed.</p>

            <form onSubmit={handleReschedule} className="space-y-3">
              <div className="form-row">
                <Label htmlFor="new-date">New date</Label>
                <Input id="new-date" type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} required />
              </div>
              <div className="form-grid">
                <div className="form-row">
                  <Label htmlFor="new-start">Start</Label>
                  <Input id="new-start" type="time" value={newStart} onChange={(e) => setNewStart(e.target.value)} required />
                </div>
                <div className="form-row">
                  <Label htmlFor="new-end">End</Label>
                  <Input id="new-end" type="time" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} required />
                </div>
              </div>

              {error && (
                <div className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}

              <div className="form-actions">
                <Button type="button" variant="ghost" asChild>
                  <RouterLink to="/my-bookings">Cancel</RouterLink>
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? 'Rescheduling…' : 'Reschedule'}
                </Button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
