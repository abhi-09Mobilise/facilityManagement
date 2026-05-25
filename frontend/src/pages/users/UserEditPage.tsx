// Edit an existing user.
//
// Loads via GET /api/users/:id, lets tenant_admin (or super_admin) tweak the
// editable fields and PUT back. Fields the backend's `update` accepts:
//   name, lname, email, mobile, designation, department_id, site_id,
//   status, is_approved, is_approver.
//
// Username, password and role are NOT editable here:
//   - Username: identity field; changing it would break sessions/JWTs.
//   - Password: separate flow (reset / change-password page).
//   - Role: rarely needed; if you want it, add an admin-only field later.

import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, FormControlLabel, MenuItem, Paper, Stack,
  Switch, TextField, Tooltip, Typography,
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useNavigate, useParams } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import { usersApi } from '@/api/users.api';
import { sitesApi } from '@/api/sites.api';
import { departmentsApi } from '@/api/departments.api';
import type { Department, Site, User } from '@/types';

interface FormState {
  id: number;
  name: string;
  lname: string;
  email: string;
  mobile: string;
  designation: string;
  department_id: number | '';
  site_id: number | '';
  status: boolean;
  is_approved: boolean;
  is_approver: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function UserEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const userId = Number(id);

  const [form, setForm] = useState<FormState | null>(null);
  const [readonly, setReadonly] = useState<Pick<User, 'username' | 'role' | 'tenant_id'> | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    Promise.all([
      usersApi.getOne(userId),
      sitesApi.list({ limit: 200 }).catch(() => null),
      departmentsApi.list().catch(() => null),
    ])
      .then(([uRes, sRes, dRes]) => {
        if (!uRes.status || !uRes.data) throw new Error(uRes.msg || 'User not found');
        const u = uRes.data;
        setForm({
          id: u.id,
          name: u.name || '',
          lname: u.lname || '',
          email: u.email || '',
          mobile: u.mobile || '',
          designation: u.designation || '',
          department_id: u.department_id ?? '',
          site_id: u.site_id ?? '',
          status: u.status !== 0,
          is_approved: u.is_approved !== 0,
          is_approver: u.is_approver === 1,
        });
        setReadonly({ username: u.username, role: u.role, tenant_id: u.tenant_id });
        setSites(sRes?.data?.data || []);
        setDepartments(((dRes?.data as Department[] | undefined) || []));
      })
      .catch((err: unknown) => {
        setError(
          (err as { response?: { data?: { msg?: string } } })?.response?.data?.msg
          || (err as Error)?.message
          || 'Failed to load user'
        );
      })
      .finally(() => setLoading(false));
  }, [userId]);

  function bind(key: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => (f ? { ...f, [key]: e.target.value } : f));
  }
  function bindBool(key: keyof FormState) {
    return (_e: unknown, checked: boolean) =>
      setForm((f) => (f ? { ...f, [key]: checked } : f));
  }

  function validate(): string | null {
    if (!form) return 'Form not loaded';
    if (form.email && !EMAIL_RE.test(form.email)) return 'Email is not valid';
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const msg = validate();
    if (msg) { setError(msg); return; }

    setError(null);
    setSaving(true);
    try {
      const res = await usersApi.update({
        id: form.id,
        name: form.name || undefined,
        lname: form.lname || undefined,
        email: form.email || undefined,
        mobile: form.mobile || undefined,
        designation: form.designation || undefined,
        department_id: form.department_id === '' ? null : form.department_id,
        site_id:       form.site_id === ''       ? null : form.site_id,
        status:      form.status      ? 1 : 0,
        is_approved: form.is_approved ? 1 : 0,
        is_approver: form.is_approver ? 1 : 0,
      });
      if (!res.status) throw new Error(res.msg || 'Save failed');
      navigate('/admin/users');
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { msg?: string } } })?.response?.data?.msg
        || (err as Error)?.message
        || 'Failed to update user'
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <Box display="flex" justifyContent="center" p={5}><CircularProgress /></Box>;
  }
  if (!form || !readonly) {
    return (
      <Box maxWidth={760}>
        <PageHeader title={`Edit user #${id}`} back="/admin/users" />
        <Alert severity="error">{error || 'User not found'}</Alert>
      </Box>
    );
  }

  return (
    <Box maxWidth={760}>
      <PageHeader
        title={`Edit user · ${readonly.username}`}
        subtitle={`Role: ${readonly.role}`}
        back="/admin/users"
      />
      <Paper sx={{ p: 3 }}>
        <form onSubmit={submit} autoComplete="off">
          <Stack spacing={2}>

            {/* read-only identity row */}
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField label="Username" fullWidth value={readonly.username} disabled
                helperText="Username can't be changed" />
              <TextField label="System role" sx={{ minWidth: 200 }} value={readonly.role} disabled />
            </Stack>

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField label="First name" fullWidth value={form.name} onChange={bind('name')} />
              <TextField label="Last name"  fullWidth value={form.lname} onChange={bind('lname')} />
            </Stack>

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField type="email" label="Email" fullWidth value={form.email} onChange={bind('email')} />
              <TextField label="Mobile" fullWidth value={form.mobile} onChange={bind('mobile')} />
            </Stack>

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField
                select label="Site" fullWidth
                value={form.site_id}
                onChange={(e) => setForm((f) => f && ({ ...f, site_id: e.target.value === '' ? '' : Number(e.target.value) }))}
              >
                <MenuItem value="">— No site —</MenuItem>
                {sites.map((s) => (
                  <MenuItem key={s.id} value={s.id}>{s.name}{s.code ? ` · ${s.code}` : ''}</MenuItem>
                ))}
              </TextField>
              <TextField
                select label="Department" fullWidth
                value={form.department_id}
                onChange={(e) => setForm((f) => f && ({ ...f, department_id: e.target.value === '' ? '' : Number(e.target.value) }))}
              >
                <MenuItem value="">— No department —</MenuItem>
                {departments.map((d) => (
                  <MenuItem key={d.id} value={d.id}>{d.name}{d.code ? ` · ${d.code}` : ''}</MenuItem>
                ))}
              </TextField>
            </Stack>

            <TextField label="Designation" fullWidth value={form.designation} onChange={bind('designation')}
              placeholder="e.g. Team Lead, Manager, Lab Safety Officer"
              helperText="Free text. Shown next to the user's name when picking approvers." />

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={4}>
              <FormControlLabel
                control={<Switch checked={form.status} onChange={bindBool('status')} />}
                label="Active" />
              <FormControlLabel
                control={<Switch checked={form.is_approved} onChange={bindBool('is_approved')} />}
                label="Approved to sign in" />
              <FormControlLabel
                control={<Switch checked={form.is_approver} onChange={bindBool('is_approver')} />}
                label={
                  <Stack direction="row" alignItems="center" spacing={0.5}>
                    <span>Can be an approver</span>
                    <Tooltip title="When on, this user can be selected on approval workflow steps.">
                      <InfoOutlinedIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                    </Tooltip>
                  </Stack>
                } />
            </Stack>

            {!readonly.role
              || readonly.role === 'employee'
              || readonly.role === 'approver' ? null : (
              <Typography variant="caption" color="text.secondary">
                This user is a <strong>{readonly.role}</strong>. Only super admins can modify admins.
              </Typography>
            )}

            {error && <Alert severity="error">{error}</Alert>}

            <Stack direction="row" spacing={2} justifyContent="flex-end">
              <Button onClick={() => navigate('/admin/users')} disabled={saving}>Cancel</Button>
              <Button type="submit" variant="contained" disabled={saving}
                startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}>
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
            </Stack>
                  </Stack>
        </form>
      </Paper>
    </Box>
  );
}
