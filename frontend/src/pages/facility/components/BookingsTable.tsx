import { useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Tabs, Tab, TextField, MenuItem, InputAdornment,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Typography, Button, Chip, IconButton, Tooltip,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import CancelIcon from '@mui/icons-material/Cancel';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import type { BookingStatus, LiveBooking } from '@/types';

interface Props {
  upcoming: LiveBooking[];
  past: LiveBooking[];
  onCancel?: (booking: LiveBooking) => Promise<void> | void;
}

const STATUS_COLOR: Record<BookingStatus, 'warning' | 'success' | 'error' | 'default' | 'info'> = {
  pending:   'warning',
  approved:  'success',
  rejected:  'error',
  cancelled: 'default',
  completed: 'info',
};

function fmt(s?: string) {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

/**
 * Live booking table with Upcoming / Past tabs, search, facility filter,
 * and per-row cancel (when applicable).
 *
 * For pending bookings the Status cell now also surfaces the "Pending with"
 * approver name + email (truncated) so the user can see who's holding up
 * their booking without opening the detail page.
 */
export default function BookingsTable({ upcoming, past, onCancel }: Props) {
  const [tab, setTab] = useState<0 | 1>(0);
  const [search, setSearch] = useState('');
  const [facility, setFacility] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 8;

  const source = tab === 0 ? upcoming : past;

  const facilities = useMemo(() => {
    const set = new Set<string>();
    source.forEach((b) => b.facility_name && set.add(b.facility_name));
    return Array.from(set).sort();
  }, [source]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return source.filter((b) => {
      if (facility && b.facility_name !== facility) return false;
      if (!q) return true;
      const blob = [
        String(b.id),
        b.title || '',
        b.facility_name || '',
        b.booker_name || '',
        b.booker_lname || '',
      ].join(' ').toLowerCase();
      return blob.includes(q);
    });
  }, [source, search, facility]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const rows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const canCancel = (b: LiveBooking) => b.status === 'pending' || b.status === 'approved';

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        alignItems={{ xs: 'stretch', md: 'center' }}
        spacing={2} mb={1}
      >
        <Typography variant="h6" sx={{ fontWeight: 600, flexGrow: 1 }}>
          My bookings
        </Typography>
        <TextField
          size="small" placeholder="Search by ID, title, room..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          InputProps={{
            startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
          }}
          sx={{ minWidth: 240 }}
        />
        <TextField
          select size="small" label="Filter by facility" value={facility}
          onChange={(e) => { setFacility(e.target.value); setPage(1); }}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="">All facilities</MenuItem>
          {facilities.map((f) => <MenuItem key={f} value={f}>{f}</MenuItem>)}
        </TextField>
      </Stack>

      <Tabs value={tab} onChange={(_, v) => { setTab(v as 0 | 1); setPage(1); }} sx={{ mb: 1 }}>
        <Tab label={`Upcoming (${upcoming.length})`} />
        <Tab label={`Past (${past.length})`} />
      </Tabs>

      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700 }}>ID</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Title</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Facility</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>When</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
              <TableCell sx={{ fontWeight: 700 }} align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  No bookings to show.
                </TableCell>
              </TableRow>
            ) : rows.map((b) => (
              <TableRow key={b.id} hover>
                <TableCell>{b.id}</TableCell>
                <TableCell>{b.title || <em style={{ color: '#999' }}>untitled</em>}</TableCell>
                <TableCell>
                  <Chip size="small" label={b.facility_name || `#${b.facility_id}`} variant="outlined" />
                </TableCell>
                <TableCell>{fmt(b.start_at)} {"→"} {fmt(b.end_at)}</TableCell>
                <TableCell>
                  <Stack spacing={0.5}>
                    <Chip size="small" color={STATUS_COLOR[b.status]} label={b.status} sx={{ alignSelf: 'flex-start' }} />
                    {b.status === 'pending' && b.pending_with_name && (
                      <Tooltip title={b.pending_with_email || ''} placement="top" arrow>
                        <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          Pending with: <strong>{b.pending_with_name}</strong>
                          {b.pending_with_email ? <> ({b.pending_with_email})</> : null}
                        </Typography>
                      </Tooltip>
                    )}
                  </Stack>
                </TableCell>
                <TableCell align="right">
                  {onCancel && canCancel(b) && (
                    <Tooltip title="Cancel booking">
                      <IconButton size="small" onClick={() => onCancel(b)}>
                        <CancelIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Results ({rows.length} of {total})
        </Typography>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Button startIcon={<ChevronLeftIcon />} size="small"
            onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1}>Previous</Button>
          <Box sx={{ px: 1.5, py: 0.5, border: '1px solid', borderColor: 'divider', borderRadius: 1, fontSize: 13, color: 'text.secondary' }}>
            Page {safePage} / {totalPages}
          </Box>
          <Button endIcon={<ChevronRightIcon />} size="small"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}>Next</Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
