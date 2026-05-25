import { useMemo } from 'react';
import {
  Box, Card, CardContent, CardActions, Typography, Button, Grid, Chip, Stack,
} from '@mui/material';
import GroupsIcon from '@mui/icons-material/Groups';
import type { Facility, FacilityType } from '@/types';

interface Props {
  facilities: Facility[];
  onBook: (type: FacilityType) => void;
}

const TYPE_EMOJI: Record<FacilityType, string> = {
  meeting_room: '👥',
  gym: '🏋️',
  conference_room: '🎤',
  desk: '🖥️',
  swimming_pool: '🏊',
  other: '🛋️',
};

const TYPE_LABEL: Record<FacilityType, string> = {
  meeting_room: 'Meeting Room',
  gym: 'Gym',
  conference_room: 'Conference Room',
  desk: 'Desk',
  swimming_pool: 'Swimming Pool',
  other: 'Other',
};

// Short marketing-y copy per type, used when no per-facility description is set.
const TYPE_BLURB: Record<FacilityType, string> = {
  meeting_room:    'Small huddle spaces for 1:1s and team sessions.',
  conference_room: 'Larger rooms for presentations and big group meetings.',
  gym:             'On-site gym facilities for workouts and fitness sessions.',
  desk:            'Hot-desks you can claim for the day.',
  swimming_pool:   'Pool access with lockers and showers.',
  other:           'Other bookable spaces on campus.',
};

interface Bucket {
  type: FacilityType;
  facilities: Facility[];
  totalSeats: number;
}

/**
 * One card per facility *type* the tenant has at least one facility of.
 * Each card shows: emoji, type name, count, sample names, blurb, "Book now".
 * Book now → caller routes to /facility/type/:type, where the employee picks
 * the specific facility from a dropdown.
 */
export default function FacilityCardGrid({ facilities, onBook }: Props) {
  const buckets = useMemo<Bucket[]>(() => {
    const map = new Map<FacilityType, Bucket>();
    for (const f of facilities) {
      if (!f.status) continue; // only active
      if (!map.has(f.type)) {
        map.set(f.type, { type: f.type, facilities: [], totalSeats: 0 });
      }
      const b = map.get(f.type) as Bucket;
      b.facilities.push(f);
      b.totalSeats += f.capacity || 0;
    }
    return Array.from(map.values()).sort((a, b) =>
      (TYPE_LABEL[a.type] || a.type).localeCompare(TYPE_LABEL[b.type] || b.type)
    );
  }, [facilities]);

  if (buckets.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 6 }}>
        <Box sx={{ fontSize: 48, mb: 1 }}>🪑</Box>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>No facilities yet</Typography>
        <Typography variant="body2" color="text.secondary">
          Your workspace admin hasn't added any rooms to book.
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>Book a facility</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Pick a category. You'll choose the specific room and slot on the next screen.
      </Typography>

      <Grid container spacing={2}>
        {buckets.map((b) => {
          const count = b.facilities.length;
          const sample = b.facilities
            .slice(0, 2)
            .map((f) => f.name)
            .join(', ');
          const extra = count > 2 ? `, +${count - 2} more` : '';
          const anyApproval = b.facilities.some((f) => f.requires_approval);

          return (
            <Grid key={b.type} item xs={12} sm={6} md={4} lg={3}>
              <Card
                variant="outlined"
                sx={{
                  height: '100%', display: 'flex', flexDirection: 'column',
                  transition: 'transform 0.15s, box-shadow 0.15s',
                  '&:hover': { transform: 'translateY(-2px)', boxShadow: 2 },
                }}
              >
                <Box sx={{
                  fontSize: 48, textAlign: 'center', pt: 3, pb: 1,
                  bgcolor: 'action.hover',
                }}>
                  {TYPE_EMOJI[b.type] || '📍'}
                </Box>

                <CardContent sx={{ flexGrow: 1, pb: 0 }}>
                  <Stack direction="row" alignItems="flex-start" spacing={1} mb={0.5}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, flex: 1, lineHeight: 1.3 }}>
                      {TYPE_LABEL[b.type] || b.type}
                    </Typography>
                    <Chip
                      size="small"
                      label={`${count} ${count === 1 ? 'space' : 'spaces'}`}
                    />
                  </Stack>

                  <Stack direction="row" alignItems="center" spacing={0.5} sx={{ color: 'text.secondary', mb: 1 }}>
                    <GroupsIcon sx={{ fontSize: 14 }} />
                    <Typography variant="caption">
                      Up to {b.totalSeats} {b.totalSeats === 1 ? 'seat' : 'seats'} across all
                    </Typography>
                  </Stack>

                  <Typography variant="body2" color="text.secondary" sx={{
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                    overflow: 'hidden', mb: 1,
                  }}>
                    {TYPE_BLURB[b.type] || 'A bookable space at your campus.'}
                  </Typography>

                  <Typography variant="caption" color="text.secondary" sx={{
                    display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}>
                    {sample}{extra}
                  </Typography>

                  {anyApproval && (
                    <Chip
                      size="small" color="warning" variant="outlined"
                      label="Some need approval" sx={{ mt: 1 }}
                    />
                  )}
                </CardContent>

                <CardActions sx={{ px: 2, pb: 2, pt: 1 }}>
                  <Button
                    fullWidth variant="contained" size="small"
                    onClick={() => onBook(b.type)}
                  >
                    Book now
                  </Button>
                </CardActions>
              </Card>
            </Grid>
          );
        })}
      </Grid>
    </Box>
  );
}
