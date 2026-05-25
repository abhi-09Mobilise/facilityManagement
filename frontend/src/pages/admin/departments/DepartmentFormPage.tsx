// Department form (create / edit).
//
// New flow (matches migration 015 + this rev):
//   Site (required) -> rest of the fields.
// A department always belongs to one site. The parent-department concept
// is gone from the UI (departments are flat).
//
// Manager picker is still filtered server-side to users whose designation
// is exactly 'Manager'.

import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, MenuItem, Paper, Stack, TextField,
} from '@mui/material';
import { useNavigate, useParams } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import { departmentsApi } from '@/api/departments.api';
import { sitesApi } from '@/api/sites.api';
import { usersApi } from '@/api/users.api';
import type { Department, Site, User } from '@/types';

export default function DepartmentFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const editing = id && id !== 'new';

  const [form, setForm] = useState<Partial<Department>>({ status: 1 });
  const [sites, setSites] = useState<Site[]>([]);
  const [managers, setManagers] = useState<User[]>([]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sites + manager pool both load once.
  useEffect(() => {
    sitesApi.list({ limit: 200 })
      .then((r) => setSites(r.data?.data || []))
      .catch(() => setSites([]));
    usersApi.list({ limit: 200, designation: 'Manager' })
      .then((r) => setManagers(r.data?.data || []))
      .catch(() => setManagers([]));
  }, []);

  // Load the row being edited.
  useEffect(() => {
    if (!editing) return;
    setLoading(true);
    departmentsApi.list().then((r) => {
      const d = (r.data as Department[] | undefined)?.find((x) => x.id === Number(id));
      if (d) setForm(d);
    }).finally(() => setLoading(false));
  }, [editing, id]);

  function validate(): string | null {
    if (!form.site_id) return 'Pick a site';
    if (!form.name?.trim()) return 'Name is required';
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const msg = validate();
    if (msg) { setError(msg); return; }
    setError(null); setSaving(true);
    // Defensive: parent_dept_id is no longer surfaced in the UI.
    const payload = { ...form, parent_dept_id: null };
    try {
      if (editing) await departmentsApi.update(Number(id), payload);
      else         await departmentsApi.create(payload);
      navigate('/admin/departments');
    } catch (err: unknown) {
      setError((err as { response?: { data?: { msg?: string } } })?.response?.data?.msg || 'Save failed');
    } finally { setSaving(false); }
  }

  if (loading) return <Box display="flex" justifyContent="center" p={5}><CircularProgress /></Box>;

  return (
    <Box maxWidth={720}>
      <PageHeader title={editing ? `Edit department #${id}` : 'New department'} back="/admin/departments" />
      <Paper sx={{ p: 3 }}>
        <form onSubmit={submit}>
          <Stack spacing={2}>
            <TextField
              select required label="Site" fullWidth
              value={form.site_id ?? ''}
              onChange={(e) => setForm({ ...form, site_id: e.target.value ? Number(e.target.value) : null })}
              helperText={
                sites.length === 0
                  ? 'No sites yet - add one under Sites first.'
                  : 'A department belongs to one site.'
              }
            >
              {sites.map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.name}{s.code ? ` - ${s.code}` : ''}
                </MenuItem>
              ))}
            </TextField>

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField required label="Name" fullWidth value={form.name || ''}
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <TextField label="Code" sx={{ width: 180 }} value={form.code || ''}
                onChange={(e) => setForm({ ...form, code: e.target.value })} />
            </Stack>

            <TextField select label="Manager (the head of this department)" fullWidth
              value={form.manager_user_id ?? ''}
              onChange={(e) => setForm({ ...form, manager_user_id: e.target.value ? Number(e.target.value) : null })}
              helperText={
                managers.length === 0
                  ? 'No users with designation = Manager yet. Create one on the Employees page first.'
                  : 'Only users whose designation is "Manager" are listed.'
              }
            >
              <MenuItem value="">- (no manager assigned)</MenuItem>
              {managers.map((u) => (
                <MenuItem key={u.id} value={u.id}>
                  {u.name} {u.lname} ({u.username}){u.email ? ` - ${u.email}` : ''}
                </MenuItem>
              ))}
            </TextField>

            <TextField select label="Status" sx={{ width: 200 }} value={form.status ?? 1}
              onChange={(e) => setForm({ ...form, status: Number(e.target.value) as 0 | 1 })}>
              <MenuItem value={1}>Active</MenuItem>
              <MenuItem value={0}>Inactive</MenuItem>
            </TextField>

            {error && <Alert severity="error">{error}</Alert>}

            <Stack direction="row" justifyContent="flex-end" spacing={1}>
              <Button onClick={() => navigate('/admin/departments')}>Cancel</Button>
              <Button type="submit" variant="contained" disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </Stack>
          </Stack>
        </form>
      </Paper>
    </Box>
  );
}
