import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Divider, FormControlLabel, IconButton,
  InputAdornment, MenuItem, Paper, Snackbar, Stack, Switch, TextField, Typography,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import { useNavigate, useParams } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import { tenantsApi } from '@/api/tenants.api';
import type { Tenant } from '@/types';

// Slugifies the tenant name into a URL-safe identifier so the operator
// doesn't have to maintain it by hand. Lowercase, alphanumerics + hyphens,
// no leading/trailing hyphens.
function slugify(s: string): string {
  return (s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

// Onboarding form keeps just the four essentials. Currency/locale defaults
// stay opaque to the operator; the slug is derived from the name. Status
// collapses to Active vs Inactive (the underlying enum still uses
// 'active' / 'suspended' so existing tenants don't break).
const EMPTY: Partial<Tenant> = {
  name: '', contact_email: '', contact_phone: '',
  currency_code: 'INR', locale: 'en-IN', timezone: 'Asia/Kolkata',
  status: 'active',
};

// Admin-user section — create-mode only. The backend now spawns the first
// tenant_admin + emails an invite link when admin_email is supplied.
interface AdminForm {
  admin_name: string;
  admin_lname: string;
  admin_email: string;
  admin_username: string;
  admin_password: string;
  send_invite: boolean;
}
const EMPTY_ADMIN: AdminForm = {
  admin_name: '', admin_lname: '', admin_email: '',
  admin_username: '', admin_password: '',
  send_invite: true,
};

// Cryptographically-simple random password so the operator can hand something
// over the phone. 12 chars, mixed case + digits + a couple of symbols.
function randomPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$';
  let out = '';
  const arr = new Uint32Array(12);
  window.crypto.getRandomValues(arr);
  for (let i = 0; i < 12; i += 1) out += chars[arr[i] % chars.length];
  return out;
}

export default function TenantFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const editing = id && id !== 'new';

  const [form, setForm] = useState<Partial<Tenant>>(EMPTY);
  const [admin, setAdmin] = useState<AdminForm>(EMPTY_ADMIN);
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    setLoading(true);
    tenantsApi.getOne(Number(id))
      .then((r) => r.data && setForm(r.data))
      .finally(() => setLoading(false));
  }, [editing, id]);

  function bind<K extends keyof Tenant>(key: K) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value as Tenant[K] }));
  }

  function bindAdmin(key: keyof AdminForm) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setAdmin((a) => ({ ...a, [key]: e.target.value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      // Build the outgoing payload: name + contact info + Active/Inactive,
      // plus a freshly-slugified slug and the default locale/currency/tz so
      // the backend's required-field validators stay happy.
      const payload: Partial<Tenant> & Record<string, unknown> = {
        ...form,
        slug: editing ? form.slug : (form.slug || slugify(form.name || '')),
        currency_code: form.currency_code || 'INR',
        locale: form.locale || 'en-IN',
        timezone: form.timezone || 'Asia/Kolkata',
      };
      // On create, layer in the admin-user fields when an email was supplied.
      // Blank email = tenant with no admin (operator will add users later).
      if (!editing && admin.admin_email.trim()) {
        payload.admin_name = admin.admin_name || undefined;
        payload.admin_lname = admin.admin_lname || undefined;
        payload.admin_email = admin.admin_email.trim();
        payload.admin_username = admin.admin_username.trim() || undefined;
        payload.admin_password = admin.admin_password || undefined;
        payload.send_invite = admin.send_invite;
      }
      if (editing) {
        await tenantsApi.update(Number(id), payload);
        navigate('/admin/tenants');
      } else {
        await tenantsApi.create(payload);
        // Small delay so the user can see the confirmation before we leave.
        if (admin.admin_email.trim() && admin.send_invite) {
          setToast(`Tenant created. An invite email has been sent to ${admin.admin_email.trim()}.`);
          setTimeout(() => navigate('/admin/tenants'), 1200);
        } else {
          navigate('/admin/tenants');
        }
      }
    } catch (err: unknown) {
      setError((err as { response?: { data?: { msg?: string } } })?.response?.data?.msg || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Box display="flex" justifyContent="center" p={5}><CircularProgress /></Box>;

  // Map the 3-value enum onto a 2-option Active/Inactive switch.
  // 'active' -> Active; anything else -> Inactive.
  const statusValue: 'active' | 'inactive' = form.status === 'active' ? 'active' : 'inactive';

  return (
    <Box maxWidth={640}>
      <PageHeader title={editing ? `Edit tenant #${id}` : 'New tenant'} back="/admin/tenants" />
      <Paper sx={{ p: 3 }}>
        <form onSubmit={submit}>
          <Stack spacing={2}>
            <TextField
              required label="Name" fullWidth
              value={form.name || ''} onChange={bind('name')}
              helperText={!editing ? 'A friendly name for the organisation.' : undefined}
            />
            <TextField
              label="Email" type="email" fullWidth
              value={form.contact_email || ''} onChange={bind('contact_email')}
            />
            <TextField
              label="Contact" fullWidth
              value={form.contact_phone || ''} onChange={bind('contact_phone')}
              helperText="Phone number, WhatsApp - whatever you can reach them on."
            />
            <TextField
              select label="Status" sx={{ maxWidth: 240 }}
              value={statusValue}
              onChange={(e) => setForm((f) => ({
                ...f,
                // Persist 'active' for Active, 'suspended' for Inactive so
                // the column still satisfies its enum.
                status: (e.target.value === 'active' ? 'active' : 'suspended') as Tenant['status'],
              }))}
            >
              <MenuItem value="active">Active</MenuItem>
              <MenuItem value="inactive">Inactive</MenuItem>
            </TextField>

            {/* ---- Admin user (create-mode only) ---- */}
            {!editing && (
              <>
                <Divider sx={{ mt: 1 }} />
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  Tenant admin user
                </Typography>
                <Alert severity="info" sx={{ py: 0.5 }}>
                  Leave the password blank to force the user to set their own via the invite link.
                </Alert>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                  <TextField
                    required={!!admin.admin_email}
                    label="Admin first name" fullWidth
                    value={admin.admin_name} onChange={bindAdmin('admin_name')}
                  />
                  <TextField
                    label="Admin last name" fullWidth
                    value={admin.admin_lname} onChange={bindAdmin('admin_lname')}
                  />
                </Stack>
                <TextField
                  required
                  label="Admin email" type="email" fullWidth
                  value={admin.admin_email} onChange={bindAdmin('admin_email')}
                  helperText="Receives the invite email. Leave blank to skip creating an admin."
                />
                <TextField
                  label="Admin username" fullWidth
                  value={admin.admin_username} onChange={bindAdmin('admin_username')}
                  placeholder={`${slugify(form.name || '') || 'slug'}admin`}
                  helperText="Optional — defaults to <slug>admin on the backend."
                />
                <TextField
                  label="Admin password"
                  type={showPwd ? 'text' : 'password'}
                  fullWidth
                  value={admin.admin_password}
                  onChange={bindAdmin('admin_password')}
                  helperText="Optional. If left blank, the user must set one via the invite link."
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          size="small"
                          onClick={() => setAdmin((a) => ({ ...a, admin_password: randomPassword() }))}
                          aria-label="Generate random password"
                          title="Generate random"
                          onMouseDown={(e) => e.preventDefault()}
                        >
                          <AutorenewIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small" edge="end"
                          aria-label={showPwd ? 'Hide password' : 'Show password'}
                          onClick={() => setShowPwd((v) => !v)}
                          onMouseDown={(e) => e.preventDefault()}
                        >
                          {showPwd ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={admin.send_invite}
                      onChange={(_e, v) => setAdmin((a) => ({ ...a, send_invite: v }))}
                    />
                  }
                  label="Send invite email"
                />
              </>
            )}

            {error && <Alert severity="error">{error}</Alert>}

            <Stack direction="row" justifyContent="flex-end" spacing={1}>
              <Button onClick={() => navigate('/admin/tenants')}>Cancel</Button>
              <Button
                type="submit" variant="contained" disabled={saving}
                startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
              >
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </Stack>
          </Stack>
        </form>
      </Paper>

      <Snackbar
        open={!!toast}
        autoHideDuration={4000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" onClose={() => setToast(null)}>{toast}</Alert>
      </Snackbar>
    </Box>
  );
}
