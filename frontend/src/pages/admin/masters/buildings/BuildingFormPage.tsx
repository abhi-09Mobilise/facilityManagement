// Building form — create + edit under /admin/masters/buildings/:id.
//
// Fields: Organisation (required, UI-level; filters the Site list),
// Site (required, scoped by the picked Organisation), Name (required),
// Code, Address, Status. tenant_id + organisation_id are derived from the
// parent Site on the backend, so the payload only carries site_id + friendly
// fields — the Organisation dropdown exists purely to gate the Site picker
// so an admin can't accidentally cross orgs.

import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, MenuItem, Paper, Stack, TextField,
} from '@mui/material';
import { useNavigate, useParams } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import { buildingsApi } from '@/api/buildings.api';
import { sitesApi } from '@/api/sites.api';
import { organisationsApi } from '@/api/organisations.api';
import { useMastersFilter } from '@/contexts/MastersFilterContext';
import { useTenantScope } from '@/context/TenantScopeContext';
import type { Building, Organisation, Site } from '@/types';

export default function BuildingFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const filter = useMastersFilter();
  const scope = useTenantScope();
  const editing = id && id !== 'new';

  const [form, setForm] = useState<Partial<Building>>({ status: 1 });
  const [organisationId, setOrganisationId] = useState<number | ''>('');
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(false);
  const [sites, setSites] = useState<Site[]>([]);
  const [sitesLoading, setSitesLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // Load organisations once on mount. Backend already scopes to the caller's
  // tenant.
  useEffect(() => {
    setOrgsLoading(true);
    organisationsApi.list({ limit: 200 })
      .then((r) => setOrganisations(r.data?.data || []))
      .catch(() => setOrganisations([]))
      .finally(() => setOrgsLoading(false));
  }, []);

  // Pre-fill organisationId from the navbar TenantScope on CREATE, so the
  // building lands under whichever org the admin is currently working in.
  useEffect(() => {
    if (editing) return;
    if (scope.organisationId && !organisationId) setOrganisationId(scope.organisationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, scope.organisationId]);

  // Site dropdown scoped by the picked organisation. Loads sites for whatever
  // org is currently selected (form-level state, not the shell filter, so
  // this works even on the legacy standalone route path).
  useEffect(() => {
    if (!organisationId) {
      setSites([]);
      return;
    }
    setSitesLoading(true);
    sitesApi.list({ organisation_id: Number(organisationId), limit: 200 })
      .then((r) => setSites(r.data?.data || []))
      .catch(() => setSites([]))
      .finally(() => setSitesLoading(false));
  }, [organisationId]);

  // Pre-fill site_id from the shell filter when creating a new building.
  useEffect(() => {
    if (editing) return;
    if (filter.siteId && !form.site_id) {
      setForm((f) => ({ ...f, site_id: filter.siteId as number }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, filter.siteId]);

  useEffect(() => {
    if (!editing) return;
    setLoading(true);
    buildingsApi.getOne(Number(id))
      .then((r) => {
        if (r.data) {
          const b = r.data as Building;
          setForm(b);
          // On EDIT, seed the Organisation picker from the loaded building
          // so the Site dropdown renders the correct scoped list.
          if (b.organisation_id) setOrganisationId(b.organisation_id);
        }
      })
      .finally(() => setLoading(false));
  }, [editing, id]);

  const showSitePicker = useMemo(() => sites.length > 0 || !editing, [sites.length, editing]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    setError(null); setSaving(true);
    try {
      const payload: Partial<Building> & Record<string, unknown> = {
        name: (form.name || '').trim(),
        code: form.code || null,
        address: form.address || null,
        status: form.status ?? 1,
      };
      if (!editing) {
        if (!organisationId) {
          setError('Please pick an organisation.');
          setSaving(false);
          return;
        }
        // Backend derives tenant + org from site — but demands site_id.
        if (!form.site_id) {
          setError('Please pick a site.');
          setSaving(false);
          return;
        }
        payload.site_id = form.site_id;
      }
      if (editing) await buildingsApi.update(Number(id), payload);
      else         await buildingsApi.create(payload);
      navigate('/admin/masters/buildings');
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { msg?: string } } })?.response?.data?.msg
        || 'Save failed'
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Box display="flex" justifyContent="center" p={5}><CircularProgress /></Box>;

  return (
    <Box maxWidth={720}>
      <PageHeader
        title={editing ? `Edit building #${id}` : 'New building'}
        back="/admin/masters/buildings"
      />
      <Paper sx={{ p: 3 }}>
        <form onSubmit={submit}>
          <Stack spacing={2}>
            <TextField
              select required label="Organisation" fullWidth
              value={organisationId}
              onChange={(e) => {
                const next = e.target.value === '' ? '' : Number(e.target.value);
                // Changing org clears the picked site — a site belongs to
                // exactly one org so the previous pick would be invalid.
                setOrganisationId(next);
                setForm((f) => ({ ...f, site_id: undefined }));
              }}
              disabled={!!editing || orgsLoading}
              error={submitted && !editing && !organisationId}
              helperText={
                editing
                  ? 'Organisation cannot be changed after creation.'
                  : (orgsLoading
                      ? 'Loading organisations…'
                      : (organisations.length === 0
                          ? 'No organisations found — create one first at Masters → Organisations.'
                          : 'Sites are filtered to this organisation.'))
              }
            >
              {organisations.map((o) => (
                <MenuItem key={o.id} value={o.id}>{o.name}</MenuItem>
              ))}
            </TextField>

            {showSitePicker && (
              <TextField
                select required label="Site" fullWidth
                value={form.site_id ?? ''}
                onChange={(e) => setForm({ ...form, site_id: Number(e.target.value) })}
                disabled={!!editing || !organisationId || sitesLoading}
                error={submitted && !editing && !form.site_id}
                helperText={
                  editing
                    ? 'Site cannot be moved after creation.'
                    : (!organisationId
                        ? 'Pick an organisation first.'
                        : (sitesLoading
                            ? 'Loading sites…'
                            : (sites.length === 0
                                ? 'No sites for this organisation.'
                                : 'The tenant and organisation are inherited from this site.')))
                }
              >
                {sites.map((s) => (
                  <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>
                ))}
              </TextField>
            )}

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField
                required label="Name" fullWidth
                value={form.name || ''}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              <TextField
                label="Code" sx={{ width: 200 }}
                value={form.code || ''}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
              />
            </Stack>

            <TextField
              label="Address" multiline minRows={2} fullWidth
              value={form.address || ''}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />

            <TextField
              select label="Status" sx={{ width: 200 }}
              value={form.status ?? 1}
              onChange={(e) => setForm({ ...form, status: Number(e.target.value) as 0 | 1 })}
            >
              <MenuItem value={1}>Active</MenuItem>
              <MenuItem value={0}>Inactive</MenuItem>
            </TextField>

            {error && <Alert severity="error">{error}</Alert>}

            <Stack direction="row" justifyContent="flex-end" spacing={1}>
              <Button onClick={() => navigate('/admin/masters/buildings')}>Cancel</Button>
              <Button type="submit" variant="contained" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </Stack>
          </Stack>
        </form>
      </Paper>
    </Box>
  );
}
