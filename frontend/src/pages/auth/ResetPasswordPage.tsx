// /reset-password?token=... - opened from invite emails and "forgot password"
// emails. The user picks a new password; we POST it together with the token
// to /api/auth/reset-password which validates+single-uses the token.

import { useMemo, useState } from 'react';
import {
  Box, Paper, TextField, Button, Typography, Alert, CircularProgress,
  Link as MuiLink, Stack,
} from '@mui/material';
import { useSearchParams, useNavigate, Link as RouterLink } from 'react-router-dom';
import { authApi } from '@/api/auth.api';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = useMemo(() => searchParams.get('token') || '', [searchParams]);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Validate inputs before sending - keeps the button disabled until ready.
  const localError =
    !token ? 'This link is missing a token. Please use the link from your email.' :
    password && password.length < 6 ? 'Password must be at least 6 characters' :
    password && confirm && password !== confirm ? 'Passwords do not match' :
    null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (localError) return;
    setError(null);
    setLoading(true);
    try {
      await authApi.resetPassword({ token, password });
      setDone(true);
      // Auto-redirect after a couple of seconds so the user has time to read
      // the success message.
      window.setTimeout(() => navigate('/login', { replace: true }), 2500);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { msg?: string } } })?.response?.data?.msg ||
        (err as Error)?.message ||
        'Could not reset password';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box sx={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      bgcolor: 'background.default', p: 2,
    }}>
      <Paper elevation={3} sx={{ p: 4, width: '100%', maxWidth: 420 }}>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>Set a new password</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Choose a password you'll remember. You'll be signed in next.
        </Typography>

        {done ? (
          <>
            <Alert severity="success">
              Your password has been updated. Redirecting you to sign in&hellip;
            </Alert>
            <Stack direction="row" justifyContent="center" sx={{ mt: 3 }}>
              <MuiLink component={RouterLink} to="/login" variant="body2">
                Go to sign in now
              </MuiLink>
            </Stack>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <TextField
              label="New password" type="password" fullWidth margin="normal" autoFocus
              value={password} onChange={(e) => setPassword(e.target.value)} required
              helperText="At least 6 characters"
            />
            <TextField
              label="Confirm password" type="password" fullWidth margin="normal"
              value={confirm} onChange={(e) => setConfirm(e.target.value)} required
            />

            {localError && <Alert severity="warning" sx={{ mt: 2 }}>{localError}</Alert>}
            {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}

            <Button
              type="submit" variant="contained" fullWidth size="large"
              sx={{ mt: 3 }}
              disabled={loading || !token || !password || !confirm || !!localError}
              startIcon={loading ? <CircularProgress size={18} color="inherit" /> : undefined}
            >
              {loading ? 'Saving…' : 'Set password'}
            </Button>

            <Stack direction="row" justifyContent="center" sx={{ mt: 3 }}>
              <MuiLink component={RouterLink} to="/login" variant="body2">
                Back to sign in
              </MuiLink>
            </Stack>
          </form>
        )}
      </Paper>
    </Box>
  );
}
