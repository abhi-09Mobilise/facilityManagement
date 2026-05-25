// New User form.
//
// Cascading flow:
//   1. Site             - required dropdown
//   2. Department       - disabled until Site picked; filtered to site's departments
//   3. User type        - radio: Manager vs Employee
//                          Manager preselects is_approver=1 + designation='Manager'
//                          Employee leaves both off
//   4. Details          - username, name, password, etc.
//
// Note: picking "Manager" here does NOT auto-set departments.manager_user_id —
// that's an explicit choice on the Department edit form. Multiple managers
// can coexist in one department.

import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Divider, FormControlLabel, MenuItem, Paper,
  Radio, RadioGroup, Stack, Switch, TextField, Tooltip, Typography,
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import GroupsIcon from '@mui/icons-material/Groups';
import PersonIcon from '@mui/icons-material/Person';
import { useNavigate } from 'react-router-dom';
import { usersApi } from '@/api/users.api';
import { sitesApi } from '@/api/sites.api';
import { departmentsApi } from '@/api/departments.api';
import { useAuth } from '@/context/AuthContext';
import type { Department, Role, Site } from '@/types';

type UserKind = 'manager' | 'employee';

interface FormState {
  // Step 1-3
  site_id: number | '';
  department_id: number | '';
  user_kind: UserKind;

  // Step 4
  username: string;
  password: string;
  confirmPassword: string;
  name: string;
  lname: string;
  email: string;
  mobile: string;
  designation: string;
  role: Role;
  status: boolean;
  is_approved: boolean;
  is_approver: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const INITIAL: FormState = {
  site_id: '', department_id: '',
  user_kind: 'employee',
  username: '', password: '', confirmPassword: '',
  name: '', lname: '', email: '', mobile: '',
  designation: '',
  role: 'employee',
  status: true, is_approved: true, is_approver: false,
};

export default function UserCreatePage() {
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const isSuper = currentUser?.role === 'super_admin';

  const [form, setForm] = useState<FormState>(INITIAL);
  const [sites, setSites] = useState<Site[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loadingSites, setLoadingSites] = useState(true);
  const [loadingDepts, setLoadingDepts] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load Sites once.
  useEffect(() => {
    setLoadingSites(true);
    sitesApi.list({ limit: 200 })
      .then((r) => setSites(r.data?.data || []))
      .catch(() => {})
      .finally(() => setLoadingSites(false));
  }, []);

  // Departments are site-scoped (migration 015 + the recent controller update).
  // Refetch every time the picked site changes; clear the list when no site
  // is picked so the dropdown stays empty rather than showing stale options.
  useEffect(() => {
    if (!form.site_id) {
      setDepartments([]);
      return;
    }
    setLoadingDepts(true);
    departmentsApi.list({ site_id: form.site_id })
      .then((r) => setDepartments((r.data as Department[]) || []))
      .catch(() => setDepartments([]))
      .finally(() => setLoadingDepts(false));
  }, [form.site_id]);

  // When user_kind toggles, preset designation + is_approver (admin can still override).
  const presets = useMemo(() => ({
    manager:  { is_approver: true,  designation: 'Manager' },
    employee: { is_approver: false, designation: '' },
  }), []);

  function pickKind(kind: UserKind) {
    setForm((f) => ({
      ...f,
      user_kind: kind,
      // Only overwrite if the field is in its "default" state for the other kind,
      // so the admin's manual edits aren't wiped.
      is_approver: f.is_approver === presets[f.user_kind === 'manager' ? 'manager' : 'employee'].is_approver
        ? presets[kind].is_approver
        : f.is_approver,
      designation: !f.designation || f.designation === presets[f.user_kind === 'manager' ? 'manager' : 'employee'].designation
        ? presets[kind].designation
        : f.designation,
    }));
  }

  function bind(key: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => {
        const next = { ...f, [key]: e.target.value };
        // Auto-mirror is_approver when role becomes 'approver'.
        if (key === 'role') {
          if (e.target.value === 'approver') next.is_approver = true;
        }
        return next;
      });
  }
  function bindBool(key: keyof FormState) {
    return (_e: unknown, checked: boolean) =>
      setForm((f) => ({ ...f, [key]: checked }));
  }

