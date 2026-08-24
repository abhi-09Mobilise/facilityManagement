// Site form — create + edit for /admin/sites/:id and /admin/masters/sites/:id.
//
// Fields: Organisation (required on create, locked on edit; populated from
// organisationsApi so the admin picks a real parent), Name (required), Code,
// Address, Status. When arriving from the tabbed Masters shell we pre-fill
// organisation_id from the shared filter cascade.

import { useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, MenuItem, Paper, Stack, TextField } from '@mui/material';
import { useNavigate, useParams } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import { sitesApi } from '@/api/sites.api';
import { organisationsApi } from '@/api/organisations.api';
import { useTenantScope } from '@/context/TenantScopeContext';
import { useAuth } from '@/context/AuthContext';
import type { Organisation, Site } from '@/types';

export default function SiteFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const scope = useTenantScope();
  const { user } = useAuth();
  const editing = id && id !== 'new';

  const [form, setForm] = useState<Partial<Site>>({ status: 1 });
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the Organisation options once. Bare `limit: 200` is fine here — the
  // backend already scopes to the caller's tenant.
  useEffect(() => {
    setOrgsLoading(true);
    organisationsApi.list({ limit: 200 })
      .then((r) => setOrganisations(r.data?.data || []))
      .catch(() => setOrganisations([]))
      .finally(() => setOrgsLoading(false));
  }, []);

  // Pre-fill organisation_id from the tabbed-shell filter when creating.
  useEffect(() => {
    if (editing) return;
    if (scope.organisationId && !form.organisation_id) {
      setForm((f) => ({ ...f, organisation_id: scope.organisationId as number }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, scope.organisationId]);

  useEffect(() => {
    if (editing) {
      setLoading(true);
      sitesApi.getOne(Number(id)).then((r) => r.data && setForm(r.data)).finally(() => setLoading(false));
    }
  }, [editing, id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    // Organisation is required on create — the backend needs a parent org to
    // slot the new site under.
    if (!editing && !form.organisation_id) {
      setError('Please pick an organisation.');
      return;
    }
    setSaving(true);
    try {
      const payload: Partial<Site> & Record<string, unknown> = { ...form };
      if (!editing && form.organisation_id) payload.organisation_id = form.organisation_id;
      // Attach tenant_id from the logged-in user so the backend doesn't need
      // to derive it from the JWT alone. For super_admins user.tenant_id is
      // null (they can target any tenant); the backend will fall back to
      // deriving tenant_id from the picked organisation.
      if (!editing && user?.tenant_id) payload.tenant_id = user.tenant_id;
      if (editing) await sitesApi.update(Number(id), payload);
      else         await sitesApi.create(payload);
      navigate(-1);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { msg?: string } } })?.response?.data?.msg || 'Save failed');
    } finally { setSaving(false); }
  }

  if (loading) return <Box display="flex" justifyContent="center" p={5}><CircularProgress /></Box>;

  return (
    <Box maxWidth={720}>
      <PageHeader title={editing ? `Edit site #${id}` : 'New site'} back="/admin/sites" />
      <Paper sx={{ p: 3 }}>
        <form onSubmit={submit}>
          <Stack spacing={2}>
            <TextField
              select required label="Organisation" fullWidth
              value={form.organisation_id ?? ''}
              onChange={(e) => setForm({ ...form, organisation_id: Number(e.target.value) })}
              disabled={!!editing || orgsLoading}
              error={submitted && !editing && !form.organisation_id}
              helperText={
                editing
                  ? 'Organisation cannot be changed after creation.'
                  : (orgsLoading
                      ? 'Loading organisations…'
                      : (organisations.length === 0
                          ? 'No organisations found — create one first at Masters → Organisations.'
                          : 'The tenant is inherited from this organisation.'))
              }
            >
              {organisations.map((o) => (
                <MenuItem key={o.id} value={o.id}>{o.name}</MenuItem>
              ))}
            </TextField>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField required label="Name" fullWidth value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <TextField label="Code" sx={{ width: 200 }} value={form.code || ''} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            </Stack>
            <TextField label="Address" multiline minRows={2} fullWidth value={form.address || ''} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            <TextField select label="Status" sx={{ width: 180 }} value={form.status ?? 1} onChange={(e) => setForm({ ...form, status: Number(e.target.value) as 0 | 1 })}>
              <MenuItem value={1}>Active</MenuItem>
              <MenuItem value={0}>Inactive</MenuItem>
            </TextField>
            {error && <Alert severity="error">{error}</Alert>}
            <Stack direction="row" justifyContent="flex-end" spacing={1}>
              <Button onClick={() => navigate(-1)}>Cancel</Button>
              <Button type="submit" variant="contained" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
            </Stack>
          </Stack>
        </form>
      </Paper>
    </Box>
  );
}
