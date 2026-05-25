// Approver dashboard.
//
// Three tabs:
//   1. Pending  - bookings waiting for my decision (any of my steps).
//   2. History  - my past decisions, newest first.
//   3. Team     - bookings made by anyone in a department I manage (only
//                 shown if the backend reports is_dept_manager = true).
//
// Stats tiles at the top show pending count + history count + team-pending
// count (when applicable) so users can spot urgency at a glance.

import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Card, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Grid, Paper, Stack, Tabs, Tab, TextField, Tooltip, Typography,
} from '@mui/material';
import PageHeader from '@/components/PageHeader';
import { approvalsApi } from '@/api/approvals.api';
import { usersApi } from '@/api/users.api';
import { bookingsApi } from '@/api/bookings.api';
import type { BookingStatus, InboxItem, LiveBooking } from '@/types';

const FACILITY_TYPE_LABEL: Record<string, string> = {
  meeting_room: 'Meeting Room',
  gym: 'Gym',
  conference_room: 'Conference Room',
  desk: 'Desk',
  swimming_pool: 'Swimming Pool',
  other: 'Other',
};

const STATUS_COLOR: Record<BookingStatus, 'warning' | 'success' | 'error' | 'default' | 'info'> = {
  pending:   'warning',
  approved:  'success',
  rejected:  'error',
  cancelled: 'default',
  completed: 'info',
};

