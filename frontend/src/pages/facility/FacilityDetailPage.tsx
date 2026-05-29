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
import DeskPicker from './components/DeskPicker'; // F09
import SlotGrid from './components/SlotGrid';
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
  // True once the user actually clicks a slot. Used to defer the floor
  // map + downstream form sections until a time is picked — mirrors the
  // BookMyShow flow of "pick showtime, then pick seats".
  const [slotPicked, setSlotPicked] = useState(false);
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
  // F09 - desk selection. Multi-select: each chair = one attendee. Guests
  // section only opens after the first chair is picked, and the guest rows
  // are auto-synced to (selected chairs - 1) so we never reserve seats
  // nobody needs. occupiedDesks comes back from /bookings/check.
  const [selectedDeskIds, setSelectedDeskIds] = useState<string[]>([]);
  const [occupiedDesks, setOccupiedDesks] = useState<string[]>([]);
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

  // F09 - for desk facilities the guest rows mirror the chair count
  // (selected chairs - 1, since the booker themselves takes one chair).
  // Add a chair => a new row appears; un-pick a chair => the trailing row
  // is dropped. Non-desk types keep the manual Add guest workflow.
  useEffect(() => {
    if (!selected || selected.type !== 'desk') return;
    const target = Math.max(0, selectedDeskIds.length - 1);
    setGuests((prev) => {
      if (prev.length === target) return prev;
      if (prev.length < target) {
        const extra = Array.from({ length: target - prev.length }, () => ({ email: '' } as { email: string; fname?: string }));
        return [...prev, ...extra];
      }
      return prev.slice(0, target);
    });
  }, [selectedDeskIds.length, selected?.type]);

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

  // Day-of-week rule for the chosen date (operating hours). Used both by
  // the time-field min/max and the client-side validator below.
  const dayRule = useMemo(() => {
    if (!selected) return null;
    return hours.find((h) => h.day_of_week === new Date(date).getDay()) || null;
  }, [selected, hours, date]);
  const openHHMM  = dayRule ? dayRule.open_time.slice(0, 5)  : '';
  const closeHHMM = dayRule ? dayRule.close_time.slice(0, 5) : '';

  // Times must be in-range and well-ordered before we even bother calling
  // the backend. This is purely UX guardrails — the server re-validates.
  // Also enforces the facility's advance-booking rules (lead time + max
  // horizon) so the booker gets immediate feedback instead of a 422 round-trip.
  const localValidationError = useMemo(() => {
    if (!fromTime || !toTime) return 'Pick a start and end time';
    if (fromTime >= toTime) return 'End time must be after start time';
    if (selected) {
      if (!dayRule) return 'Facility is closed on the chosen date. Pick another day.';
      if (fromTime < openHHMM)  return `Booking must start at ${openHHMM} or later (operating hours).`;
      if (toTime   > closeHHMM) return `Booking must end by ${closeHHMM} (operating hours).`;
      // Advance-rule guards (lead time + max horizon).
      if (date) {
        const startMs = new Date(`${date}T${fromTime}:00`).getTime();
        const nowMs = Date.now();
        const minAdv = Number(selected.min_advance_minutes);
        if (Number.isFinite(minAdv) && minAdv > 0) {
          const leadMin = (startMs - nowMs) / 60000;
          if (leadMin < minAdv) {
            return `This facility requires booking at least ${minAdv} minute(s) in advance.`;
          }
        }
        const maxDays = Number(selected.max_advance_days);
        if (Number.isFinite(maxDays) && maxDays > 0) {
          const leadDays = (startMs - nowMs) / 86400000;
          if (leadDays > maxDays) {
            return `This facility can't be booked more than ${maxDays} day(s) in advance.`;
          }
        }
      }
    }
    return null;
  }, [fromTime, toTime, selected, dayRule, openHHMM, closeHHMM, date]);

  // Date input min/max derived from the facility's max_advance_days, plus
  // the min_advance_minutes (which we round up to a day for the date picker
  // — actual minute-level guard runs in localValidationError above).
  const todayISO = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }, []);
  const maxDateISO = useMemo(() => {
    if (!selected) return undefined;
    const maxDays = Number(selected.max_advance_days);
    if (!Number.isFinite(maxDays) || maxDays <= 0) return undefined;
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + maxDays);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }, [selected]);
  // One-line summary of active rules to show under the date row.
  const rulesHint = useMemo(() => {
    if (!selected) return '';
    const bits: string[] = [];
    const minAdv = Number(selected.min_advance_minutes);
    if (Number.isFinite(minAdv) && minAdv > 0) bits.push(`min ${minAdv} min ahead`);
    const maxDays = Number(selected.max_advance_days);
    if (Number.isFinite(maxDays) && maxDays > 0) bits.push(`up to ${maxDays} day(s) ahead`);
    const d = Number(selected.max_per_user_per_day);
    if (Number.isFinite(d) && d > 0) bits.push(`max ${d}/day per user`);
    const w = Number(selected.max_per_user_per_week);
    if (Number.isFinite(w) && w > 0) bits.push(`max ${w}/week per user`);
    const m = Number(selected.max_per_user_per_month);
    if (Number.isFinite(m) && m > 0) bits.push(`max ${m}/month per user`);
    return bits.length ? `Booking rules: ${bits.join(' · ')}.` : '';
  }, [selected]);

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
      // For desk facilities the attendee count IS the chair count - each
      // claimed chair = one bottom in a seat. For everything else the
      // booker + their guests are the head count.
      const attendees = selected && selected.type === 'desk'
        ? Math.max(1, selectedDeskIds.length)
        : 1 + guests.length;
      bookingsApi.check({
        facility_id: Number(facilityId),
        start_at: startAtStr,
        end_at: endAtStr,
        attendees,
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
          // F09 - refresh which chairs are taken for this window. Any of
          // the booker's picks that just got claimed by someone else are
          // dropped from the selection so they have to re-pick.
          const occ = res.data.occupied_desks || [];
          setOccupiedDesks(occ);
          setSelectedDeskIds((prev) => prev.filter((id) => !occ.includes(id)));
        })
        .catch(() => {
          if (mySeq !== probeSeqRef.current) return;
          setCheckState('error'); setCheckInfo(null);
        });
    }, 350);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facilityId, startAtStr, endAtStr, localValidationError, guests.length, selectedDeskIds.length, selected?.type]);

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
    // F09 - desk facilities require at least one chair when the admin has
    // actually laid chairs on the floor plan. Also reject if any of the
    // picked chairs got grabbed by someone else while the form sat open.
    if (selected.type === 'desk' && layoutChairCount > 0) {
      if (selectedDeskIds.length === 0) {
        setSubmitError('Pick at least one chair from the floor plan below before confirming.');
        return;
      }
      const stolen = selectedDeskIds.filter((id) => occupiedDesks.includes(id));
      if (stolen.length > 0) {
        setSubmitError(`Chair${stolen.length === 1 ? '' : 's'} ${stolen.join(', ')} ${stolen.length === 1 ? 'was' : 'were'} just claimed by someone else. Pick another${stolen.length === 1 ? ' one' : ''}.`);
        setSelectedDeskIds((prev) => prev.filter((id) => !occupiedDesks.includes(id)));
        return;
      }
      if (guests.length > selectedDeskIds.length - 1) {
        setSubmitError(`You've claimed ${selectedDeskIds.length} chair${selectedDeskIds.length === 1 ? '' : 's'} but added ${guests.length} guest${guests.length === 1 ? '' : 's'}. Pick more chairs or remove some guests.`);
        return;
      }
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
        // F09 - send the multi-chair selection as a comma-joined string;
        // backend splits it for the race check.
        desk_id: selected.type === 'desk' && selectedDeskIds.length > 0
          ? selectedDeskIds.join(',')
          : undefined,
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
  const location = selected ? [selected.site_name, selected.floor_name].filter(Boolean).join(' · ') : '';

  // Hint text for the time row: shows operating hours if we know them.
  const hoursHint = (() => {
    if (!selected) return '';
    if (!dayRule) return 'Facility is closed on the chosen date.';
    const open  = dayRule.open_time.slice(0, 5);
    const close = dayRule.close_time.slice(0, 5);
    return `Operating hours: ${open}–${close}`;
  })();

  // For desk facilities only block submit when the admin has actually
  // placed chairs on the layout. If layout has no chairs (admin hasn't
  // gotten round to it), fall through to the regular booking flow.
  const layoutChairCount = (() => {
    if (!selected || !selected.layout_json) return 0;
    try {
      const parsed = typeof selected.layout_json === 'string'
        ? JSON.parse(selected.layout_json)
        : selected.layout_json;
      const objs = parsed && Array.isArray(parsed.objects) ? parsed.objects : [];
      return objs.filter((o: { type?: string }) => o && o.type === 'chair').length;
    } catch { return 0; }
  })();
  const canSubmit =
    !!selected
    && !localValidationError
    && checkState === 'free'
    && agreeTnc
    && !submitting
    // F09 - on desk facilities, block submit until the user has claimed at
    // least one chair and every claimed chair is still free.
    && (selected.type !== 'desk' || layoutChairCount === 0
        || (selectedDeskIds.length > 0
            && selectedDeskIds.every((id) => !occupiedDesks.includes(id))
            && guests.length <= Math.max(0, selectedDeskIds.length - 1)));

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
        // Single-column form. Everything stacks top-to-bottom so the
        // booker can scroll through and fill the whole thing in one pass
        // instead of bouncing between two columns.
        <Paper variant="outlined" sx={{ p: 2 }}>
          {/* 1) Facility picker */}
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
            Pick a {typeLabel.toLowerCase()}
          </Typography>
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

          {/* 2) Facility summary (no image - keeps the page lean) */}
          {selected && !loadingDetail && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>{selected.name}</Typography>
              <Stack direction="row" alignItems="center" spacing={2} flexWrap="wrap" sx={{ color: 'text.secondary', mb: 1 }}>
                {location && (
                  <Stack direction="row" alignItems="center" spacing={0.5}>
                    <LocationOnIcon sx={{ fontSize: 16 }} />
                    <Typography variant="body2">{location}</Typography>
                  </Stack>
                )}
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <GroupsIcon sx={{ fontSize: 16 }} />
                  <Typography variant="body2">Seats {selected.capacity}</Typography>
                </Stack>
              </Stack>
              {selected.description && (
                <Typography variant="body2" color="text.secondary">{selected.description}</Typography>
              )}
              {selected.requires_approval ? (
                <Alert severity="warning" sx={{ mt: 1.5 }}>
                  This booking needs manager approval. You'll get an email when it's reviewed.
                </Alert>
              ) : null}
            </Box>
          )}

          {!selected && !loadingDetail && (
            <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
              Pick a {typeLabel.toLowerCase()} above to start filling out the booking details.
            </Typography>
          )}

          {/* 3) Time + the rest of the form */}
          {selected && (
            <>
              <Divider sx={{ my: 3 }} />
              <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Pick a time</Typography>
                  {/* Date picker stays as a regular input — slot grid
                      reflows whenever this changes. */}
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} mb={1.5} alignItems={{ sm: 'flex-end' }}>
                    <TextField
                      type="date" label="Date" size="small" InputLabelProps={{ shrink: true }}
                      value={date}
                      onChange={(e) => {
                        setDate(e.target.value);
                        setSlotPicked(false);  // changing day clears the slot
                      }}
                      inputProps={{ min: todayISO, max: maxDateISO }}
                      sx={{ minWidth: 160 }}
                    />
                    <Typography variant="caption" color="text.secondary">{hoursHint}</Typography>
                  </Stack>
                  {rulesHint && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                      {rulesHint}
                    </Typography>
                  )}

                  {/* BookMyShow-style slot grid. One button per bookable
                      slot derived from the facility's operating_hours +
                      slot_minutes. Click sets fromTime/toTime + flags
                      slotPicked so the floor map / guests section can
                      render below. */}
                  <SlotGrid
                    facilityId={selected.id}
                    date={date}
                    dayRule={dayRule}
                    attendees={selected.type === 'desk'
                      ? Math.max(1, selectedDeskIds.length || 1)
                      : 1 + guests.length}
                    selectedStart={slotPicked ? fromTime : ''}
                    onPick={(start, end) => {
                      setFromTime(start);
                      setToTime(end);
                      setSlotPicked(true);
                    }}
                  />

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

                  {/* F09 - floor-plan view. Shown for any facility that has
                       a saved layout (desk + meeting_room). For desks the
                       chairs are clickable; for meeting rooms it's a
                       read-only "here's where this room sits on the floor"
                       reference. */}
                  {/* Floor map reveals AFTER a slot is clicked — mirrors
                      BookMyShow's "pick showtime → pick seats" flow. */}
                  {slotPicked
                    && (selected.type === 'desk' || selected.type === 'meeting_room')
                    && !localValidationError
                    && selected.layout_json && (
                    <Box sx={{ mt: 3 }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                        {selected.type === 'desk' ? 'Pick your chair' : 'Floor plan'}
                      </Typography>
                      <DeskPicker
                        value={selected.layout_json ?? null}
                        occupiedDeskIds={occupiedDesks}
                        selectedDeskIds={selectedDeskIds}
                        onToggle={(id) => {
                          if (occupiedDesks.includes(id)) return; // belt and braces
                          setSelectedDeskIds((prev) => prev.includes(id)
                            ? prev.filter((x) => x !== id)
                            : [...prev, id]);
                        }}
                      />
                      {selected.type === 'desk' && (selectedDeskIds.length > 0 ? (
                        <Alert severity="success" sx={{ mt: 1 }}>
                          You've claimed <strong>{selectedDeskIds.length}</strong> chair{selectedDeskIds.length === 1 ? '' : 's'}
                          {' '}(<strong>{selectedDeskIds.join(', ')}</strong>). They'll be locked to you once you confirm.
                        </Alert>
                      ) : (
                        <Alert severity="info" sx={{ mt: 1 }}>
                          Click available (green) chairs above to claim them — one chair per attendee.
                        </Alert>
                      ))}
                      {selected.type === 'meeting_room' && (
                        <Alert severity="info" sx={{ mt: 1 }}>
                          This room is highlighted on the floor plan above.
                        </Alert>
                      )}
                    </Box>
                  )}

                  <Divider sx={{ my: 3 }} />
                  <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>Your booking</Typography>
                  <Stack spacing={2}>
                    <TextField label="Title" size="small" fullWidth value={title}
                      onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Sprint planning" />
                    <TextField label="Remarks" size="small" fullWidth multiline minRows={2}
                      value={remarks} onChange={(e) => setRemarks(e.target.value)} />

                    {/* Live seat-count chip for desks - always shown so
                        the booker can see "0 of 8 chairs taken · up to
                        7 guests" before they've clicked anything, and the
                        numbers tick up as they pick. */}
                    {selected && selected.type === 'desk' && layoutChairCount > 0 && (() => {
                      const taken  = occupiedDesks.length;
                      const total  = layoutChairCount;
                      const picked = selectedDeskIds.length;
                      const upTo = picked > 0
                        ? Math.max(0, picked - 1)
                        : Math.max(0, total - taken - 1);
                      return (
                        <Stack direction="row" alignItems="center" spacing={1}>
                          <Chip
                            size="small"
                            color={checkState === 'conflict' ? 'error' : (picked > 0 ? 'primary' : 'success')}
                            label={
                              `${taken} of ${total} chair${total === 1 ? '' : 's'} taken` +
                              (picked > 0 ? ` · ${picked} picked` : '') +
                              ` · up to ${upTo} guest${upTo === 1 ? '' : 's'}`
                            }
                          />
                        </Stack>
                      );
                    })()}

                    {/* ----- Attendees / guests -----
                          For desk facilities the guest section stays hidden
                          until the booker has actually claimed a chair, and
                          the cap is (chairs - 1) because each chair = one
                          attendee (booker + guests). */}
                    {!(selected.type === 'desk' && layoutChairCount > 0 && selectedDeskIds.length === 0) && (
                    <Box>
                      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          {selected.type === 'desk' && selectedDeskIds.length > 0
                            ? `Guests for the other ${Math.max(0, selectedDeskIds.length - 1)} chair${selectedDeskIds.length - 1 === 1 ? '' : 's'}`
                            : 'People joining you (besides yourself)'}
                        </Typography>
                        {selected && selected.type !== 'desk' && checkInfo && checkInfo.mode === 'shared' && (
                          <Chip
                            size="small"
                            color={checkState === 'conflict' ? 'error' : 'success'}
                            label={
                              `${checkInfo.seatsTaken} of ${checkInfo.capacity} seats taken` +
                              ` - up to ${Math.max(0, checkInfo.seatsRemaining - 1)} guests`
                            }
                          />
                        )}
                        {selected && selected.type !== 'desk' && checkInfo && checkInfo.mode === 'exclusive' && (
                          <Chip
                            size="small"
                            variant="outlined"
                            label={`Capacity ${selected.capacity}`} />
                        )}
                      </Stack>

                      {guests.length === 0 && (
                        <Typography variant="caption" color="text.secondary">
                          {selected.type === 'desk'
                            ? 'You\'ve only claimed your own chair so far. Pick more chairs above to add guests.'
                            : 'Just you so far. Add emails of people who\'ll be joining.'}
                        </Typography>
                      )}

                      <Stack spacing={1} mt={1}>
                        {guests.map((g, i) => {
                          // On desks, each guest row corresponds to one of
                          // the selected chairs after the booker's own.
                          // Label the row with that chair id when we know it.
                          const isDesk = selected.type === 'desk';
                          const chairForRow = isDesk ? selectedDeskIds[i + 1] : null;
                          return (
                            <Stack key={i} direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
                              <TextField
                                size="small" type="email" required
                                label={chairForRow ? `Guest for ${chairForRow}` : `Guest ${i + 1} email`}
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
                              {!isDesk && (
                                <Button size="small" color="error" onClick={() => delGuest(i)}>Remove</Button>
                              )}
                            </Stack>
                          );
                        })}
                      </Stack>

                      {/* Add guest button only for non-desk facilities -
                          desks auto-spawn one row per claimed chair. */}
                      {selected.type !== 'desk' && (
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
                      )}
                    </Box>
                    )}

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
//         pending={lastStatus === 'pending'}
//         onClose={() => setSuccessOpen(false)}
//         onCreateNew={() => { setSuccessOpen(false); navigate('/facility'); }}
//         onViewDetails={() => {
//           setSuccessOpen(false);
//           navigate('/my-bookings?highlight=' + encodeURIComponent(lastBookingId));
//         }}
//       />
//     </Box>
//   );
// }
