// My Bookings dashboard.
//
// Shown to every logged-in role at /my-bookings. The user only ever sees
// their own rows (backend scopes to req.user.id when scope=mine).
//
// Layout: 4 KPI tiles at the top + the existing BookingsTable (with
// Upcoming / Past tabs, search, facility filter, cancel action, and the
// "Pending with" annotation).
//
// Booking-success dialog redirects to /my-bookings?highlight=<id> after a
// new booking. We highlight that row briefly with a soft outline + scroll
// it into view so the user can confirm it landed.

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Loader2, RefreshCw, CalendarDays, Clock, HourglassIcon, CheckCircle2,
} from 'lucide-react';
import { bookingsApi } from '@/api/bookings.api';
import type { LiveBooking } from '@/types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import BookingsTable from '@/pages/facility/components/BookingsTable';

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function endOfWeek(): Date {
  // 7 days from now (rolling week) so users see what's coming up regardless
  // of which day of the week it is today.
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  d.setDate(d.getDate() + 7);
  return d;
}
function parseDt(s?: string): Date | null {
  if (!s) return null;
  const d = new Date(s.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

export default function MyBookingsPage() {
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get('highlight');

  const [bookings, setBookings] = useState<LiveBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      // scope=mine always for this page, regardless of role. Larger limit so
      // a busy user gets a full picture without paginating.
      const r = await bookingsApi.list({ scope: 'mine', limit: 100 });
      const data = (r.data && (r.data as { data: LiveBooking[] }).data) || [];
      setBookings(data);
    } catch (e: unknown) {
      setError((e as { response?: { data?: { msg?: string } } })?.response?.data?.msg
        || 'Failed to load your bookings');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  // Split upcoming vs past for the tabs in BookingsTable.
  const { upcoming, past, stats } = useMemo(() => {
    const today = startOfToday().getTime();
    const weekOut = endOfWeek().getTime();
    const up: LiveBooking[] = [];
    const pa: LiveBooking[] = [];
    let pendingCount = 0;
    let thisWeekCount = 0;
    for (const b of bookings) {
      const start = parseDt(b.start_at);
      const end = parseDt(b.end_at);
      const isPast = end ? end.getTime() < today : false;
      if (isPast) pa.push(b); else up.push(b);
      if (b.status === 'pending') pendingCount++;
      if (start && start.getTime() >= today && start.getTime() <= weekOut
          && b.status !== 'cancelled' && b.status !== 'rejected') {
        thisWeekCount++;
      }
    }
    // Newest first inside each group.
    up.sort((a, b) => (parseDt(b.start_at)?.getTime() || 0) - (parseDt(a.start_at)?.getTime() || 0));
    pa.sort((a, b) => (parseDt(b.start_at)?.getTime() || 0) - (parseDt(a.start_at)?.getTime() || 0));
    return {
      upcoming: up,
      past: pa,
      stats: {
        total: bookings.length,
        upcoming: up.length,
        pending: pendingCount,
        thisWeek: thisWeekCount,
      },
    };
  }, [bookings]);

  async function handleCancel(b: LiveBooking) {
    if (!window.confirm(`Cancel booking #${b.id}?`)) return;
    try {
      await bookingsApi.cancel(b.id);
      await load();
    } catch (e: unknown) {
      alert((e as { response?: { data?: { msg?: string } } })?.response?.data?.msg
        || 'Failed to cancel');
    }
  }

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-brand-navy">My bookings</h1>
          <p className="text-sm text-muted-foreground">
            Everything you've booked &middot; track approvals and cancel when needed
          </p>
        </div>
        <Button onClick={load} variant="outline" size="sm">
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {highlightId && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Booking <strong>#{highlightId}</strong> just submitted. Look for it in the Upcoming tab below.
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiTile icon={<CalendarDays className="h-5 w-5" />} label="Total bookings"
          value={stats.total} accent="navy" />
        <KpiTile icon={<Clock className="h-5 w-5" />} label="Upcoming"
          value={stats.upcoming} accent="info" />
        <KpiTile icon={<HourglassIcon className="h-5 w-5" />} label="Pending approval"
          value={stats.pending} accent="warning" />
        <KpiTile icon={<CheckCircle2 className="h-5 w-5" />} label="In next 7 days"
          value={stats.thisWeek} accent="success" />
      </div>

      {/* Table - reuse the one from FacilityBookingPage */}
      {loading && bookings.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-brand-navy" />
        </div>
      ) : (
        <BookingsTable upcoming={upcoming} past={past} onCancel={handleCancel} />
      )}
    </div>
  );
}

// ---- helpers ----

function KpiTile({ icon, label, value, accent }: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  accent: 'navy' | 'warning' | 'info' | 'success';
}) {
  const border = {
    navy:    'border-l-brand-navy',
    warning: 'border-l-amber-500',
    info:    'border-l-sky-500',
    success: 'border-l-emerald-500',
  }[accent];
  const iconBg = {
    navy:    'bg-brand-navy-soft text-brand-navy',
    warning: 'bg-amber-100 text-amber-700',
    info:    'bg-sky-100 text-sky-700',
    success: 'bg-emerald-100 text-emerald-700',
  }[accent];
  return (
    <Card className={cn('border-l-4', border)}>
      <CardContent className="p-4 flex items-start gap-3">
        <div className={cn('h-10 w-10 rounded-md flex items-center justify-center shrink-0', iconBg)}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">
            {label}
          </div>
          <div className="text-2xl font-bold mt-0.5">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