function fmtDateTime(s?: string) {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

interface DecideTarget {
  item: InboxItem;
  decision: 'approved' | 'rejected';
}

interface Summary {
  is_dept_manager: boolean;
  managed_dept_ids: number[];
  managed_dept_names: string[];
  pending_count: number;
  history_count: number;
}

export default function ApprovalsInboxPage() {
  const [tab, setTab] = useState<0 | 1 | 2>(0);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [pending, setPending] = useState<InboxItem[]>([]);
  const [history, setHistory] = useState<InboxItem[]>([]);
  const [team, setTeam] = useState<LiveBooking[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [target, setTarget] = useState<DecideTarget | null>(null);
  const [remark, setRemark] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [s, p, h] = await Promise.all([
        usersApi.meSummary(),
        approvalsApi.inbox(),
        approvalsApi.history(50),
      ]);
      setSummary((s.data as Summary) || null);
      setPending((p.data as InboxItem[]) || []);
      setHistory((h.data as InboxItem[]) || []);

      if (s.data && (s.data as Summary).is_dept_manager) {
        const t = await bookingsApi.list({ scope: 'team', limit: 50 });
        setTeam((t.data && (t.data as { data: LiveBooking[] }).data) || []);
      } else {
        setTeam([]);
      }
    } catch (e: unknown) {
      setError((e as { response?: { data?: { msg?: string } } })?.response?.data?.msg || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  function openDecide(item: InboxItem, decision: 'approved' | 'rejected') {
    setTarget({ item, decision });
    setRemark('');
  }

  async function submitDecision() {
    if (!target) return;
    setSaving(true);
    try {
      await approvalsApi.decide(target.item.id, {
        decision: target.decision,
        remark: remark || undefined,
      });
      setTarget(null);
      await load();
    } catch (e: unknown) {
      setError((e as { response?: { data?: { msg?: string } } })?.response?.data?.msg || 'Decision failed');
    } finally {
      setSaving(false);
    }
  }

  const teamPendingCount = useMemo(
    () => team.filter((b) => b.status === 'pending').length,
    [team]
  );

  const showTeam = !!summary?.is_dept_manager;

  return (
    <Box>
      <PageHeader
        title="Approvals dashboard"
        subtitle={summary?.is_dept_manager
          ? `You manage: ${(summary.managed_dept_names || []).join(', ')}`
          : 'Bookings awaiting your decision'}
        onRefresh={load}
      />

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* Stats tiles */}
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={6} sm={4} md={3}>
          <StatTile label="Pending decisions" value={summary?.pending_count ?? pending.length} accent="warning" />
        </Grid>
        <Grid item xs={6} sm={4} md={3}>
          <StatTile label="Past decisions" value={summary?.history_count ?? history.length} accent="default" />
        </Grid>
        {showTeam && (
          <Grid item xs={6} sm={4} md={3}>
            <StatTile label="Team bookings pending" value={teamPendingCount} accent="info" />
          </Grid>
        )}
      </Grid>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v as 0 | 1 | 2)} sx={{ mb: 2 }}>
          <Tab label={`Pending (${pending.length})`} />
          <Tab label={`History (${history.length})`} />
          {showTeam && <Tab label={`Team bookings (${team.length})`} />}
        </Tabs>

        {loading ? (
          <Box display="flex" justifyContent="center" p={5}><CircularProgress /></Box>
        ) : tab === 0 ? (
          <PendingTab items={pending} onAct={openDecide} />
        ) : tab === 1 ? (
          <HistoryTab items={history} />
        ) : (
          <TeamTab items={team} />
        )}
      </Paper>

      <Dialog open={!!target} onClose={() => setTarget(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {target?.decision === 'approved' ? 'Approve this booking?' : 'Reject this booking?'}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {target?.item.title || '(untitled)'} - {target?.item.facility_name}
            <br />
            {target && fmtDateTime(target.item.start_at)} {'→'} {target && fmtDateTime(target.item.end_at)}
          </Typography>
          <TextField
            label={target?.decision === 'rejected' ? 'Reason (recommended)' : 'Remark (optional)'}
            multiline minRows={2} fullWidth
            value={remark} onChange={(e) => setRemark(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTarget(null)}>Cancel</Button>
          <Button
            variant="contained"
            color={target?.decision === 'rejected' ? 'error' : 'primary'}
            onClick={submitDecision}
            disabled={saving}
          >
            {saving ? 'Saving...' : target?.decision === 'approved' ? 'Approve' : 'Reject'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function StatTile({ label, value, accent }: { label: string; value: number | string; accent: 'warning' | 'info' | 'default' }) {
  const borderColor =
    accent === 'warning' ? 'warning.main'
    : accent === 'info' ? 'info.main'
    : 'divider';
  return (
    <Paper variant="outlined" sx={{ p: 2, borderLeft: 4, borderLeftColor: borderColor }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="h4" sx={{ fontWeight: 700 }}>{value}</Typography>
    </Paper>
  );
}

function PendingTab({ items, onAct }: { items: InboxItem[]; onAct: (it: InboxItem, d: 'approved' | 'rejected') => void }) {
  if (items.length === 0) {
    return (
      <Card variant="outlined" sx={{ p: 5, textAlign: 'center' }}>
        <Box sx={{ fontSize: 40, mb: 1 }}>{'✓'}</Box>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>All clear</Typography>
        <Typography variant="body2" color="text.secondary">
          No bookings are waiting on you right now.
        </Typography>
      </Card>
    );
  }
  return (
    <Stack spacing={1.5}>
      {items.map((it) => (
        <Card key={it.id} variant="outlined" sx={{ p: 2 }}>
          <Stack direction={{ xs: 'column', md: 'row' }} alignItems={{ md: 'center' }} spacing={2}>
            <Box sx={{ flex: 1 }}>
              <Stack direction="row" alignItems="center" spacing={1} mb={0.5}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  {it.title || '(untitled booking)'}
                </Typography>
                <Chip size="small" label={FACILITY_TYPE_LABEL[it.facility_type] || it.facility_type} />
                <Chip size="small" label={`Step ${it.step_order}`} variant="outlined" />
                {/* F02 - stage chip: 'Check-in' (blue) or 'Check-out' (violet) */}
                {it.stage === 'checkout'
                  ? <Chip size="small" label="Check-out" sx={{ bgcolor: '#ede9fe', color: '#5b21b6', fontWeight: 600 }} />
                  : <Chip size="small" label="Check-in"  sx={{ bgcolor: '#dbeafe', color: '#1e3a8a', fontWeight: 600 }} />
                }
              </Stack>
              <Typography variant="body2" color="text.secondary">
                <strong>{it.facility_name}</strong> {' · '}
                {fmtDateTime(it.start_at)} {'→'} {fmtDateTime(it.end_at)}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Requested by{' '}
                <strong>
                  {[it.booker_name, it.booker_lname].filter(Boolean).join(' ') || it.booker_username}
                </strong>
              </Typography>
              {it.remarks && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                  "{it.remarks}"
                </Typography>
              )}
            </Box>
            <Stack direction="row" spacing={1}>
              <Button color="error" variant="outlined" onClick={() => onAct(it, 'rejected')}>
                Reject
              </Button>
              <Button color="primary" variant="contained" onClick={() => onAct(it, 'approved')}>
                Approve
              </Button>
            </Stack>
          </Stack>
        </Card>
      ))}
    </Stack>
  );
}

function HistoryTab({ items }: { items: InboxItem[] }) {
  if (items.length === 0) {
    return (
      <Card variant="outlined" sx={{ p: 5, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">No past decisions yet.</Typography>
      </Card>
    );
  }
  return (
    <Stack spacing={1}>
      {items.map((it) => {
        // History rows carry a richer shape than InboxItem's narrow 'pending'-only
        // decision type. Cast locally for the few extra fields we render.
        const h = it as unknown as InboxItem & {
          decision: 'approved' | 'rejected';
          remark?: string;
          decided_at?: string;
        };
        return (
        <Card key={it.id} variant="outlined" sx={{ p: 2 }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
            <Box sx={{ flex: 1 }}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                  {it.title || '(untitled booking)'}
                </Typography>
                <Chip size="small" label={`Step ${it.step_order}`} variant="outlined" />
                <Chip
                  size="small"
                  color={h.decision === 'approved' ? 'success' : 'error'}
                  label={h.decision}
                />
              </Stack>
              <Typography variant="body2" color="text.secondary">
                <strong>{it.facility_name}</strong> {' · '}
                {fmtDateTime(it.start_at)} {'→'} {fmtDateTime(it.end_at)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Decided {fmtDateTime(h.decided_at)}
                {h.remark
                  ? ` - "${h.remark}"`
                  : ''}
              </Typography>
            </Box>
          </Stack>
        </Card>
        );
      })}
    </Stack>
  );
}

function TeamTab({ items }: { items: LiveBooking[] }) {
  if (items.length === 0) {
    return (
      <Card variant="outlined" sx={{ p: 5, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          No bookings yet for any department you manage.
        </Typography>
      </Card>
    );
  }
  return (
    <Stack spacing={1}>
      {items.map((b) => (
        <Card key={b.id} variant="outlined" sx={{ p: 2 }}>
          <Stack direction={{ xs: 'column', md: 'row' }} alignItems={{ md: 'center' }} spacing={2}>
            <Box sx={{ flex: 1 }}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                  {b.title || '(untitled)'}
                </Typography>
                <Chip size="small" color={STATUS_COLOR[b.status]} label={b.status} />
                <Chip size="small" label={b.department_name || `Dept #${b.department_id}`} variant="outlined" />
              </Stack>
              <Typography variant="body2" color="text.secondary">
                <strong>{b.facility_name}</strong> {' · '}
                {fmtDateTime(b.start_at)} {'→'} {fmtDateTime(b.end_at)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Booked by {[b.booker_name, b.booker_lname].filter(Boolean).join(' ') || b.booker_username}
                {b.status === 'pending' && b.pending_with_name && (
                  <Tooltip title={b.pending_with_email || ''} placement="top" arrow>
                    <span> {' · '} pending with <strong>{b.pending_with_name}</strong></span>
                  </Tooltip>
                )}
              </Typography>
            </Box>
          </Stack>
        </Card>
      ))}
    </Stack>
  );
}

// tatus === 'pending' && b.pending_with_name ? ` · pending with ${b.pending_with_name}` : ''}
//               </Typography>
//             </Box>
//           </Stack>
//         </Card>
//       ))}
//     </Stack>
//   );
// }
// _name}</strong></span>
//                   </Tooltip>
//                 )}
//               </Typography>
//             </Box>
//           </Stack>
//         </Card>
//       ))}
//     </Stack>
//   );
// }
