import { useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, MenuItem, Paper, Stack, TextField } from '@mui/material';
import { useNavigate, useParams } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import { mealTimesApi } from '@/api/mealTimes.api';
import type { MealTime } from '@/types';

export default function MealTimeFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const editing = id && id !== 'new';

  const [form, setForm] = useState<Partial<MealTime>>({ start_time: '09:30', end_time: '10:00', status: 1 });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    setLoading(true);
    mealTimesApi.list().then((r) => {
      const m = (r.data as MealTime[] | undefined)?.find((x) => x.id === Number(id));
      if (m) setForm(m);
    }).finally(() => setLoading(false));
  }, [editing, id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setSaving(true);
    try {
      if (editing) await mealTimesApi.update(Number(id), form);
      else         await mealTimesApi.create(form);
      navigate('/admin/meal-times');
    } catch (err: unknown) {
      setError((err as { response?: { data?: { msg?: string } } })?.response?.data?.msg || 'Save failed');
    } finally { setSaving(false); }
  }

  if (loading) return <Box display="flex" justifyContent="center" p={5}><CircularProgress /></Box>;

  return (
    <Box maxWidth={520}>
      <PageHeader title={editing ? `Edit meal time #${id}` : 'New meal time'} back="/admin/meal-times" />
      <Paper sx={{ p: 3 }}>
        <form onSubmit={submit}>
          <Stack spacing={2}>
            <TextField required label="Name" fullWidth value={form.name || ''}
              placeholder="e.g. Morning Tea"
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Stack direction="row" spacing={2}>
              <TextField required type="time" label="Start time" fullWidth InputLabelProps={{ shrink: true }}
                value={(form.start_time || '').slice(0, 5)} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
              <TextField required type="time" label="End time" fullWidth InputLabelProps={{ shrink: true }}
                value={(form.end_time || '').slice(0, 5)} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
            </Stack>
            <TextField select label="Status" sx={{ width: 200 }} value={form.status ?? 1}
              onChange={(e) => setForm({ ...form, status: Number(e.target.value) as 0 | 1 })}>
              <MenuItem value={1}>Active</MenuItem>
              <MenuItem value={0}>Inactive</MenuItem>
            </TextField>
            {error && <Alert severity="error">{error}</Alert>}
            <Stack direction="row" justifyContent="flex-end" spacing={1}>
              <Button onClick={() => navigate('/admin/meal-times')}>Cancel</Button>
              <Button type="submit" variant="contained" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
            </Stack>
          </Stack>
        </form>
      </Paper>
    </Box>
  );
}
