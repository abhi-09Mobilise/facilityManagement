// Employee landing for /facility.
//
//   - Loads /api/facilities       → cards grouped by type
//   - Loads /api/bookings?scope=mine → real upcoming / past bookings table
//   - "Book now" navigates to /facility/type/:type

import { useEffect, useMemo, useState } from 'react';
import { Alert, Box, CircularProgress, Divider, Stack, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import FacilityCardGrid from './components/FacilityCardGrid';
import BookingsTable from './components/BookingsTable';
import { facilitiesApi } from '@/api/facilities.api';
import { bookingsApi } from '@/api/bookings.api';
import type { Facility, LiveBooking } from '@/types';

export default function FacilityBookingPage() {
  const navigate = useNavigate();
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [bookings, setBookings] = useState<LiveBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [fRes, bRes] = await Promise.all([
        facilitiesApi.list({ limit: 200 }),
        bookingsApi.list({ scope: 'mine', limit: 100 }),
      ]);
      setFacilities(fRes.data?.data || []);
      setBookings(bRes.data?.data || []);
    } catch (e: unknown) {
      setError(
        (e as { response?: { data?: { msg?: string } } })?.response?.data?.msg
          || 'Failed to load page data'
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  // Split bookings into upcoming (active states + future) vs past (everything else).
  const { upcoming, past } = useMemo(() => {
    const now = Date.now();
    const up: LiveBooking[] = [];
    const pa: LiveBooking[] = [];
    for (const b of bookings) {
      const endTs = new Date(b.end_at.replace(' ', 'T')).getTime();
      const stillActive = b.status === 'pending' || b.status === 'approved';
      if (stillActive && endTs >= now) up.push(b); else pa.push(b);
    }
    // Order: upcoming soonest first, past most-recently ended first.
    up.sort((a, b) => a.start_at.localeCompare(b.start_at));
    pa.sort((a, b) => b.start_at.localeCompare(a.start_at));
    return { upcoming: up, past: pa };
  }, [bookings]);

  async function handleCancel(booking: LiveBooking) {
    try {
      await bookingsApi.cancel(booking.id);
      await loadAll();
    } catch (e: unknown) {
      setError(
        (e as { response?: { data?: { msg?: string } } })?.response?.data?.msg
          || 'Failed to cancel'
      );
    }
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>Facility Booking</Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Stack spacing={4}>
        {loading ? (
          <Box display="flex" justifyContent="center" p={5}><CircularProgress /></Box>
        ) : (
          <FacilityCardGrid
            facilities={facilities}
            onBook={(type) => navigate(`/facility/type/${type}`)}
          />
        )}
        <Divider />
        <BookingsTable upcoming={upcoming} past={past} onCancel={handleCancel} />
      </Stack>
    </Box>
  );
}
