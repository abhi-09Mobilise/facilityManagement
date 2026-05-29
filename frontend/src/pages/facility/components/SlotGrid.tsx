// BookMyShow-style time-slot picker.
//
// Renders one button per bookable slot on the chosen date, derived from
// the facility's operating_hours.slot_minutes step. Each button shows:
//   - Start time (e.g. "09:00")
//   - Status: Available / N seats left (shared) / Full / Past / Closed
//
// The parent component owns the date + selected slot. We just emit
// `onPick(start, end)` when the user clicks a usable slot.
//
// Availability is fetched via parallel /bookings/check calls — one per
// slot. For an 8-hour day at 30-min slots that's 16 round-trips; runs in
// well under a second on a modern machine. If volume grows we'll add a
// batch endpoint and swap the fetch out without touching the UI.

import { useEffect, useMemo, useState } from 'react';
import { Box, Stack, Typography, CircularProgress, Chip } from '@mui/material';
import { bookingsApi } from '@/api/bookings.api';
import type { OperatingHour } from '@/types';

interface Slot {
  start: string;  // "HH:MM"
  end:   string;  // "HH:MM"
}

interface SlotAvailability {
  conflict: boolean;
  mode: 'exclusive' | 'shared';
  seats_remaining: number;
  capacity: number;
}

interface Props {
  facilityId: number | null;
  date: string;                       // YYYY-MM-DD
  dayRule: OperatingHour | null;      // null = closed for the day
  attendees: number;                  // count we plan to put in the slot
  selectedStart: string;              // currently-picked slot start, "" = none
  onPick: (start: string, end: string) => void;
}

// Turn "HH:MM" or "HH:MM:SS" into minutes-since-midnight.
function toMin(t: string): number {
  const [h, m] = t.split(':').map((s) => parseInt(s, 10));
  return (h || 0) * 60 + (m || 0);
}
// Format minutes-since-midnight back to "HH:MM".
function toHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function buildSlots(dayRule: OperatingHour | null): Slot[] {
  if (!dayRule) return [];
  const step = Math.max(5, dayRule.slot_minutes || 30);
  const open = toMin(dayRule.open_time);
  const close = toMin(dayRule.close_time);
  const out: Slot[] = [];
  for (let m = open; m + step <= close; m += step) {
    out.push({ start: toHHMM(m), end: toHHMM(m + step) });
  }
  return out;
}

