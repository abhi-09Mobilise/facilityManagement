import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Divider, FormControlLabel,
  MenuItem, Paper, Snackbar, Stack, Switch, TextField, Typography,
} from '@mui/material';
import { useNavigate, useParams } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import { tenantsApi } from '@/api/tenants.api';
import type { Tenant } from '@/types';

// Slugifies the tenant name into a URL-safe identifier so the operator
// doesn't have to maintain it by hand.
function slugify(s: string): string {
  return (s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

// Create mode keeps ONE email on screen (the admin's — it doubles as the
// tenant contact email). Edit mode shows every stored field so nothing the
// operator saved is hidden.
const EMPTY: Partial<Tenant> = {
  name: '', contact_email: '', contact_phone: '',
  currency_code: 'INR', locale: 'en-IN', timezone: 'Asia/Kolkata',
  status: 'active',
};

// Admin-user section — create-mode only. No password field: the backend
// spawns the tenant_admin and the invite email carries a set-password link.
interface AdminForm {
  admin_name: string;
  admin_lname: string;
  admin_email: string;
  admin_username: string;
  send_invite: boolean;
}
const EMPTY_ADMIN: AdminForm = {
  admin_name: '', admin_lname: '', admin_email: '', admin_username: '',
  send_invite: true,
};

export default function TenantFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const editing = id && id !== 'new';

  const [form, setForm] = useState<Partial<Tenant>>(EMPTY);
  const [admin, setAdmin] = useState<AdminForm>(EMPTY_ADMIN);
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
      const payload: Partial<Tenant> & Record<string, unknown> = {
        ...form,
        slug: editing ? form.slug : (form.slug || slugify(form.name || '')),
        currency_code: form.currency_code || 'INR',
        locale: form.locale || 'en-IN',
        timezone: form.timezone || 'Asia/Kolkata',
      };
      if (!editing && admin.admin_email.trim()) {
        // Single-email rule: the admin's email is also the tenant contact.
        payload.contact_email = form.contact_email || admin.admin_email.trim();
        payload.admin_name = admin.admin_name || undefined;
        payload.admin_lname = admin.admin_lname || undefined;
        payload.admin_email = admin.admin_email.trim();
        payload.admin_username = admin.admin_username.trim() || undefined;
        payload.send_invite = admin.send_invite;
      }
      if (editing) {
        await tenantsApi.update(Number(id), payload);
        setToast('Tenant updated.');
        setTimeout(() => navigate('/admin/tenants'), 900);
      } else {
        await tenantsApi.create(payload);
        setToast(admin.admin_email.trim() && admin.send_invite
          ? `Tenant created. Invite with a set-password link sent to ${admin.admin_email.trim()}.`
          : 'Tenant created.');
        setTimeout(() => navigate('/admin/tenants'), 1200);
      }
    } catch (err: unknown) {
      setError((err as { response?: { data?: { msg?: string } } })?.response?.data?.msg || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Box display="flex" justifyContent="center" p={5}><CircularProgress /></Box>;

  const statusValue: 'active' | 'inactive' = form.status === 'active' ? 'active' : 'inactive';

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center' }}>
      <Box sx={{ width: '100%', maxWidth: 640 }}>
        <PageHeader title={editing ? `Edit tenant · ${form.name || `#${id}`}` : 'New tenant'} back="/admin/tenants" />
        <Paper sx={{ p: 3 }}>
          <form onSubmit={submit}>
            <Stack spacing={2}>
              <TextField
                required label="Name" fullWidth
                value={form.name || ''} onChange={bind('name')}
                helperText={!editing ? 'A friendly name for the organisation.' : undefined}
              />

              {/* Edit mode shows EVERYTHING that was saved. */}
              {editing && (
                <>
                  <TextField
                    label="Slug" fullWidth disabled
                    value={form.slug || ''}
                    helperText="Used in public portal URLs — fixed after creation."
                  />
                  <TextField
                    label="Contact email" type="email" fullWidth
                    value={form.contact_email || ''} onChange={bind('contact_email')}
                  />
                  <TextField
                    label="Contact phone" fullWidth
                    value={form.contact_phone || ''} onChange={bind('contact_phone')}
                  />
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                    <TextField
                      label="Currency" fullWidth
                      value={form.currency_code || ''} onChange={bind('currency_code')}
                    />
                    <TextField
                      label="Locale" fullWidth
                      value={form.locale || ''} onChange={bind('locale')}
                    />
                    <TextField
                      label="Timezone" fullWidth
                      value={form.timezone || ''} onChange={bind('timezone')}
                    />
                  </Stack>
                </>
              )}

              <TextField
                select label="Status" sx={{ maxWidth: 240 }}
                value={statusValue}
                onChange={(e) => setForm((f) => ({
                  ...f,
                  status: (e.target.value === 'active' ? 'active' : 'suspended') as Tenant['status'],
                }))}
                helperText={statusValue === 'inactive'
                  ? 'Inactive tenants: every admin and employee under this tenant is blocked from signing in.'
                  : undefined}
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
                    helperText="One email does it all: receives the invite with a set-password link and becomes the tenant's contact email."
                  />
                  <TextField
                    label="Admin username" fullWidth
                    value={admin.admin_username} onChange={bindAdmin('admin_username')}
                    placeholder={`${slugify(form.name || '') || 'slug'}admin`}
                    helperText="Optional — defaults to <slug>admin on the backend."
                  />
                  <TextField
                    label="Contact phone (optional)" fullWidth
                    value={form.contact_phone || ''} onChange={bind('contact_phone')}
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        checked={admin.send_invite}
                        onChange={(_e, v) => setAdmin((a) => ({ ...a, send_invite: v }))}
                      />
                    }
                    label="Send invite email (the admin sets their own password via the link)"
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
    </Box>
  );
}
