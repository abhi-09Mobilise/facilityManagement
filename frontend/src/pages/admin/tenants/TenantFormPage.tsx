import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, MenuItem, Paper, Stack, TextField,
} from '@mui/material';
import { useNavigate, useParams } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import { tenantsApi } from '@/api/tenants.api';
import { lookupsApi } from '@/api/lookups.api';
import type { Tenant, Currency, Timezone, Locale } from '@/types';

const EMPTY: Partial<Tenant> = {
  name: '', slug: '', contact_email: '', contact_phone: '',
  currency_code: 'INR', timezone: 'Asia/Kolkata', locale: 'en-IN', status: 'trial',
};

export default function TenantFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const editing = id && id !== 'new';

  const [form, setForm] = useState<Partial<Tenant>>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [timezones,  setTimezones]  = useState<Timezone[]>([]);
  const [locales,    setLocales]    = useState<Locale[]>([]);

  useEffect(() => {
    lookupsApi.currencies().then((r) => setCurrencies(r.data || [])).catch(() => {});
    lookupsApi.timezones().then((r) => setTimezones(r.data || [])).catch(() => {});
    lookupsApi.locales().then((r) => setLocales(r.data || [])).catch(() => {});
  }, []);

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
      if (editing) await tenantsApi.update(Number(id), form);
      else         await tenantsApi.create(form);
      navigate('/admin/tenants');
    } catch (err: unknown) {
      setError((err as { response?: { data?: { msg?: string } } })?.response?.data?.msg || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Box display="flex" justifyContent="center" p={5}><CircularProgress /></Box>;

  return (
    <Box maxWidth={760}>
      <PageHeader title={editing ? `Edit tenant #${id}` : 'New tenant'} back="/admin/tenants" />
      <Paper sx={{ p: 3 }}>
        <form onSubmit={submit}>
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField required label="Name" fullWidth value={form.name || ''} onChange={bind('name')} />
              <TextField required label="Slug" fullWidth value={form.slug || ''} onChange={bind('slug')} disabled={!!editing} helperText="lowercase, hyphens; cannot be changed later" />
            </Stack>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField label="Contact email" type="email" fullWidth value={form.contact_email || ''} onChange={bind('contact_email')} />
              <TextField label="Contact phone" fullWidth value={form.contact_phone || ''} onChange={bind('contact_phone')} />
            </Stack>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField select label="Currency" fullWidth value={form.currency_code || ''} onChange={bind('currency_code')}>
                {currencies.map((c) => <MenuItem key={c.code} value={c.code}>{c.code} — {c.name}</MenuItem>)}
              </TextField>
              <TextField select label="Timezone" fullWidth value={form.timezone || ''} onChange={bind('timezone')}>
                {timezones.map((t) => <MenuItem key={t.name} value={t.name}>{t.name} ({t.utc_offset})</MenuItem>)}
              </TextField>
              <TextField select label="Locale" fullWidth value={form.locale || ''} onChange={bind('locale')}>
                {locales.map((l) => <MenuItem key={l.code} value={l.code}>{l.code} — {l.name}</MenuItem>)}
              </TextField>
            </Stack>
            <TextField select label="Status" sx={{ maxWidth: 240 }} value={form.status || 'trial'} onChange={bind('status')}>
              <MenuItem value="trial">Trial</MenuItem>
              <MenuItem value="active">Active</MenuItem>
              <MenuItem value="suspended">Suspended</MenuItem>
            </TextField>

            {error && <Alert severity="error">{error}</Alert>}

            <Stack direction="row" justifyContent="flex-end" spacing={1}>
              <Button onClick={() => navigate('/admin/tenants')}>Cancel</Button>
              <Button type="submit" variant="contained" disabled={saving}
                startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </Stack>
          </Stack>
        </form>
      </Paper>
    </Box>
  );
}
