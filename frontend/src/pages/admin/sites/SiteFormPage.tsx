import { useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, MenuItem, Paper, Stack, TextField } from '@mui/material';
import { useNavigate, useParams } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import { sitesApi } from '@/api/sites.api';
import type { Site } from '@/types';

export default function SiteFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const editing = id && id !== 'new';

  const [form, setForm] = useState<Partial<Site>>({ status: 1 });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editing) {
      setLoading(true);
      sitesApi.getOne(Number(id)).then((r) => r.data && setForm(r.data)).finally(() => setLoading(false));
    }
  }, [editing, id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setSaving(true);
    try {
      if (editing) await sitesApi.update(Number(id), form);
      else         await sitesApi.create(form);
      navigate('/admin/sites');
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
              <Button onClick={() => navigate('/admin/sites')}>Cancel</Button>
              <Button type="submit" variant="contained" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
            </Stack>
          </Stack>
        </form>
      </Paper>
    </Box>
  );
}
