// /approvals/act?token=...
//
// Landing page for the "Review & decide" button in approval emails. Flow:
//   1. Read ?token= from the URL.
//   2. If not logged in, redirect to /login?next=/approvals/act?token=... so
//      the user signs in first, then bounces back here.
//   3. Call GET /approvals/by-token. Backend resolves the token, checks
//      RBAC (req.user.id === approver_user_id) and returns the approval +
//      booking summary + prior decisions.
//   4. Render the summary + Approve / Reject buttons + optional remark.
//   5. Submit via POST /approvals/:id/decide, passing the token so the
//      backend can mark it used.

import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Divider, Paper, Stack,
  TextField, Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { approvalsApi, type ApprovalActPayload } from '@/api/approvals.api';

export default function ApprovalActPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const token = useMemo(() => searchParams.get('token') || '', [searchParams]);

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ApprovalActPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remark, setRemark] = useState('');
  const [submitting, setSubmitting] = useState<'approved' | 'rejected' | null>(null);
  const [done, setDone] = useState<'approved' | 'rejected' | null>(null);

  // Step 1+2: gate on auth.
  useEffect(() => {
    if (authLoading) return;
    if (!token) {
      setError('This link is missing a token. Please use the link from your email.');
      setLoading(false);
      return;
    }
    if (!user) {
      // Bounce to login, preserving where to return to.
      const nextUrl = `/approvals/act?token=${encodeURIComponent(token)}`;
      navigate(`/login?next=${encodeURIComponent(nextUrl)}`, { replace: true });
      return;
    }
    // Step 3: load.
    approvalsApi.byToken(token)
      .then((r) => {
        if (r.status && r.data) {
          setData(r.data);
          setError(null);
        } else {
          setError(r.msg || 'Could not load this approval');
        }
      })
      .catch((err) => {
        const status = err?.response?.status;
        const msg = err?.response?.data?.msg || 'Could not load this approval';
        if (status === 403) {
          setError('This approval link belongs to another user. Sign in as the assigned approver to act on it.');
        } else {
          setError(msg);
        }
      })
      .finally(() => setLoading(false));
  }, [authLoading, user, token, navigate]);

  async function submit(decision: 'approved' | 'rejected') {
    if (!data) return;
    setSubmitting(decision);
    setError(null);
    try {
      await approvalsApi.decide(data.approval.id, { decision, remark: remark || undefined, token });
      setDone(decision);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const msg = (err as { response?: { data?: { msg?: string } } })?.response?.data?.msg
        || 'Could not record decision';
      if (status === 422 && msg.startsWith('Already ')) {
        setError('This step has already been decided.');
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(null);
    }
  }

  if (authLoading || loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
        <CircularProgress />
      </Box>
    );
  }

  if (error && !data) {
    return (
      <Box maxWidth={620} mx="auto" mt={6} p={2}>
        <Paper sx={{ p: 4 }}>
          <Typography variant="h6" gutterBottom>Approval link unavailable</Typography>
          <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
          <Button variant="outlined" onClick={() => navigate('/approvals')}>Open my approval inbox</Button>
        </Paper>
      </Box>
    );
  }

  if (!data) return null;
  const a = data.approval;
  const bookerName = [a.booker_name, a.booker_lname].filter(Boolean).join(' ') || a.booker_username || `User #${a.booker_id}`;

  return (
    <Box maxWidth={720} mx="auto" mt={4} p={2}>
      <Paper sx={{ p: 4 }}>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>
          Booking awaiting your approval
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          You are step {a.step_order} of this booking's approval chain.
        </Typography>

        {done ? (
          <Alert severity={done === 'approved' ? 'success' : 'warning'} sx={{ mb: 2 }}>
            Decision recorded: <strong>{done}</strong>. The booker and remaining approvers
            (if any) will be notified.
          </Alert>
        ) : null}

        <Stack spacing={1.25} sx={{ mb: 2 }}>
          <Row label="Facility">
            <strong>{a.facility_name}</strong>
            <Chip size="small" label={a.facility_type} sx={{ ml: 1 }} />
          </Row>
          <Row label="Requested by">
            {bookerName}
            {a.booker_email ? <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>({a.booker_email})</Typography> : null}
          </Row>
          <Row label="From">{a.start_at}</Row>
          <Row label="To">{a.end_at}</Row>
          {a.title ? <Row label="Title">{a.title}</Row> : null}
          {a.booking_remarks ? <Row label="Remarks">{a.booking_remarks}</Row> : null}
        </Stack>

        {data.prior_decisions.length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Other approvers in this chain</Typography>
            <Stack spacing={0.5} sx={{ mb: 2 }}>
              {data.prior_decisions.map((d) => (
                <Stack key={d.id} direction="row" spacing={1} alignItems="center">
                  <Chip size="small" label={`Step ${d.step_order}`} />
                  <Chip
                    size="small"
                    color={d.decision === 'approved' ? 'success' : d.decision === 'rejected' ? 'error' : 'default'}
                    label={d.decision}
                  />
                  <Typography variant="body2">
                    {[d.approver_name, d.approver_lname].filter(Boolean).join(' ') || d.approver_username || `User #${d.approver_user_id}`}
                  </Typography>
                  {d.remark ? <Typography variant="caption" color="text.secondary">- {d.remark}</Typography> : null}
                </Stack>
              ))}
            </Stack>
          </>
        )}

        <Divider sx={{ my: 2 }} />

        {!done && a.decision === 'pending' && (
          <>
            <TextField
              label="Remark (optional)" fullWidth multiline minRows={2}
              value={remark} onChange={(e) => setRemark(e.target.value)} sx={{ mb: 2 }}
            />
            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
            <Stack direction="row" spacing={2}>
              <Button
                variant="contained" color="success" startIcon={<CheckCircleIcon />}
                disabled={submitting !== null}
                onClick={() => submit('approved')}
              >
                {submitting === 'approved' ? 'Approving...' : 'Approve'}
              </Button>
              <Button
                variant="outlined" color="error" startIcon={<CancelIcon />}
                disabled={submitting !== null}
                onClick={() => submit('rejected')}
              >
                {submitting === 'rejected' ? 'Rejecting...' : 'Reject'}
              </Button>
            </Stack>
          </>
        )}

        {a.decision !== 'pending' && !done && (
          <Alert severity="info">
            This step was already decided as <strong>{a.decision}</strong>
            {a.decided_at ? ` on ${a.decided_at}` : ''}.
          </Alert>
        )}

        {done && (
          <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
            <Button variant="outlined" onClick={() => navigate('/approvals')}>
              Open my approval inbox
            </Button>
          </Stack>
        )}
      </Paper>
    </Box>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Stack direction="row" spacing={1.5}>
      <Typography variant="body2" color="text.secondary" sx={{ width: 130, flexShrink: 0 }}>{label}</Typography>
      <Typography variant="body2" component="div">{children}</Typography>
    </Stack>
  );
}
