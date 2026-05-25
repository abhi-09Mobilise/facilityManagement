import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Divider, FormControlLabel, IconButton,
  MenuItem, Paper, Stack, Switch, TextField, Typography,
} from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import { useNavigate, useParams } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import { facilitiesApi } from '@/api/facilities.api';
import { sitesApi } from '@/api/sites.api';
import { floorsApi } from '@/api/floors.api';
import { usersApi } from '@/api/users.api';
import { slotCapacitiesApi, type SlotOverride } from '@/api/slotCapacities.api';
import { facilityPantriesApi } from '@/api/pantries.api';
import type {
  ApproverOption, Facility, FacilityApprovalChainStep, FacilityType, Floor,
  OperatingHour, Site,
} from '@/types';
import SlotCapacitiesEditor, { findSlotOverlap } from './components/SlotCapacitiesEditor';
import FacilityPantriesPicker from './components/FacilityPantriesPicker';
import CheckoutChainEditor from './components/CheckoutChainEditor';

const TYPES: { value: FacilityType; label: string }[] = [
  { value: 'meeting_room',   label: 'Meeting room' },
  { value: 'gym',            label: 'Gym' },
  { value: 'conference_room',label: 'Conference room' },
  { value: 'desk',           label: 'Desk' },
  { value: 'swimming_pool',  label: 'Swimming pool' },
  { value: 'other',          label: 'Other' },
];

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function defaultHours(): OperatingHour[] {
  return [1, 2, 3, 4, 5].map((d) => ({
    day_of_week: d, open_time: '09:00', close_time: '19:00', slot_minutes: 30,
  }));
}

// Default check-in chain shown for a brand-new facility: just the booker's
// dept manager. Admins add more steps via the editor below if needed.
function defaultCheckinChain(): FacilityApprovalChainStep[] {
  return [{ step_order: 1, approver_kind: 'dynamic_dept_manager', approver_user_id: null }];
}

function approverLabel(u: ApproverOption): string {
  const name = [u.name, u.lname].filter(Boolean).join(' ');
  const display = name || u.username;
  return u.designation ? `${display} - ${u.designation}` : display;
}

