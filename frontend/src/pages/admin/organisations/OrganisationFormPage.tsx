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
import { organisationsApi } from '@/api/organisations.api';
import { tenantsApi } from '@/api/tenants.api';
import { useAuth } from '@/context/AuthContext';
import type { Organisation, Tenant } from '@/types';

// Slugify helper mirrors the backend rule so the operator sees the resulting
// slug live as they type the name. The backend re-runs this + a uniqueness
// dedupe on submit, so the final slug may still get a -2 suffix.
function slugify(s: string): string {
  return (s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

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

function randomPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$';
  let out = '';
  const arr = new Uint32Array(12);
  window.crypto.getRandomValues(arr);
  for (let i = 0; i < 12; i += 1) out += chars[arr[i] % chars.length];
  return out;
}

export default function OrganisationFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const editing = id && id !== 'new';
  const isSuper = user?.role === 'super_admin';

  const [form, setForm] = useState<Partial<Organisation>>({ status: 1 });
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [admin, setAdmin] = useState<AdminForm>(EMPTY_ADMIN);
  const [showPwd, setShowPwd] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Load tenants only for super_admin (tenant_admin is scoped server-side).
  useEffect(() => {
    if (!isSuper) return;
    tenantsApi.list({ limit: 200 })
      .then((r) => setTenants((r.data?.data as Tenant[]) || []))
      .catch(() => {});
  }, [isSuper]);

  useEffect(() => {
    if (!editing) return;
    setLoading(true);
    organisationsApi.getOne(Number(id))
      .then((r) => r.data && setForm(r.data as Organisation))
      .finally(() => setLoading(false));
  }, [editing, id]);

  // Auto-fill the slug from the name while the operator hasn't touched it.
  function onNameChange(v: string) {
    setForm((f) => ({
      ...f,
      name: v,
      slug: (!editing && !slugTouched) ? slugify(v) : (f.slug ?? ''),
    }));
  }

  function bindAdmin(key: keyof AdminForm) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setAdmin((a) => ({ ...a, [key]: e.target.value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setSaving(true);
    try {
      const payload: Partial<Organisation> & Record<string, unknown> = {
        name: (form.name || '').trim(),
        slug: form.slug || slugify(form.name || ''),
        logo_url: form.logo_url || null,
        status: form.status ?? 1,
      };
      if (isSuper && !editing && form.tenant_id) {
        payload.tenant_id = form.tenant_id;
      }
      if (!editing && admin.admin_email.trim()) {
        payload.admin_name = admin.admin_name || undefined;
        payload.admin_lname = admin.admin_lname || undefined;
        payload.admin_email = admin.admin_email.trim();
        payload.admin_username = admin.admin_username.trim() || undefined;
        payload.admin_password = admin.admin_password || undefined;
        payload.send_invite = admin.send_invite;
      }

      if (editing) {
        await organisationsApi.update(Number(id), payload);
        navigate('/admin/masters/organisations');
      } else {
        await organisationsApi.create(payload);
        if (admin.admin_email.trim() && admin.send_invite) {
          setToast(`Organisation created. An invite email has been sent to ${admin.admin_email.trim()}.`);
          setTimeout(() => navigate('/admin/masters/organisations'), 1200);
        } else {
          navigate('/admin/masters/organisations');
        }
      }
    } catch (err: unknown) {
      setError((err as { response?: { data?: { msg?: string } } })?.response?.data?.msg || 'Save failed');
    } finally { setSaving(false); }
  }

  if (loading) return <Box display="flex" justifyContent="center" p={5}><CircularProgress /></Box>;

  return (
    <Box maxWidth={720}>
      <PageHeader
        title={editing ? `Edit organisation #${id}` : 'New organisation'}
        back="/admin/organisations"
      />
      <Paper sx={{ p: 3 }}>
        <form onSubmit={submit}>
          <Stack spacing={2}>
            {/* Tenant picker: only super_admin sees it, only on create. */}
            {isSuper && !editing && (
              <TextField
                select required label="Tenant" fullWidth
                value={form.tenant_id ?? ''}
                onChange={(e) => setForm({ ...form, tenant_id: Number(e.target.value) })}
              >
                {tenants.map((t) => (
                  <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>
                ))}
              </TextField>
            )}

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField
                required label="Name" fullWidth
                value={form.name || ''}
                onChange={(e) => onNameChange(e.target.value)}
              />
              <TextField
                label="Slug" sx={{ width: 240 }}
                value={form.slug || ''}
                onChange={(e) => { setSlugTouched(true); setForm({ ...form, slug: e.target.value }); }}
                helperText="URL-safe. Auto-derived from the name."
              />
            </Stack>

            <TextField
              label="Logo URL" fullWidth
              value={form.logo_url || ''}
              onChange={(e) => setForm({ ...form, logo_url: e.target.value })}
              helperText="Paste a URL for now. Uploads land here in a later stage."
            />

            <TextField
              select label="Status" sx={{ width: 180 }}
              value={form.status ?? 1}
              onChange={(e) => setForm({ ...form, status: Number(e.target.value) as 0 | 1 })}
            >
              <MenuItem value={1}>Active</MenuItem>
              <MenuItem value={0}>Inactive</MenuItem>
            </TextField>

            {/* ---- Admin user (create-mode only) ---- */}
            {!editing && (
              <>
                <Divider sx={{ mt: 1 }} />
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  Organisation admin user
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
                  placeholder={`${form.slug || slugify(form.name || '') || 'org'}admin`}
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
              <Button onClick={() => navigate('/admin/masters/organisations')}>Cancel</Button>
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