  function validate(): string | null {
    if (!form.site_id) return 'Pick a site';
    if (!form.department_id) return 'Pick a department';
    if (!form.username.trim()) return 'Username is required';
    if (form.password.length < 6) return 'Password must be at least 6 characters';
    if (form.password !== form.confirmPassword) return 'Passwords do not match';
    if (form.email && !EMAIL_RE.test(form.email)) return 'Email is not valid';
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const msg = validate();
    if (msg) { setError(msg); return; }
    setError(null);
    setSaving(true);
    try {
      const res = await usersApi.create({
        username: form.username.trim(),
        password: form.password,
        name: form.name || undefined,
        lname: form.lname || undefined,
        email: form.email || undefined,
        mobile: form.mobile || undefined,
        designation: form.designation || undefined,
        department_id: form.department_id === '' ? null : form.department_id,
        site_id: form.site_id === '' ? null : form.site_id,
        role: form.role,
        status: form.status ? 1 : 0,
        is_approved: form.is_approved ? 1 : 0,
        is_approver: form.is_approver ? 1 : 0,
      });
      if (!res.status) throw new Error(res.msg || 'Create failed');
      navigate('/admin/users');
    } catch (err: unknown) {
      const m = (err as { response?: { data?: { msg?: string } } })?.response?.data?.msg
        || (err as Error)?.message || 'Failed to create user';
      setError(m);
    } finally {
      setSaving(false);
    }
  }

  const step1Done = !!form.site_id;
  const step2Done = !!form.department_id;
  const detailsDisabled = !step2Done;

