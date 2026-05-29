import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, MenuItem, Paper, Stack, TextField,
} from '@mui/material';
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

export default function TenantFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const editing = id && id !== 'new';

  const [form, setForm] = useState<Partial<Tenant>>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      // Build the outgoing payload: name + contact info + Active/Inactive,
      // plus a freshly-slugified slug and the default locale/currency/tz so
      // the backend's required-field validators stay happy.
      const payload: Partial<Tenant> = {
        ...form,
        slug: editing ? form.slug : (form.slug || slugify(form.name || '')),
        currency_code: form.currency_code || 'INR',
        locale: form.locale || 'en-IN',
        timezone: form.timezone || 'Asia/Kolkata',
      };
      if (editing) await tenantsApi.update(Number(id), payload);
      else         await tenantsApi.create(payload);
      navigate('/admin/tenants');
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
    </Box>
  );
}
