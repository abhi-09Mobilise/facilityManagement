// Public "I forgot my password" page.
//
// Calls POST /api/auth/forgot-password, which always returns 200 (so callers
// can't enumerate which emails are registered). We mirror that on the UI: any
// successful submit shows the same "If that email is on file..." message.

import { useState } from 'react';
import {
  Box, Paper, TextField, Button, Typography, Alert, CircularProgress,
  Link as MuiLink, Stack,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { authApi } from '@/api/auth.api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await authApi.forgotPassword({ email });
      setSent(true);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { msg?: string } } })?.response?.data?.msg ||
        (err as Error)?.message ||
        'Could not send reset email';
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
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>Reset your password</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Enter your account email and we'll send you a link to set a new password.
        </Typography>

        {sent ? (
          <>
            <Alert severity="success">
              If that email is on file, a reset link has been sent. Check your inbox
              (and spam folder) for a message from Facility Booking.
            </Alert>
            <Stack direction="row" justifyContent="center" sx={{ mt: 3 }}>
              <MuiLink component={RouterLink} to="/login" variant="body2">
                Back to sign in
              </MuiLink>
            </Stack>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <TextField
              label="Email" type="email" fullWidth margin="normal" autoFocus
              value={email} onChange={(e) => setEmail(e.target.value)} required
            />

            {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}

            <Button
              type="submit" variant="contained" fullWidth size="large"
              sx={{ mt: 3 }} disabled={loading || !email}
              startIcon={loading ? <CircularProgress size={18} color="inherit" /> : undefined}
            >
              {loading ? 'Sending…' : 'Send reset link'}
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