  return (
    <Box maxWidth={780}>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>New User</Typography>
      <Paper sx={{ p: 3 }}>
        <form onSubmit={submit} autoComplete="off">
          <Stack spacing={3}>
            {/* ---- Step 1: Site ---- */}
            <Box>
              <StepHeader n={1} label="Pick a site" done={step1Done} />
              <TextField
                select required fullWidth label="Site"
                value={form.site_id}
                onChange={(e) => setForm((f) => ({ ...f, site_id: e.target.value === '' ? '' : Number(e.target.value), department_id: '' }))}
                disabled={loadingSites}
                helperText={loadingSites ? 'Loading sites…' : (sites.length === 0 ? 'No sites yet — add one under Sites first' : '')}
              >
                {sites.map((s) => (
                  <MenuItem key={s.id} value={s.id}>{s.name}{s.code ? ` · ${s.code}` : ''}</MenuItem>
                ))}
              </TextField>
            </Box>

            {/* ---- Step 2: Department ---- */}
            <Box>
              <StepHeader n={2} label="Pick a department" done={step2Done} />
              <TextField
                select required fullWidth label="Department"
                value={form.department_id}
                onChange={(e) => setForm((f) => ({ ...f, department_id: e.target.value === '' ? '' : Number(e.target.value) }))}
                disabled={loadingDepts}
                helperText={
                  loadingDepts ? 'Loading departments…' :
                  (departments.length === 0 ? 'No departments yet — add one under Departments' : '')
                }
              >
                {departments.map((d) => (
                  <MenuItem key={d.id} value={d.id}>{d.name}{d.code ? ` · ${d.code}` : ''}</MenuItem>
                ))}
              </TextField>
            </Box>

            {/* ---- Step 3: User type ---- */}
            <Box sx={{ opacity: step2Done ? 1 : 0.5, pointerEvents: step2Done ? 'auto' : 'none' }}>
              <StepHeader n={3} label="Manager or Employee?" />
              <RadioGroup
                row value={form.user_kind}
                onChange={(_, v) => pickKind(v as UserKind)}
                sx={{ mt: 1 }}
              >
                <Paper variant="outlined" sx={{ p: 1.5, mr: 2, flex: 1, borderColor: form.user_kind === 'manager' ? 'primary.main' : undefined, borderWidth: form.user_kind === 'manager' ? 2 : 1 }}>
                  <FormControlLabel
                    value="manager"
                    control={<Radio />}
                    label={
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <GroupsIcon fontSize="small" />
                        <Box>
                          <Typography sx={{ fontWeight: 600 }}>Manager</Typography>
                          <Typography variant="caption" color="text.secondary">
                            Can approve bookings. Designation = "Manager".
                          </Typography>
                        </Box>
                      </Stack>
                    }
                  />
                </Paper>
                <Paper variant="outlined" sx={{ p: 1.5, flex: 1, borderColor: form.user_kind === 'employee' ? 'primary.main' : undefined, borderWidth: form.user_kind === 'employee' ? 2 : 1 }}>
                  <FormControlLabel
                    value="employee"
                    control={<Radio />}
                    label={
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <PersonIcon fontSize="small" />
                        <Box>
                          <Typography sx={{ fontWeight: 600 }}>Employee</Typography>
                          <Typography variant="caption" color="text.secondary">
                            Regular user. Books facilities, doesn't approve.
                          </Typography>
                        </Box>
                      </Stack>
                    }
                  />
                </Paper>
              </RadioGroup>
            </Box>

            <Divider />

            {/* ---- Step 4: Details ---- */}
            <Box sx={{ opacity: detailsDisabled ? 0.5 : 1, pointerEvents: detailsDisabled ? 'none' : 'auto' }}>
              <StepHeader n={4} label="User details" />
              <Stack spacing={2}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                  <TextField required label="Username" fullWidth
                    value={form.username} onChange={bind('username')}
                    inputProps={{ autoComplete: 'off' }} />
                  <TextField select required label="System role" sx={{ minWidth: 200 }}
                    value={form.role} onChange={bind('role')}
                    helperText={form.role === 'approver' ? 'Approver implies is_approver=1.' : ' '}>
                    <MenuItem value="employee">Employee</MenuItem>
                    <MenuItem value="approver">Approver</MenuItem>
                    <MenuItem value="tenant_admin" disabled={!isSuper}>
                      Tenant admin {!isSuper && '(super only)'}
                    </MenuItem>
                    <MenuItem value="super_admin" disabled={!isSuper}>
                      Super admin {!isSuper && '(super only)'}
                    </MenuItem>
                  </TextField>
                </Stack>

                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                  <TextField required type="password" label="Password" fullWidth
                    value={form.password} onChange={bind('password')}
                    inputProps={{ autoComplete: 'new-password' }}
                    helperText="Minimum 6 characters" />
                  <TextField required type="password" label="Confirm password" fullWidth
                    value={form.confirmPassword} onChange={bind('confirmPassword')}
                    inputProps={{ autoComplete: 'new-password' }} />
                </Stack>

                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                  <TextField label="First name" fullWidth value={form.name} onChange={bind('name')} />
                  <TextField label="Last name"  fullWidth value={form.lname} onChange={bind('lname')} />
                </Stack>

                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                  <TextField type="email" label="Email" fullWidth value={form.email} onChange={bind('email')} />
                  <TextField label="Mobile" fullWidth value={form.mobile} onChange={bind('mobile')} />
                </Stack>

                <TextField label="Designation" fullWidth
                  value={form.designation} onChange={bind('designation')}
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
              </Stack>
            </Box>

            {error && <Alert severity="error">{error}</Alert>}

            <Stack direction="row" spacing={2} justifyContent="flex-end">
              <Button onClick={() => navigate('/admin/users')} disabled={saving}>Cancel</Button>
              <Button
                type="submit" variant="contained" disabled={saving}
                startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
              >
                {saving ? 'Saving…' : 'Create User'}
              </Button>
            </Stack>
          </Stack>
        </form>
      </Paper>
    </Box>
  );
}

// Small step header with number + check when complete.
function StepHeader({ n, label, done, dim }: { n: number; label: string; done?: boolean; dim?: boolean }) {
  return (
    <Stack direction="row" alignItems="center" spacing={1} mb={1} sx={{ opacity: dim ? 0.5 : 1 }}>
      <Box sx={{
        width: 24, height: 24, borderRadius: '50%',
        bgcolor: done ? 'success.main' : 'action.selected',
        color: done ? 'common.white' : 'text.secondary',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, fontWeight: 700,
      }}>{done ? '✓' : n}</Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{label}</Typography>
    </Stack>
  );
}
