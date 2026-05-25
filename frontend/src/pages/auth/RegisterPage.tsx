import { useState } from 'react';
import {
  Box, Paper, TextField, Button, Typography, Alert, CircularProgress,
  Link as MuiLink, Stack,
} from '@mui/material';
import { useAuth } from '@/context/AuthContext';
import { useNavigate, Link as RouterLink } from 'react-router-dom';

interface FormState {
  username: string;
  password: string;
  confirmPassword: string;
  name: string;
  lname: string;
  email: string;
  mobile: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState<FormState>({
    username: '', password: '', confirmPassword: '',
    name: '', lname: '', email: '', mobile: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function bind(key: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  function validate(): string | null {
    if (!form.username.trim()) return 'Username is required';
    if (form.username.trim().length < 3) return 'Username must be at least 3 characters';
    if (!form.password) return 'Password is required';
    if (form.password.length < 6) return 'Password must be at least 6 characters';
    if (form.password !== form.confirmPassword) return 'Passwords do not match';
    if (form.email && !EMAIL_RE.test(form.email)) return 'Email is not valid';
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = validate();
    if (v) { setError(v); return; }

    setError(null);
    setSaving(true);
    try {
      await register({
        username: form.username.trim(),
        password: form.password,
        name: form.name || undefined,
        lname: form.lname || undefined,
        email: form.email || undefined,
        mobile: form.mobile || undefined,
      });
      navigate('/', { replace: true });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { msg?: string } } })?.response?.data?.msg ||
        (err as Error)?.message ||
        'Registration failed';
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Box sx={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      bgcolor: 'background.default', p: 2,
    }}>
      <Paper elevation={3} sx={{ p: 4, width: '100%', maxWidth: 520 }}>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>Create your account</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Sign up to book facilities at your campus
        </Typography>

        <form onSubmit={handleSubmit}>
          <Stack spacing={2}>
            <TextField
              label="Username" required fullWidth autoFocus
              value={form.username} onChange={bind('username')}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="First name" fullWidth value={form.name} onChange={bind('name')} />
              <TextField label="Last name"  fullWidth value={form.lname} onChange={bind('lname')} />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Email" type="email" fullWidth value={form.email} onChange={bind('email')} />
              <TextField label="Mobile" fullWidth value={form.mobile} onChange={bind('mobile')} />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Password" type="password" required fullWidth
                value={form.password} onChange={bind('password')}
                helperText="At least 6 characters"
              />
              <TextField
                label="Confirm password" type="password" required fullWidth
                value={form.confirmPassword} onChange={bind('confirmPassword')}
              />
            </Stack>

            {error && <Alert severity="error">{error}</Alert>}

            <Button
              type="submit" variant="contained" size="large"
              disabled={saving}
              startIcon={saving ? <CircularProgress size={18} color="inherit" /> : undefined}
            >
              {saving ? 'Creating account…' : 'Create account'}
            </Button>
          </Stack>
        </form>

        <Stack direction="row" justifyContent="center" sx={{ mt: 3 }}>
          <Typography variant="body2" color="text.secondary">
            Already have an account?{' '}
            <MuiLink component={RouterLink} to="/login">Sign in</MuiLink>
          </Typography>
        </Stack>
      </Paper>
    </Box>
  );
}