export default function FacilityFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const editing = id && id !== 'new';

  const [form, setForm] = useState<Partial<Facility>>({
    type: 'meeting_room', capacity: 0, requires_approval: 0, status: 1,
  });
  const [hours, setHours] = useState<OperatingHour[]>(defaultHours());

  // Check-in (pre-booking) chain - the inline editor below renders this.
  // Only visible when "Requires approval" is on.
  const [chain, setChain] = useState<FacilityApprovalChainStep[]>(defaultCheckinChain());

  // F02 - Check-out (post-booking) chain.
  const [checkoutChain, setCheckoutChain] = useState<FacilityApprovalChainStep[]>([]);

  // F01 - Slot capacity overrides.
  const [slotOverrides, setSlotOverrides] = useState<SlotOverride[]>([]);

  // F06 - Linked pantry ids.
  const [pantryIds, setPantryIds] = useState<number[]>([]);

  const [sites, setSites] = useState<Site[]>([]);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [approvers, setApprovers] = useState<ApproverOption[]>([]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    sitesApi.list({ limit: 100 }).then((r) => setSites(r.data?.data || []));
    usersApi.approvers().then((r) => setApprovers((r.data as ApproverOption[]) || []));
  }, []);

  useEffect(() => {
    if (form.site_id) {
      floorsApi.list({ site_id: form.site_id }).then((r) => setFloors((r.data as Floor[]) || []));
    } else setFloors([]);
  }, [form.site_id]);

  useEffect(() => {
    if (!editing) return;
    setLoading(true);
    const facId = Number(id);
    Promise.all([
      facilitiesApi.getOne(facId),
      slotCapacitiesApi.list(facId).catch(() => ({ status: false, data: [] as SlotOverride[] })),
      facilityPantriesApi.list(facId).catch(() => ({ status: false, data: [] as { id: number }[] })),
      facilitiesApi.getChain(facId, 'checkout').catch(() => ({ status: false, data: [] as FacilityApprovalChainStep[] })),
    ]).then(([fRes, soRes, fpRes, coRes]) => {
      if (fRes.data) {
        setForm(fRes.data);
        setHours((fRes.data.operating_hours && fRes.data.operating_hours.length > 0)
          ? fRes.data.operating_hours : defaultHours());
        setChain((fRes.data.approval_chain && fRes.data.approval_chain.length > 0)
          ? fRes.data.approval_chain
          : defaultCheckinChain());
      }
      if (soRes.status) setSlotOverrides((soRes.data || []) as SlotOverride[]);
      if (fpRes.status) setPantryIds(((fpRes.data || []) as { id: number }[]).map((p) => p.id));
      if (coRes.status) setCheckoutChain((coRes.data || []) as FacilityApprovalChainStep[]);
    }).finally(() => setLoading(false));
  }, [editing, id]);

  // ----- helpers for the inline check-in chain editor -----
  function chainPatch(idx: number, patch: Partial<FacilityApprovalChainStep>) {
    setChain((arr) => arr.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function chainMove(idx: number, delta: -1 | 1) {
    setChain((arr) => {
      const target = idx + delta;
      if (target < 0 || target >= arr.length) return arr;
      const copy = arr.slice();
      [copy[idx], copy[target]] = [copy[target], copy[idx]];
      return copy.map((r, i) => ({ ...r, step_order: i + 1 }));
    });
  }
  function chainDelete(idx: number) {
    setChain((arr) => arr.filter((_, i) => i !== idx).map((r, i) => ({ ...r, step_order: i + 1 })));
  }
  function chainAdd() {
    setChain((arr) => [...arr, {
      step_order: arr.length + 1,
      approver_kind: 'dynamic_dept_manager',
      approver_user_id: null,
    }]);
  }

  // ----- operating hours helpers -----
  function patchHour(idx: number, patch: Partial<OperatingHour>) {
    setHours((arr) => arr.map((h, i) => (i === idx ? { ...h, ...patch } : h)));
  }
  function toggleDay(day: number, on: boolean) {
    setHours((arr) => {
      const others = arr.filter((h) => h.day_of_week !== day);
      if (on) return [
        ...others,
        { day_of_week: day, open_time: '09:00', close_time: '19:00', slot_minutes: 30 },
      ].sort((a, b) => a.day_of_week - b.day_of_week);
      return others;
    });
  }

  // Validate chain rows before save (any 'user' row needs an approver id).
  function chainValidationError(rows: FacilityApprovalChainStep[], label: string): string | null {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.approver_kind === 'user' && !r.approver_user_id) {
        return `${label} step ${i + 1}: pick an approver or change the type to "Booker's department manager"`;
      }
    }
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (form.requires_approval && chain.length === 0) {
      setError('"Requires approval" is on but the check-in chain is empty. Add at least one step.');
      return;
    }
    if (form.requires_approval) {
      const ce = chainValidationError(chain, 'Check-in approval');
      if (ce) { setError(ce); return; }
    }
    const coe = chainValidationError(checkoutChain, 'Check-out approval');
    if (coe) { setError(coe); return; }

    const overlap = findSlotOverlap(slotOverrides);
    if (overlap) { setError(overlap); return; }
    for (const s of slotOverrides) {
      if (s.start_time >= s.end_time) {
        setError(`A slot has start ≥ end (${s.start_time} ≥ ${s.end_time}).`); return;
      }
      if (s.max_attendees < s.min_attendees) {
        setError(`Max (${s.max_attendees}) must be ≥ Min (${s.min_attendees}).`); return;
      }
    }

    setSaving(true);
    try {
      let facId: number;
      if (editing) {
        await facilitiesApi.update(Number(id), form);
        facId = Number(id);
      } else {
        const r = await facilitiesApi.create(form);
        facId = (r.data as { id?: number })?.id || 0;
      }
      if (!facId) throw new Error('Facility id missing after save');

      // Always persist hours.
      await facilitiesApi.replaceHours(facId, hours);

      // Check-in chain: only meaningful when requires_approval is on. When
      // it's off, persist an empty chain so any stale steps go away.
      const checkinSteps = form.requires_approval
        ? chain.map((r) => ({
            approver_kind: r.approver_kind,
            approver_user_id: r.approver_kind === 'user' ? r.approver_user_id || null : null,
          }))
        : [];
      await facilitiesApi.replaceChain(facId, checkinSteps, 'checkin');

      // Check-out chain (always persisted; empty means "no checkout approval").
      await facilitiesApi.replaceChain(
        facId,
        checkoutChain.map((r) => ({
          approver_kind: r.approver_kind,
          approver_user_id: r.approver_kind === 'user' ? r.approver_user_id || null : null,
        })),
        'checkout',
      );

      // F01 slot capacities + F06 pantries.
      await slotCapacitiesApi.replace(facId, slotOverrides);
      await facilityPantriesApi.replace(facId, pantryIds);

      navigate('/admin/facilities');
    } catch (err: unknown) {
      setError((err as { response?: { data?: { msg?: string } } })?.response?.data?.msg
        || (err as Error)?.message
        || 'Save failed');
    } finally { setSaving(false); }
  }

  if (loading) return <Box display="flex" justifyContent="center" p={5}><CircularProgress /></Box>;

  return (
    <Box maxWidth={860}>
      <PageHeader title={editing ? `Edit facility #${id}` : 'New facility'} back="/admin/facilities" />
      <Paper sx={{ p: 3 }}>
        <form onSubmit={submit}>
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField required label="Name" fullWidth value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <TextField select required label="Type" sx={{ width: 220 }} value={form.type || 'meeting_room'} onChange={(e) => setForm({ ...form, type: e.target.value as FacilityType })}>
                {TYPES.map((t) => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
              </TextField>
            </Stack>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField select required label="Site" fullWidth value={form.site_id ?? ''} onChange={(e) => setForm({ ...form, site_id: Number(e.target.value), floor_id: undefined })} disabled={!!editing}>
                {sites.map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
              </TextField>
              <TextField select label="Floor" sx={{ width: 340 }} value={form.floor_id ?? ''} onChange={(e) => setForm({ ...form, floor_id: e.target.value ? Number(e.target.value) : null })}>
                <MenuItem value="">-</MenuItem>
                {floors.map((f) => <MenuItem key={f.id} value={f.id}>{f.name}</MenuItem>)}
              </TextField>
              <TextField type="text" inputMode="numeric" label="Capacity" sx={{ width: 240 }} value={form.capacity ?? 0} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} />
            </Stack>
            <TextField label="Description" multiline minRows={2} fullWidth value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <TextField label="Image URL" fullWidth value={form.image_url || ''} onChange={(e) => setForm({ ...form, image_url: e.target.value })} />
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }} flexWrap="wrap">
              <FormControlLabel control={<Switch checked={!!form.requires_approval} onChange={(e) => setForm({ ...form, requires_approval: e.target.checked ? 1 : 0 })} />} label="Requires approval" />
              <FormControlLabel
                control={<Switch checked={!!form.shared_booking} onChange={(e) => setForm({ ...form, shared_booking: e.target.checked ? 1 : 0 })} />}
                label={<>Shared booking <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>(multiple bookings up to capacity)</Typography></>}
              />
              <TextField select label="Status" sx={{ width: 180 }} value={form.status ?? 1} onChange={(e) => setForm({ ...form, status: Number(e.target.value) as 0 | 1 })}>
                <MenuItem value={1}>Active</MenuItem>
                <MenuItem value={0}>Inactive</MenuItem>
              </TextField>
            </Stack>

            <Divider />

            {/* --------- Check-in approval (visible only when Requires approval is on) --------- */}
            {form.requires_approval ? (
              <>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Check-in approval</Typography>
                <Typography variant="caption" color="text.secondary">
                  Each booking for this facility is routed through these approvers in order
                  <b> before</b> it's confirmed. The first step is usually the booker's department
                  manager; add more steps for facility owners or other reviewers. Approvers
                  receive an email with a sign-in link.
                </Typography>

                <Stack spacing={1}>
                  {chain.length === 0 && (
                    <Alert severity="info">No steps yet. Add at least one.</Alert>
                  )}
                  {chain.map((row, idx) => (
                    <Paper key={idx} variant="outlined" sx={{ p: 1.5 }}>
                      <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} spacing={1}>
                        <Chip label={`Step ${idx + 1}`} size="small" color="primary" sx={{ width: 70 }} />
                        <TextField
                          select size="small" label="Type" sx={{ minWidth: 240 }}
                          value={row.approver_kind}
                          onChange={(e) => chainPatch(idx, {
                            approver_kind: e.target.value as 'user' | 'dynamic_dept_manager',
                            approver_user_id: e.target.value === 'user' ? row.approver_user_id : null,
                          })}
                        >
                          <MenuItem value="dynamic_dept_manager">Booker's department manager</MenuItem>
                          <MenuItem value="user">Specific user</MenuItem>
                        </TextField>
                        {row.approver_kind === 'user' && (
                          <TextField
                            select size="small" label="Approver" sx={{ flex: 1, minWidth: 240 }}
                            value={row.approver_user_id ?? ''}
                            onChange={(e) => chainPatch(idx, { approver_user_id: e.target.value ? Number(e.target.value) : null })}
                          >
                            <MenuItem value="">- pick one -</MenuItem>
                            {approvers.map((u) => (
                              <MenuItem key={u.id} value={u.id}>{approverLabel(u)}</MenuItem>
                            ))}
                          </TextField>
                        )}
                        {row.approver_kind === 'dynamic_dept_manager' && (
                          <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 240 }}>
                            Resolved per booking from the booker's department.
                            Falls back to any tenant admin if unavailable.
                          </Typography>
                        )}
                        <Stack direction="row" spacing={0.5}>
                          <IconButton size="small" disabled={idx === 0} onClick={() => chainMove(idx, -1)} aria-label="Move up">
                            <ArrowUpwardIcon fontSize="small" />
                          </IconButton>
                          <IconButton size="small" disabled={idx === chain.length - 1} onClick={() => chainMove(idx, 1)} aria-label="Move down">
                            <ArrowDownwardIcon fontSize="small" />
                          </IconButton>
                          <IconButton size="small" color="error" onClick={() => chainDelete(idx)} aria-label="Delete">
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Stack>
                      </Stack>
                    </Paper>
                  ))}
                  <Box>
                    <Button startIcon={<AddIcon />} onClick={chainAdd} size="small">
                      Add step
                    </Button>
                  </Box>
                </Stack>

                <Divider />
              </>
            ) : null}

            {/* --------- Check-out approval (always available) --------- */}
            <Box>
              <CheckoutChainEditor
                value={checkoutChain}
                onChange={setCheckoutChain}
                approvers={approvers}
              />
            </Box>

            <Divider />

            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Operating hours</Typography>
            <Typography variant="caption" color="text.secondary">Toggle a day to open it; set open / close times and slot length (minutes).</Typography>
            <Stack spacing={1}>
              {DAYS.map((label, day) => {
                const row = hours.find((h) => h.day_of_week === day);
                return (
                  <Stack key={day} direction="row" alignItems="center" spacing={2}>
                    <FormControlLabel
                      sx={{ minWidth: 90 }}
                      control={<Switch checked={!!row} onChange={(e) => toggleDay(day, e.target.checked)} />}
                      label={label}
                    />
                    {row && (
                      <>
                        <TextField size="small" type="time" label="Open"  InputLabelProps={{ shrink: true }} value={row.open_time}  onChange={(e) => patchHour(hours.indexOf(row), { open_time: e.target.value })} />
                        <TextField size="small" type="time" label="Close" InputLabelProps={{ shrink: true }} value={row.close_time} onChange={(e) => patchHour(hours.indexOf(row), { close_time: e.target.value })} />
                        <TextField size="small" type="number" label="Slot (min)" sx={{ width: 120 }} value={row.slot_minutes} onChange={(e) => patchHour(hours.indexOf(row), { slot_minutes: Number(e.target.value) })} />
                      </>
                    )}
                  </Stack>
                );
              })}
            </Stack>

            {/* F01 - Per-slot capacity overrides (controlled). */}
            <Box>
              <SlotCapacitiesEditor
                value={slotOverrides}
                onChange={setSlotOverrides}
                defaultCapacity={form.capacity || 0}
              />
            </Box>

            {/* F06 - Linked pantries (controlled). */}
            <Box>
              <FacilityPantriesPicker
                value={pantryIds}
                onChange={setPantryIds}
                siteId={form.site_id}
              />
            </Box>

            {error && <Alert severity="error">{error}</Alert>}
            <Stack direction="row" justifyContent="flex-end" spacing={1}>
              <Button onClick={() => navigate('/admin/facilities')}>Cancel</Button>
              <Button type="submit" variant="contained" disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
            </Stack>
          </Stack>
        </form>
      </Paper>
    </Box>
  );
}