export default function SlotGrid({
  facilityId, date, dayRule, attendees, selectedStart, onPick,
}: Props) {
  const slots = useMemo(() => buildSlots(dayRule), [dayRule]);

  // Per-slot availability keyed by start time.
  const [avail, setAvail] = useState<Record<string, SlotAvailability>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!facilityId || !date || slots.length === 0) {
      setAvail({});
      return;
    }
    let alive = true;
    setLoading(true);
    setAvail({});
    // Fire one /check per slot in parallel. The endpoint is cheap (one
    // SUM + one capacity compare on the server) so this is fine for the
    // ~10–30 slots a typical day has.
    const promises = slots.map((s) =>
      bookingsApi
        .check({
          facility_id: facilityId,
          start_at: `${date} ${s.start}:00`,
          end_at:   `${date} ${s.end}:00`,
          attendees: Math.max(1, attendees || 1),
        })
        .then((res) => ({
          start: s.start,
          data: res.data as SlotAvailability | undefined,
        }))
        .catch(() => ({ start: s.start, data: undefined }))
    );
    Promise.all(promises).then((results) => {
      if (!alive) return;
      const map: Record<string, SlotAvailability> = {};
      for (const r of results) {
        if (r.data) map[r.start] = r.data;
      }
      setAvail(map);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [facilityId, date, slots, attendees]);

  // Closed day → friendly message instead of an empty grid.
  if (!dayRule) {
    return (
      <Box sx={{ py: 3, textAlign: 'center', color: 'text.secondary' }}>
        <Typography variant="body2">
          Facility is closed on the chosen date. Pick another day.
        </Typography>
      </Box>
    );
  }

  if (slots.length === 0) {
    return (
      <Box sx={{ py: 3, textAlign: 'center', color: 'text.secondary' }}>
        <Typography variant="body2">
          No slots configured for this day. Ask your admin to set
          operating hours.
        </Typography>
      </Box>
    );
  }

  const nowMs = Date.now();

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
          {dayRule.open_time.slice(0, 5)} – {dayRule.close_time.slice(0, 5)} · {dayRule.slot_minutes}-min slots
        </Typography>
        {loading && <CircularProgress size={14} />}
      </Stack>

      {/* CSS grid so the buttons reflow on smaller screens without each
          one becoming awkwardly wide. */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
          gap: 1,
        }}
      >
        {slots.map((s) => {
          const a = avail[s.start];
          const startMs = new Date(`${date}T${s.start}:00`).getTime();
          const isPast = startMs < nowMs;
          // While we're loading, no slot is disabled but also none is
          // clickable yet — show a neutral state.
          const known = !!a;
          const isFull = known && a.conflict;
          const isFree = known && !a.conflict;
          const isActive = selectedStart === s.start;
          const disabled = isPast || isFull;

          // Render strategy:
          //   active     → solid primary border + bg
          //   free       → outlined, hover lifts
          //   full       → muted bg, line-through time
          //   past       → muted bg, dimmed text
          //   loading    → outlined, no status row
          const bg =
            isActive ? 'primary.main'
            : isPast || isFull ? 'action.hover'
            : 'background.paper';
          const color =
            isActive ? 'primary.contrastText'
            : isPast || isFull ? 'text.disabled'
            : 'text.primary';
          const borderColor =
            isActive ? 'primary.main'
            : isFree ? 'success.light'
            : 'divider';

          // Status line under the time. Kept very short.
          let statusLine: React.ReactNode = null;
          if (!known) {
            statusLine = <span style={{ color: 'rgba(0,0,0,0.4)' }}>…</span>;
          } else if (isPast) {
            statusLine = 'Past';
          } else if (isFull) {
            statusLine = a.mode === 'exclusive' ? 'Booked' : 'Full';
          } else if (a.mode === 'shared') {
            statusLine = `${a.seats_remaining} left`;
          } else {
            statusLine = 'Available';
          }

          return (
            <Box
              key={s.start}
              component="button"
              type="button"
              disabled={disabled}
              onClick={() => onPick(s.start, s.end)}
              sx={{
                cursor: disabled ? 'not-allowed' : 'pointer',
                bgcolor: bg,
                color,
                border: '1.5px solid',
                borderColor,
                borderRadius: 1.5,
                py: 1, px: 1.5,
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: 0.25,
                fontFamily: 'inherit',
                fontWeight: 500,
                transition: 'transform 0.12s ease, box-shadow 0.12s ease, border-color 0.12s ease',
                '&:hover:not(:disabled)': {
                  borderColor: isActive ? 'primary.dark' : 'primary.light',
                  transform: 'translateY(-1px)',
                  boxShadow: 1,
                },
              }}
            >
              <Box sx={{
                fontSize: '0.95rem',
                fontWeight: 600,
                textDecoration: isFull ? 'line-through' : 'none',
              }}>
                {s.start}
              </Box>
              <Box sx={{ fontSize: '0.7rem', fontWeight: 400, opacity: 0.85 }}>
                {statusLine}
              </Box>
            </Box>
          );
        })}
      </Box>

      {/* Tiny legend so the colours/states are decodable. */}
      <Stack direction="row" spacing={1.5} sx={{ mt: 1.5, flexWrap: 'wrap', rowGap: 1 }}>
        <Chip size="small" variant="outlined" label="Available"
          sx={{ borderColor: 'success.light' }} />
        <Chip size="small" label="Selected"
          sx={{ bgcolor: 'primary.main', color: 'primary.contrastText' }} />
        <Chip size="small" label="Full / Past"
          sx={{ bgcolor: 'action.hover', color: 'text.disabled' }} />
      </Stack>
    </Box>
  );
}
