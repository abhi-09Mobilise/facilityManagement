// Booking detail page, scoped to a facility *type*.
//
// URL: /facility/type/:type   (e.g. /facility/type/meeting_room)
//
// Flow:
//   1. Load all facilities of that type for the tenant (GET /api/facilities?type=...).
//   2. Show a dropdown if there are multiple; auto-select if only one.
//   3. When a facility is picked, fetch its operating hours (GET /facilities/:id).
//   4. Date + free-form from/to time. As the user types, debounce-call
//      GET /api/bookings/check to learn whether the slot conflicts. Only
//      when the backend says so do we mark the slot as taken — no client-side
//      "Fully booked" mock data.
//   5. Title + remarks + optional meal pre-book (meeting rooms only) + T&C → confirm.
//
// The booking is automatically recorded against the booker's own department
// (the backend pulls it from req.user.department_id); the manager-report view
// uses that column to roll up "bookings per department".

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Breadcrumbs, Button, Checkbox, Chip,
  CircularProgress, Divider, FormControlLabel, Grid, Link as MuiLink, MenuItem, Paper, Stack,
  TextField, Typography,
} from '@mui/material';
import GroupsIcon from '@mui/icons-material/Groups';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import BookingSuccessDialog from './components/BookingSuccessDialog';
import PantryOrderPanel, { type PantryOrder } from './components/PantryOrderPanel'; // F06
import { facilitiesApi } from '@/api/facilities.api';
import { mealTimesApi } from '@/api/mealTimes.api';
import { bookingsApi } from '@/api/bookings.api';
import { useAuth } from '@/context/AuthContext';
import type { Facility, FacilityType, MealTime, OperatingHour, BookingStatus } from '@/types';

const VALID_TYPES: FacilityType[] = ['meeting_room','gym','conference_room','desk','swimming_pool','other'];

const TYPE_LABEL: Record<FacilityType, string> = {
  meeting_room: 'Meeting Room',
  gym: 'Gym',
  conference_room: 'Conference Room',
  desk: 'Desk',
  swimming_pool: 'Swimming Pool',
  other: 'Other',
};

const TYPE_EMOJI: Record<FacilityType, string> = {
  meeting_room: '👥', gym: '🏋️', conference_room: '🎤',
  desk: '🖥️', swimming_pool: '🏊', other: '🛋️',
};

type CheckState = 'idle' | 'checking' | 'free' | 'conflict' | 'error';

