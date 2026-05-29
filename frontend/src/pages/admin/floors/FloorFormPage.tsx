import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DeleteIcon from '@mui/icons-material/Delete';
import { useNavigate, useParams } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import { floorsApi } from '@/api/floors.api';
import { sitesApi } from '@/api/sites.api';
import type { Floor, Site } from '@/types';

// Floors backend has no GET /:id; for edit we fetch the list and locate by id.
export default function FloorFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const editing = id && id !== 'new';

  const [form, setForm] = useState<Partial<Floor>>({ status: 1 });
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Inline base64 upload, capped at ~1.5 MB. The image is the canvas
  // background fallback for every facility on this floor.
  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1.5 * 1024 * 1024) {
      setError('Floor plan image must be 1.5 MB or smaller. Please compress it first.');
      return;
    }
    setError(null);
    const reader = new FileReader();
    reader.onload = () => setForm((prev) => ({ ...prev, layout_image_url: String(reader.result || '') }));
    reader.readAsDataURL(file);
  }

  useEffect(() => {
    sitesApi.list({ limit: 100 }).then((r) => setSites(r.data?.data || []));
    if (editing) {
      setLoading(true);
      floorsApi.list().then((r) => {
        const f = (r.data as Floor[] | undefined)?.find((x) => x.id === Number(id));
        if (f) setForm(f);
      }).finally(() => setLoading(false));
    }
  }, [editing, id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setSaving(true);
    try {
      if (editing) await floorsApi.update(Number(id), form);
      else         await floorsApi.create(form);
      navigate('/admin/floors');
    } catch (err: unknown) {
      setError((err as { response?: { data?: { msg?: string } } })?.response?.data?.msg || 'Save failed');
    } finally { setSaving(false); }
  }

  if (loading) return <Box display="flex" justifyContent="center" p={5}><CircularProgress /></Box>;

  return (
    <Box maxWidth={640}>
      <PageHeader title={editing ? `Edit floor #${id}` : 'New floor'} back="/admin/floors" />
      <Paper sx={{ p: 3 }}>
        <form onSubmit={submit}>
          <Stack spacing={2}>
            <TextField select required label="Site" fullWidth value={form.site_id ?? ''}
              onChange={(e) => setForm({ ...form, site_id: Number(e.target.value) })} disabled={!!editing}>
              {sites.map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
            </TextField>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField required label="Name" fullWidth value={form.name || ''}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                helperText="e.g. Block A / Floor 3" />
              <TextField label="Level number" type="number" sx={{ width: 160 }} value={form.level_number ?? ''}
                onChange={(e) => setForm({ ...form, level_number: e.target.value === '' ? undefined : Number(e.target.value) })} />
            </Stack>
            <TextField select label="Status" sx={{ width: 200 }} value={form.status ?? 1}
              onChange={(e) => setForm({ ...form, status: Number(e.target.value) as 0 | 1 })}>
              <MenuItem value={1}>Active</MenuItem>
              <MenuItem value={0}>Inactive</MenuItem>
            </TextField>

            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
                Floor layout (optional)
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                Upload a floor plan image so admins can place desks &amp; meeting rooms on top of it when creating a facility on this floor. PNG/JPG up to 1.5 MB.
              </Typography>
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                ref={fileInputRef}
                onChange={handleImageUpload}
              />
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<UploadFileIcon />}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {form.layout_image_url ? 'Replace image' : 'Upload image'}
                </Button>
                {form.layout_image_url && (
                  <Button
                    variant="text"
                    size="small"
                    color="error"
                    startIcon={<DeleteIcon />}
                    onClick={() => setForm((prev) => ({ ...prev, layout_image_url: null }))}
                  >
                    Remove
                  </Button>
                )}
              </Stack>
              {form.layout_image_url && (
                <Box sx={{ mt: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', maxWidth: 360 }}>
                  {/* eslint-disable-next-line jsx-a11y/img-redundant-alt */}
                  <img src={form.layout_image_url} alt="Floor plan preview" style={{ display: 'block', width: '100%', height: 'auto' }} />
                </Box>
              )}
            </Box>

            {error && <Alert severity="error">{error}</Alert>}
            <Stack direction="row" justifyContent="flex-end" spacing={1}>
              <Button onClick={() => navigate('/admin/floors')}>Cancel</Button>
              <Button type="submit" variant="contained" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
            </Stack>
          </Stack>
        </form>
      </Paper>
    </Box>
  );
}