export default function FacilityDetailPage() {
  const { type: rawType } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const facilityType = VALID_TYPES.includes(rawType as FacilityType) ? (rawType as FacilityType) : null;

  // ----- data fetching ---------------------------------------------------
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityId, setFacilityId] = useState<number | ''>('');
  const [selected, setSelected] = useState<Facility | null>(null);
  const [hours, setHours] = useState<OperatingHour[]>([]);
  const [mealTimes, setMealTimes] = useState<MealTime[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ----- form state ------------------------------------------------------
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [fromTime, setFromTime] = useState('09:00');
  const [toTime, setToTime]     = useState('10:00');
  const [title, setTitle] = useState('');
  const [remarks, setRemarks] = useState('');
  const [selectedMealIds, setSelectedMealIds] = useState<number[]>([]);
  const [agreeTnc, setAgreeTnc] = useState(false);

  // Live conflict probe — only flips to "conflict" when the backend says so.
  const [checkState, setCheckState] = useState<CheckState>('idle');
  // Capacity-aware extras returned by /bookings/check (migration 021).
  // Populated whenever checkState transitions to 'free' or 'conflict'.
  const [checkInfo, setCheckInfo] = useState<{
    mode: 'exclusive' | 'shared';
    capacity: number;
    seatsTaken: number;
    seatsRemaining: number;
  } | null>(null);

  // Guests joining the booker. Email is required for each row. The booker
  // themselves is +1 implicitly (server-side: bookings.attendee_count =
  // 1 + guests.length). For shared facilities, the form refuses to submit
  // when 1 + guests.length > seatsRemaining for the chosen slot.
  const [guests, setGuests] = useState<{ email: string; fname?: string }[]>([]);
  const [pantryOrders, setPantryOrders] = useState<PantryOrder[]>([]); // F06
  function addGuest()  { setGuests((g) => [...g, { email: '' }]); }
  function delGuest(i: number) { setGuests((g) => g.filter((_, idx) => idx !== i)); }
  function setGuest(i: number, patch: Partial<{ email: string; fname?: string }>) {
    setGuests((g) => g.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }
  // Cheap guest validation: every row must have a non-empty email that
  // looks vaguely like one. We don't dedupe across rows (the server doesn't
  // care - one email twice still occupies two seats).
  const guestEmailError = useMemo(() => {
    for (let i = 0; i < guests.length; i++) {
      const e = (guests[i].email || '').trim();
      if (!e) return `Guest ${i + 1}: email is required`;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return `Guest ${i + 1}: email looks invalid`;
    }
    return null;
  }, [guests]);

  const [successOpen, setSuccessOpen] = useState(false);
  const [lastBookingId, setLastBookingId] = useState('');
  const [lastStatus, setLastStatus] = useState<BookingStatus>('approved');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Load the type's facility list + meal times (used by meeting rooms only).
  useEffect(() => {
    if (!facilityType) {
      setError('Unknown facility type'); setLoading(false); return;
    }
    setLoading(true);
    setError(null);
    Promise.all([
      facilitiesApi.list({ type: facilityType, limit: 200 }),
      mealTimesApi.list().catch(() => ({ data: [] as MealTime[] })),
    ])
      .then(([fRes, mRes]) => {
        const list = (fRes.data?.data || []).filter((f) => f.status);
        setFacilities(list);
        setMealTimes((mRes.data as MealTime[]) || []);
        if (list.length === 1) setFacilityId(list[0].id);
      })
      .catch((e: unknown) => {
        setError(
          (e as { response?: { data?: { msg?: string } } })?.response?.data?.msg
            || 'Failed to load facilities'
        );
      })
      .finally(() => setLoading(false));
  }, [facilityType]);

  // When the picked facility changes, fetch its detail (for operating_hours).
  useEffect(() => {
    if (!facilityId) { setSelected(null); setHours([]); setCheckState('idle'); return; }
    setLoadingDetail(true);
    facilitiesApi.getOne(Number(facilityId))
      .then((r) => {
        setSelected(r.data || null);
        setHours(r.data?.operating_hours || []);
      })
      .finally(() => setLoadingDetail(false));
  }, [facilityId]);

  // Build the YYYY-MM-DD HH:MM:SS strings the backend expects.
  const startAtStr = useMemo(() => {
    if (!date || !fromTime) return '';
    return `${date} ${fromTime}:00`;
  }, [date, fromTime]);
  const endAtStr = useMemo(() => {
    if (!date || !toTime) return '';
    return `${date} ${toTime}:00`;
  }, [date, toTime]);

  // Times must be in-range and well-ordered before we even bother calling
  // the backend. This is purely UX guardrails — the server re-validates.
  const localValidationError = useMemo(() => {
    if (!fromTime || !toTime) return 'Pick a start and end time';
    if (fromTime >= toTime) return 'End time must be after start time';
    return null;
  }, [fromTime, toTime]);

  // Debounced live conflict probe. Cancels in-flight requests when the
  // user is still typing so we don't show stale results.
  const probeSeqRef = useRef(0);
  useEffect(() => {
    if (!facilityId || !startAtStr || !endAtStr || localValidationError) {
      setCheckState('idle');
      return;
    }
    setCheckState('checking');
    const mySeq = ++probeSeqRef.current;
    const handle = window.setTimeout(() => {
      bookingsApi.check({
        facility_id: Number(facilityId),
        start_at: startAtStr,
        end_at: endAtStr,
        attendees: 1 + guests.length,
      })
        .then((res) => {
          if (mySeq !== probeSeqRef.current) return;     // newer probe in-flight
          if (!res.status || !res.data) { setCheckState('error'); setCheckInfo(null); return; }
          setCheckInfo({
            mode: res.data.mode,
            capacity: res.data.capacity,
            seatsTaken: res.data.seats_taken,
            seatsRemaining: res.data.seats_remaining,
          });
          setCheckState(res.data.conflict ? 'conflict' : 'free');
        })
        .catch(() => {
          if (mySeq !== probeSeqRef.current) return;
          setCheckState('error'); setCheckInfo(null);
        });
    }, 350);
    return () => window.clearTimeout(handle);
  }, [facilityId, startAtStr, endAtStr, localValidationError, guests.length]);

  async function handleConfirm() {
    if (!selected) return;
    if (localValidationError) { setSubmitError(localValidationError); return; }
    if (guestEmailError) { setSubmitError(guestEmailError); return; }
    if (checkState === 'conflict') {
      const msg = checkInfo && checkInfo.mode === 'shared'
        ? `Only ${checkInfo.seatsRemaining} seat(s) left in that slot - your party needs ${1 + guests.length}.`
        : 'That slot is already booked. Pick another time.';
      setSubmitError(msg);
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await bookingsApi.create({
        facility_id: selected.id,
        start_at: startAtStr,
        end_at: endAtStr,
        title: title || undefined,
        remarks: remarks || undefined,
        repeat_type: 'none',
        meal_time_ids: selectedMealIds,
        guests: guests.map((g) => ({
          fname: g.fname || undefined,
          email: g.email.trim(),
        })),
        pantry_orders: pantryOrders, // F06
      });
      if (!res.status || !res.data) throw new Error(res.msg || 'Booking failed');
      setLastBookingId(String(res.data.id));
      setLastStatus(res.data.status);
      setSuccessOpen(true);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { msg?: string } } })?.response?.data?.msg
        || (err as Error)?.message
        || 'Booking failed';
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  // ----- render ----------------------------------------------------------
  if (!facilityType) {
    return <Alert severity="error">Unknown facility type</Alert>;
  }
  if (loading) {
    return <Box display="flex" justifyContent="center" p={5}><CircularProgress /></Box>;
  }
  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  const typeLabel = TYPE_LABEL[facilityType];
  const dayRule = selected ? hours.find((h) => h.day_of_week === new Date(date).getDay()) : null;
  const location = selected ? [selected.site_name, selected.floor_name].filter(Boolean).join(' · ') : '';

  // Hint text for the time row: shows operating hours if we know them.
  const hoursHint = (() => {
    if (!selected) return '';
    if (!dayRule) return 'Facility is closed on the chosen date.';
    const open  = dayRule.open_time.slice(0, 5);
    const close = dayRule.close_time.slice(0, 5);
    return `Operating hours: ${open}–${close}`;
  })();

  const canSubmit =
    !!selected
    && !localValidationError
    && checkState === 'free'
    && agreeTnc
    && !submitting;

  return (
    <Box>
      <Breadcrumbs sx={{ mb: 1 }}>
        <MuiLink component={RouterLink} to="/facility" underline="hover" color="inherit">Book a facility</MuiLink>
        <Typography color="text.primary">{typeLabel}</Typography>
      </Breadcrumbs>

      <PageHeader
        title={`Book a ${typeLabel}`}
        back="/facility"
        subtitle={`${facilities.length} ${facilities.length === 1 ? 'space' : 'spaces'} available`}
      />

      {facilities.length === 0 ? (
        <Alert severity="info">
          No {typeLabel.toLowerCase()}s are available for your tenant. Ask your admin to add one.
        </Alert>
      ) : (
        <Grid container spacing={2}>
          <Grid item xs={12} md={5}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Pick a {typeLabel.toLowerCase()}</Typography>
              <TextField
                select fullWidth size="small" label={typeLabel}
                value={facilityId}
                onChange={(e) => setFacilityId(Number(e.target.value))}
              >
                {facilities.map((f) => (
                  <MenuItem key={f.id} value={f.id}>
                    {f.name} {f.site_name ? `· ${f.site_name}` : ''} {f.capacity ? `· ${f.capacity} seats` : ''}
                  </MenuItem>
                ))}
              </TextField>

              {loadingDetail && (
                <Box display="flex" justifyContent="center" py={4}><CircularProgress size={24} /></Box>
              )}

              {selected && !loadingDetail && (
                <Box sx={{ mt: 2 }}>
                  <Box sx={{
                    height: 160, bgcolor: 'action.hover',
                    borderRadius: 1, display: 'flex',
                    alignItems: 'center', justifyContent: 'center', fontSize: 48, mb: 2,
                  }}>
                    {TYPE_EMOJI[facilityType]}
                  </Box>
                  <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>{selected.name}</Typography>
                  {location && (
                    <Stack direction="row" alignItems="center" spacing={0.5} sx={{ color: 'text.secondary', mb: 0.5 }}>
                      <LocationOnIcon sx={{ fontSize: 16 }} />
                      <Typography variant="body2">{location}</Typography>
                    </Stack>
                  )}
                  <Stack direction="row" alignItems="center" spacing={0.5} sx={{ color: 'text.secondary', mb: 1 }}>
                    <GroupsIcon sx={{ fontSize: 16 }} />
                    <Typography variant="body2">Seats {selected.capacity}</Typography>
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {selected.description || 'A bookable space at your campus.'}
                  </Typography>
                  {selected.requires_approval ? (
                    <Alert severity="warning" sx={{ mt: 1.5 }}>
                      This booking needs manager approval. You'll get an email when it's reviewed.
                    </Alert>
                  ) : null}
                </Box>
              )}
            </Paper>
          </Grid>

          <Grid item xs={12} md={7}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Pick a time</Typography>

              {!selected ? (
                <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                  Pick a {typeLabel.toLowerCase()} on the left to see availability.
                </Typography>
              ) : (
                <>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} mb={1}>
                    <TextField
                      type="date" label="Date" size="small" InputLabelProps={{ shrink: true }}
                      value={date} onChange={(e) => setDate(e.target.value)}
                      sx={{ minWidth: 160 }}
                    />
                    {/* 5-minute granularity (step=300s) feels right for rooms */}
                    <TextField
                      type="time" label="From" size="small" InputLabelProps={{ shrink: true }}
                      value={fromTime}
                      onChange={(e) => setFromTime(e.target.value)}
                      inputProps={{ step: 300 }}
                      sx={{ minWidth: 140 }}
                    />
                    <TextField
                      type="time" label="To" size="small" InputLabelProps={{ shrink: true }}
                      value={toTime}
                      onChange={(e) => setToTime(e.target.value)}
                      inputProps={{ step: 300 }}
                      sx={{ minWidth: 140 }}
                    />
                  </Stack>
                  <Typography variant="caption" color="text.secondary">{hoursHint}</Typography>

                  {/* Availability indicator */}
                  <Box sx={{ mt: 2 }}>
                    {localValidationError ? (
                      <Alert severity="info" variant="outlined">{localValidationError}</Alert>
                    ) : checkState === 'checking' ? (
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <CircularProgress size={16} />
                        <Typography variant="body2" color="text.secondary">Checking availability…</Typography>
                      </Stack>
                    ) : checkState === 'conflict' ? (
                      <Alert severity="error" icon={<EventBusyIcon />} variant="outlined">
                        That time is already booked at <strong>{selected.name}</strong>.
                        Try a different slot.
                      </Alert>
                    ) : checkState === 'free' ? (
                      <Alert severity="success" icon={<EventAvailableIcon />} variant="outlined">
                        <strong>{fromTime}</strong>–<strong>{toTime}</strong> is open on {date}.
                      </Alert>
                    ) : checkState === 'error' ? (
                      <Alert severity="warning" variant="outlined">
                        Couldn't check availability right now. You can still try to book —
                        the server will reject the slot if it conflicts.
                      </Alert>
                    ) : null}
                  </Box>

                  <Divider sx={{ my: 3 }} />
                  <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>Your booking</Typography>
                  <Stack spacing={2}>
                    <TextField label="Title" size="small" fullWidth value={title}
                      onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Sprint planning" />
                    <TextField label="Remarks" size="small" fullWidth multiline minRows={2}
                      value={remarks} onChange={(e) => setRemarks(e.target.value)} />

                    {/* ----- Attendees / guests ----- */}
                    <Box>
                      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          People joining you (besides yourself)
                        </Typography>
                        {checkInfo && checkInfo.mode === 'shared' && (
                          <Chip
                            size="small"
                            color={checkState === 'conflict' ? 'error' : 'success'}
                            label={
                              `${checkInfo.seatsTaken} of ${checkInfo.capacity} seats taken` +
                              ` - up to ${Math.max(0, checkInfo.seatsRemaining - 1)} guests`
                            }
                          />
                        )}
                        {checkInfo && checkInfo.mode === 'exclusive' && selected && (
                          <Chip
                            size="small"
                            variant="outlined"
                            label={`Capacity ${selected.capacity}`} />
                        )}
                      </Stack>

                      {guests.length === 0 && (
                        <Typography variant="caption" color="text.secondary">
                          Just you so far. Add emails of people who'll be joining.
                        </Typography>
                      )}

                      <Stack spacing={1} mt={1}>
                        {guests.map((g, i) => (
                          <Stack key={i} direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
                            <TextField
                              size="small" type="email" label={`Guest ${i + 1} email`} required
                              value={g.email}
                              onChange={(e) => setGuest(i, { email: e.target.value })}
                              sx={{ flex: 1, minWidth: 220 }}
                            />
                            <TextField
                              size="small" label="Name (optional)"
                              value={g.fname || ''}
                              onChange={(e) => setGuest(i, { fname: e.target.value })}
                              sx={{ width: { xs: '100%', sm: 220 } }}
                            />
                            <Button size="small" color="error" onClick={() => delGuest(i)}>Remove</Button>
                          </Stack>
                        ))}
                      </Stack>

                      <Box mt={1}>
                        <Button
                          size="small" variant="outlined" onClick={addGuest}
                          disabled={
                            !!checkInfo && checkInfo.mode === 'shared'
                              && (1 + guests.length + 1) > (checkInfo.seatsTaken + checkInfo.seatsRemaining)
                          }
                        >
                          Add guest
                        </Button>
                      </Box>
                    </Box>

                    {/* Department line - auto-pulled from the logged-in user. */}
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Typography variant="body2" color="text.secondary">Booked for:</Typography>
                      <Chip
                        size="small"
                        label={user?.department_id ? `Your department (#${user.department_id})` : 'No department on file'}
                        color={user?.department_id ? 'primary' : 'default'}
                        variant={user?.department_id ? 'filled' : 'outlined'}
                      />
                    </Stack>

                    {facilityType === 'meeting_room' && mealTimes.length > 0 && (
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: 500, mb: 1 }}>Pre-book meals (optional)</Typography>
                        <Stack direction="row" flexWrap="wrap" gap={1}>
                          {mealTimes.map((m) => {
                            const on = selectedMealIds.includes(m.id);
                            return (
                              <Chip
                                key={m.id}
                                label={`${m.name} - ${m.start_time.slice(0, 5)}`}
                                color={on ? 'primary' : 'default'}
                                variant={on ? 'filled' : 'outlined'}
                                onClick={() => setSelectedMealIds((ids) => on ? ids.filter((x) => x !== m.id) : [...ids, m.id])}
                                clickable
                              />
                            );
                          })}
                        </Stack>
                      </Box>
                    )}

                    <FormControlLabel
                      control={<Checkbox checked={agreeTnc} onChange={(e) => setAgreeTnc(e.target.checked)} />}
                      label={<>Yes, I agree to the <a href="#">Terms &amp; Conditions</a></>}
                    />

                    {/* F06 - pantry order panel (only renders if facility's
                        site has linked pantries) */}
                    {selected && (
                      <PantryOrderPanel
                        facilityId={selected.id}
                        onChange={setPantryOrders}
                      />
                    )}

                    {submitError && <Alert severity="error">{submitError}</Alert>}
                    <Stack direction="row" justifyContent="flex-end" spacing={1}>
                      <Button onClick={() => navigate('/facility')} disabled={submitting}>Cancel</Button>
                      <Button variant="contained" disabled={!canSubmit} onClick={handleConfirm}>
                        {submitting ? 'Saving...' : 'Confirm booking'}
                      </Button>
                    </Stack>
                  </Stack>
                </>
              )}
            </Paper>
          </Grid>
        </Grid>
      )}

      <BookingSuccessDialog
        open={successOpen}
        bookingId={lastBookingId}
        pending={lastStatus === 'pending'}
        onClose={() => setSuccessOpen(false)}
        onCreateNew={() => { setSuccessOpen(false); navigate('/facility'); }}
        onViewDetails={() => {
          setSuccessOpen(false);
          navigate('/my-bookings?highlight=' + encodeURIComponent(lastBookingId));
        }}
      />
    </Box>
  );
}
