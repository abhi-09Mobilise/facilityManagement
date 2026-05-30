import { useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import PageSpinner from '@/components/PageSpinner';
import {
  Alert, Box, Button, Chip, CircularProgress, Divider, FormControlLabel, IconButton,
  MenuItem, Paper, Stack, Switch, TextField, Typography,
} from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import PhotoCameraOutlinedIcon from '@mui/icons-material/PhotoCameraOutlined';
import { useNavigate, useParams } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import { facilitiesApi } from '@/api/facilities.api';
import { uploadsApi } from '@/api/uploads.api';
import { sitesApi } from '@/api/sites.api';
import { floorsApi } from '@/api/floors.api';
import { usersApi } from '@/api/users.api';
import { departmentsApi } from '@/api/departments.api';
import { slotCapacitiesApi, type SlotOverride } from '@/api/slotCapacities.api';
import { facilityPantriesApi } from '@/api/pantries.api';
import type {
  ApproverOption, Department, Facility, FacilityApprovalChainStep, FacilityLayout,
  FacilityType, Floor, OperatingHour, Site,
} from '@/types';
import { findSlotOverlap } from './components/SlotCapacitiesEditor';
import FacilityPantriesPicker from './components/FacilityPantriesPicker';
import ApprovalChainEditor from './components/ApprovalChainEditor';
// Lazy — 1479-line canvas component, only ships when the admin opens a
// desk/meeting-room facility's layout editor.
const DeskLayoutEditor = lazy(() => import('./components/DeskLayoutEditor'));

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

function defaultCheckinChain(): FacilityApprovalChainStep[] {
  return [{ step_order: 1, approver_kind: 'dynamic_dept_manager', approver_user_id: null }];
}

function approverLabel(u: ApproverOption): string {
  const name = [u.name, u.lname].filter(Boolean).join(' ');
  const display = name || u.username;
  return u.designation ? `${display} - ${u.designation}` : display;
}

// Parse layout_json that may arrive as string or already-parsed object.
function parseLayout(raw: unknown): FacilityLayout | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as FacilityLayout; } catch { return null; }
  }
  return raw as FacilityLayout;
}

export default function FacilityFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const editing = id && id !== 'new';

  const [form, setForm] = useState<Partial<Facility>>({
    type: 'meeting_room', capacity: 0, requires_approval: 0, status: 1,
  });
  const [hours, setHours] = useState<OperatingHour[]>(defaultHours());
  const [chain, setChain] = useState<FacilityApprovalChainStep[]>(defaultCheckinChain());
  const [checkoutChain, setCheckoutChain] = useState<FacilityApprovalChainStep[]>([]);
  // F09 - facility notification recipients (stage='notification' rows).
  // Doesn't gate approval; just emails these people on approve / cancel.
  const [notificationChain, setNotificationChain] = useState<FacilityApprovalChainStep[]>([]);
  // Pre-end cleanup notification recipients (stage='cleanup'). Fires N
  // minutes before booking ends to alert cleaning / maintenance staff.
  // Lead time lives on form.pre_end_notify_minutes.
  const [cleanupChain, setCleanupChain] = useState<FacilityApprovalChainStep[]>([]);
  const [slotOverrides, setSlotOverrides] = useState<SlotOverride[]>([]);
  const [pantryIds, setPantryIds] = useState<number[]>([]);
  const [layout, setLayout] = useState<FacilityLayout | null>(null); // F09

  const [sites, setSites] = useState<Site[]>([]);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [approvers, setApprovers] = useState<ApproverOption[]>([]);
  // Local per-step state: which department the admin filtered by for each
  // "Specific user" row in the check-in chain (independent of the
  // CheckoutChainEditor's own internal state).
  const [chainDeptByIdx, setChainDeptByIdx] = useState<Record<number, number | ''>>({});

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cover image upload (the facility's hero photo on the booker's bento
  // card). Now uploaded to Azure Blob via /api/uploads/image; the returned
  // absolute URL is what we store on facilities.image_url. No more base64
  // data URLs bloating the row.
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  async function handleImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      alert('Image is bigger than 10 MB — please compress it first.');
      e.target.value = '';
      return;
    }
    setImageUploading(true);
    try {
      const r = await uploadsApi.image(file, 'facility-images');
      if (!r.status || !r.data) {
        alert('Upload failed: ' + (r.msg || 'unknown error'));
        return;
      }
      setForm((f) => ({ ...f, image_url: r.data!.url }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      alert('Upload failed: ' + msg);
    } finally {
      setImageUploading(false);
      // Reset the input so re-selecting the same file still fires onChange.
      e.target.value = '';
    }
  }

  useEffect(() => {
    sitesApi.list({ limit: 100 }).then((r) => setSites(r.data?.data || []));
  }, []);

  // Floors + departments + approvers all cascade off the chosen Site. When
  // there's no site yet (a brand new facility), wipe the dependent lists so
  // the dept dropdown is empty rather than showing tenant-wide noise.
  useEffect(() => {
    if (form.site_id) {
      floorsApi.list({ site_id: form.site_id }).then((r) => setFloors((r.data as Floor[]) || []));
      departmentsApi.list({ site_id: form.site_id }).then((r) => setDepartments((r.data as Department[]) || []));
      usersApi.approvers({ site_id: form.site_id }).then((r) => setApprovers((r.data as ApproverOption[]) || []));
    } else {
      setFloors([]);
      setDepartments([]);
      setApprovers([]);
    }
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
      facilitiesApi.getChain(facId, 'notification').catch(() => ({ status: false, data: [] as FacilityApprovalChainStep[] })),
      facilitiesApi.getChain(facId, 'cleanup').catch(() => ({ status: false, data: [] as FacilityApprovalChainStep[] })),
    ]).then(([fRes, soRes, fpRes, coRes, noRes, clRes]) => {
      if (fRes.data) {
        setForm(fRes.data);
        setHours((fRes.data.operating_hours && fRes.data.operating_hours.length > 0)
          ? fRes.data.operating_hours : defaultHours());
        setChain((fRes.data.approval_chain && fRes.data.approval_chain.length > 0)
          ? fRes.data.approval_chain
          : defaultCheckinChain());
        setLayout(parseLayout(fRes.data.layout_json));
      }
      if (soRes.status) setSlotOverrides((soRes.data || []) as SlotOverride[]);
      if (fpRes.status) setPantryIds(((fpRes.data || []) as { id: number }[]).map((p) => p.id));
      if (coRes.status) setCheckoutChain((coRes.data || []) as FacilityApprovalChainStep[]);
      if (noRes.status) setNotificationChain((noRes.data || []) as FacilityApprovalChainStep[]);
      if (clRes.status) setCleanupChain((clRes.data || []) as FacilityApprovalChainStep[]);
    }).finally(() => setLoading(false));
  }, [editing, id]);

  // ----- inline check-in chain helpers -----
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
      step_order: arr.length + 1, approver_kind: 'dynamic_dept_manager', approver_user_id: null,
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
    // Also drop any per-slot overrides for the day being turned off.
    if (!on) setSlotOverrides((s) => s.filter((o) => o.day_of_week !== day));
  }

  // ----- per-day slot helpers (F01 inlined under operating hours) -----
  function addSlotForDay(day: number) {
    setSlotOverrides((s) => [
      ...s,
      { day_of_week: day, start_time: '09:00', end_time: '12:00', min_attendees: 1, max_attendees: form.capacity || 1, status: 1 },
    ]);
  }
  function patchSlot(globalIdx: number, p: Partial<SlotOverride>) {
    setSlotOverrides((s) => s.map((row, i) => (i === globalIdx ? { ...row, ...p } : row)));
  }
  function deleteSlot(globalIdx: number) {
    setSlotOverrides((s) => s.filter((_, i) => i !== globalIdx));
  }

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
      // Check-out chain is only validated when approval is on - the editor
      // is hidden otherwise and the steps are blanked on save.
      const coe = chainValidationError(checkoutChain, 'Check-out approval');
      if (coe) { setError(coe); return; }
    }

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
    // F09 - for desk facilities, the layout is what gives them capacity.
    // Reject saves where no chair was placed so the facility isn't bookable
    // by no-one.
    if (form.type === 'desk') {
      const chairs = layout ? (layout.objects || []).filter((o) => o.type === 'chair').length : 0;
      if (chairs === 0) {
        setError('Add at least one chair to the floor plan — the chair count is this facility\'s capacity.');
        return;
      }
    }

    setSaving(true);
    try {
      // Build the facility payload, including layout_json only when there
      // actually IS one to send (avoids clobbering on non-desk types).
      const facBody: Partial<Facility> = { ...form };
      // F09 - layout JSON is only relevant to desk facilities now. Changing
      // type away from desk nulls the column so we don't leave stale
      // geometry attached to a non-desk facility.
      const hasCanvas = form.type === 'desk';
      if (hasCanvas && layout) {
        // Strip _fromScan flag from saved JSON: it's a UI-only marker for
        // the "Undo last scan" button and has no meaning on the backend.
        const cleaned = {
          ...layout,
          objects: (layout.objects || []).map((o) => {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { _fromScan, ...rest } = o;
            return rest;
          }),
        };
        facBody.layout_json = JSON.stringify(cleaned);
        // Capacity is *derived* from chair count for desks - source of
        // truth is the canvas. Saving the count straight from the layout
        // protects against the user form being out of sync.
        facBody.capacity = (cleaned.objects || []).filter((o) => o.type === 'chair').length;
      } else if (!hasCanvas) {
        facBody.layout_json = null;
      }

      let facId: number;
      if (editing) {
        await facilitiesApi.update(Number(id), facBody);
        facId = Number(id);
      } else {
        const r = await facilitiesApi.create(facBody);
        facId = (r.data as { id?: number })?.id || 0;
      }
      if (!facId) throw new Error('Facility id missing after save');

      await facilitiesApi.replaceHours(facId, hours);
      const checkinSteps = form.requires_approval
        ? chain.map((r) => ({
            approver_kind: r.approver_kind,
            approver_user_id: r.approver_kind === 'user' ? r.approver_user_id || null : null,
          }))
        : [];
      await facilitiesApi.replaceChain(facId, checkinSteps, 'checkin');
      // Check-out notification follows the same on/off toggle - we wipe it
      // when approval is disabled so a facility can't carry stale post-use
      // recipients from a previous configuration.
      const checkoutSteps = form.requires_approval
        ? checkoutChain.map((r) => ({
            approver_kind: r.approver_kind,
            approver_user_id: r.approver_kind === 'user' ? r.approver_user_id || null : null,
          }))
        : [];
      await facilitiesApi.replaceChain(facId, checkoutSteps, 'checkout');

      // F09 - facility notification chain is independent of the approval
      // toggle (FYI emails fire even on auto-approved bookings).
      const notificationSteps = notificationChain.map((r) => ({
        approver_kind: r.approver_kind,
        approver_user_id: r.approver_kind === 'user' ? r.approver_user_id || null : null,
      }));
      await facilitiesApi.replaceChain(facId, notificationSteps, 'notification');

      // Cleanup chain: pre-end notification recipients. Independent from
      // approval — fires N min before end_at to whoever is listed here.
      const cleanupSteps = cleanupChain.map((r) => ({
        approver_kind: r.approver_kind,
        approver_user_id: r.approver_kind === 'user' ? r.approver_user_id || null : null,
      }));
      await facilitiesApi.replaceChain(facId, cleanupSteps, 'cleanup');
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

  // Only desk facilities use the floor-plan canvas. Meeting rooms now ask
  // for a plain Capacity number like other facility types.
  const hasLayoutCanvas = form.type === 'desk';
  // Pass the selected floor's image down as a background fallback so the
  // editor opens with the floor plan even before the admin uploads
  // anything facility-specific.
  const selectedFloor = floors.find((f) => f.id === form.floor_id) || null;
  const floorImageUrl = selectedFloor?.layout_image_url || null;

  return (
    <Box maxWidth={960}>
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
              {form.type === 'desk' ? (
                // Desk capacity is derived from the chairs placed on the
                // floor plan below, so we show a read-only summary instead
                // of asking the admin to maintain it by hand.
                <TextField
                  label="Capacity"
                  helperText="= chairs placed on the floor plan"
                  value={form.capacity ?? 0}
                  InputProps={{ readOnly: true }}
                  sx={{ width: 200 }}
                />
              ) : (
                <TextField type="text" inputMode="numeric" label="Capacity" sx={{ width: 200 }} value={form.capacity ?? 0} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} />
              )}
              {/* Offline seats - held back from the booking system. Clamp
                  to [0, capacity] live so the helper text always reads
                  the correct "Online (bookable)" count. */}
              <TextField
                type="number"
                label="Offline seats"
                sx={{ width: 200 }}
                value={form.offline_capacity ?? 0}
                onChange={(e) => {
                  const cap = form.capacity || 0;
                  const v = Math.max(0, Math.min(cap, Number(e.target.value || 0)));
                  setForm({ ...form, offline_capacity: v });
                }}
                inputProps={{ min: 0, max: form.capacity || 0 }}
                helperText={
                  `Online (bookable): ${Math.max(0, (form.capacity || 0) - (form.offline_capacity || 0))}`
                }
              />
            </Stack>
            <TextField label="Description" multiline minRows={2} fullWidth value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />

            {/* Cover image upload. Shown as a thumbnail when set, with Replace/
                Remove actions. Stored as a base64 data URL on
                facilities.image_url; the booker's bento landing page uses
                this as the card photo. Max ~1.5 MB to avoid bloating the
                row size. */}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'flex-start' }}>
              <Box>
                <Typography variant="caption" color="text.secondary">Cover image</Typography>
                <Box
                  sx={{
                    mt: 0.5,
                    width: 200, height: 120,
                    borderRadius: 1.5,
                    border: '1px dashed',
                    borderColor: form.image_url ? 'transparent' : 'divider',
                    bgcolor: form.image_url ? 'transparent' : 'action.hover',
                    overflow: 'hidden',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {form.image_url ? (
                    <img
                      src={form.image_url}
                      alt="Facility cover"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <Stack alignItems="center" spacing={0.5}>
                      <PhotoCameraOutlinedIcon sx={{ color: 'text.secondary', fontSize: 28 }} />
                      <Typography variant="caption" color="text.secondary">No image</Typography>
                    </Stack>
                  )}
                </Box>
              </Box>
              <Stack spacing={1} sx={{ pt: { sm: 2.5 } }}>
                <input
                  ref={imageInputRef}
                  type="file" accept="image/*"
                  style={{ display: 'none' }}
                  onChange={handleImageFile}
                />
                <Button
                  type="button"
                  variant="outlined"
                  size="small"
                  disabled={imageUploading}
                  startIcon={imageUploading
                    ? <CircularProgress size={14} />
                    : <PhotoCameraOutlinedIcon />}
                  onClick={() => imageInputRef.current?.click()}
                >
                  {imageUploading
                    ? 'Uploading…'
                    : (form.image_url ? 'Replace image' : 'Upload image')}
                </Button>
                {form.image_url && (
                  <Button
                    type="button"
                    variant="text"
                    size="small"
                    color="error"
                    startIcon={<DeleteIcon />}
                    onClick={() => setForm({ ...form, image_url: '' })}
                  >
                    Remove image
                  </Button>
                )}
                <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 260 }}>
                  Used as the card photo on the booker's facility landing page.
                  JPEG or PNG up to ~1.5 MB. A clean wide-aspect shot of the
                  room looks best.
                </Typography>
              </Stack>
            </Stack>

            {/* --------- F09: Floor-plan canvas (desk facilities only) --------- */}
            {hasLayoutCanvas && (
              <Box>
                <Suspense fallback={<PageSpinner label="Loading layout editor…" />}>
                <DeskLayoutEditor
                  value={layout}
                  onChange={(next) => {
                    setLayout(next);
                    // Derive capacity from the chair count on every change
                    // so the read-only Capacity field above stays in sync.
                    // Also clamp offline_capacity down if the capacity
                    // dropped below it (admin deleted chairs).
                    const chairCnt = (next.objects || []).filter((o) => o.type === 'chair').length;
                    setForm((f) => {
                      const off = Math.max(0, Math.min(chairCnt, f.offline_capacity || 0));
                      if (chairCnt === (f.capacity || 0) && off === (f.offline_capacity || 0)) return f;
                      return { ...f, capacity: chairCnt, offline_capacity: off };
                    });
                  }}
                  capacity={form.capacity || 0}
                  facilityType={form.type}
                  floorImageUrl={floorImageUrl}
                  facilityId={editing ? Number(id) : null}
                />
                </Suspense>
              </Box>
            )}

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

            {/* --------- Booking rules: lead time + per-user caps --------- */}
            {/* Each field is optional; blank = no limit. Super_admin and
                tenant_admin always bypass these rules on the backend. */}
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Booking rules</Typography>
              <Typography variant="caption" color="text.secondary">
                Leave blank for no limit. Admins (super / tenant) always bypass these.
                Week starts Monday. Cancelled bookings free their slot.
              </Typography>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mt: 1.5 }} flexWrap="wrap">
                <TextField
                  type="number"
                  label="Min advance (minutes)"
                  sx={{ width: 200 }}
                  value={form.min_advance_minutes ?? ''}
                  onChange={(e) => setForm({
                    ...form,
                    min_advance_minutes: e.target.value === '' ? null : Math.max(0, Number(e.target.value)),
                  })}
                  inputProps={{ min: 0 }}
                  helperText="Reject if start_at - now < N minutes"
                />
                <TextField
                  type="number"
                  label="Max advance (days)"
                  sx={{ width: 200 }}
                  value={form.max_advance_days ?? ''}
                  onChange={(e) => setForm({
                    ...form,
                    max_advance_days: e.target.value === '' ? null : Math.max(0, Number(e.target.value)),
                  })}
                  inputProps={{ min: 0 }}
                  helperText="Booker can't pick a date > N days ahead"
                />
              </Stack>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mt: 2 }} flexWrap="wrap">
                <TextField
                  type="number"
                  label="Max bookings / user / day"
                  sx={{ width: 220 }}
                  value={form.max_per_user_per_day ?? ''}
                  onChange={(e) => setForm({
                    ...form,
                    max_per_user_per_day: e.target.value === '' ? null : Math.max(0, Number(e.target.value)),
                  })}
                  inputProps={{ min: 0 }}
                />
                <TextField
                  type="number"
                  label="Max bookings / user / week"
                  sx={{ width: 220 }}
                  value={form.max_per_user_per_week ?? ''}
                  onChange={(e) => setForm({
                    ...form,
                    max_per_user_per_week: e.target.value === '' ? null : Math.max(0, Number(e.target.value)),
                  })}
                  inputProps={{ min: 0 }}
                  helperText="Mon 00:00 → next Mon 00:00"
                />
                <TextField
                  type="number"
                  label="Max bookings / user / month"
                  sx={{ width: 220 }}
                  value={form.max_per_user_per_month ?? ''}
                  onChange={(e) => setForm({
                    ...form,
                    max_per_user_per_month: e.target.value === '' ? null : Math.max(0, Number(e.target.value)),
                  })}
                  inputProps={{ min: 0 }}
                />
              </Stack>
            </Box>

            <Divider />


            {/* --------- Check-in approval + Check-out notification --------- */}
            {/* Both editors share the same ApprovalChainEditor component so
                the UX is consistent. The toggle gates both because a facility
                without an approval workflow has no reason to collect post-use
                sign-off either. */}
            {form.requires_approval ? (
              <>
                <Box>
                  <ApprovalChainEditor
                    title="Check-in approval"
                    subtitle="Approvers who must sign off before the booking is confirmed."
                    chipLabel="checkin"
                    chipClassName="chip"
                    addLabel="Add approver"
                    value={chain}
                    onChange={setChain}
                    approvers={approvers}
                    departments={departments}
                    emptyMessage="No approvers yet. Add at least one before saving."
                  />
                </Box>
                <Box>
                  <ApprovalChainEditor
                    title="Check-out notification"
                    subtitle="Notified after the booking ends (cleaning, returns, post-use sign-off)."
                    chipLabel="checkout"
                    chipClassName="chip-checkout"
                    addLabel="Add recipient"
                    value={checkoutChain}
                    onChange={setCheckoutChain}
                    approvers={approvers}
                    departments={departments}
                    emptyMessage="No check-out recipients configured."
                  />
                </Box>
                <Divider />
              </>
            ) : null}

            {/* --------- Facility notification (independent, FYI emails) --------- */}
            <Box>
              <ApprovalChainEditor
                title="Facility notification"
                subtitle="FYI emails sent to these recipients when a booking is approved or cancelled on this facility. Doesn't gate the booking flow."
                chipLabel="notify"
                chipClassName="chip"
                addLabel="Add recipient"
                value={notificationChain}
                onChange={setNotificationChain}
                approvers={approvers}
                departments={departments}
                emptyMessage="No notification recipients configured."
              />
            </Box>
            <Divider />

            {/* --------- Pre-end cleanup notification --------- */}
            <Box>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'flex-end' }} sx={{ mb: 1.5 }}>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    Pre-end cleanup notification
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    Fire an email to the recipients below N minutes before the booking ends —
                    useful for cleaning staff, maintenance teams, or anyone who needs a
                    heads-up. Leave the minutes blank to disable.
                  </Typography>
                </Box>
                <TextField
                  type="number"
                  label="Lead time (minutes)"
                  sx={{ width: 200 }}
                  value={form.pre_end_notify_minutes ?? ''}
                  onChange={(e) => setForm({
                    ...form,
                    pre_end_notify_minutes: e.target.value === '' ? null : Math.max(0, Number(e.target.value)),
                  })}
                  inputProps={{ min: 0 }}
                  helperText="e.g. 15 = email 15 min before end_at"
                />
              </Stack>
              <ApprovalChainEditor
                title="Cleanup recipients"
                subtitle="Specific users or department managers who get the pre-end email."
                chipLabel="cleanup"
                chipClassName="chip"
                addLabel="Add recipient"
                value={cleanupChain}
                onChange={setCleanupChain}
                approvers={approvers}
                departments={departments}
                emptyMessage="No cleanup recipients configured."
              />
            </Box>
            <Divider />

            {/* --------- Operating hours + inline per-day slot rows (F01) --------- */}
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Operating hours</Typography>
            <Typography variant="caption" color="text.secondary">
              Toggle a day to open it; set open / close times and slot length (minutes).
              Use "+ Add slot" to define a sub-window with its own min / max attendees.
            </Typography>
            <Stack spacing={1.5}>
              {DAYS.map((label, day) => {
                const row = hours.find((h) => h.day_of_week === day);
                const slotsForDay = slotOverrides
                  .map((o, idx) => ({ row: o, idx }))
                  .filter((s) => s.row.day_of_week === day);
                return (
                  <Paper key={day} variant="outlined" sx={{ p: 1.25 }}>
                    <Stack direction="row" alignItems="center" spacing={2} flexWrap="wrap">
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
                          <Button startIcon={<AddIcon />} size="small" onClick={() => addSlotForDay(day)} sx={{ ml: 'auto' }}>
                            Add slot
                          </Button>
                        </>
                      )}
                    </Stack>

                    {row && slotsForDay.length > 0 && (
                      <Stack spacing={0.75} sx={{ mt: 1.5, pl: { sm: 11 } }}>
                        {slotsForDay.map(({ row: s, idx }) => (
                          <Stack key={idx} direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
                            <Chip label="Slot" size="small" />
                            <TextField size="small" type="time" label="From" InputLabelProps={{ shrink: true }}
                              value={s.start_time.slice(0, 5)}
                              onChange={(e) => patchSlot(idx, { start_time: e.target.value })} />
                            <TextField size="small" type="time" label="To" InputLabelProps={{ shrink: true }}
                              value={s.end_time.slice(0, 5)}
                              onChange={(e) => patchSlot(idx, { end_time: e.target.value })} />
                            <TextField size="small" type="number" label="Min" sx={{ width: 100 }}
                              value={s.min_attendees}
                              onChange={(e) => patchSlot(idx, { min_attendees: Math.max(1, Number(e.target.value || 1)) })} />
                            <TextField size="small" type="number" label="Max" sx={{ width: 100 }}
                              value={s.max_attendees}
                              onChange={(e) => patchSlot(idx, { max_attendees: Math.max(1, Number(e.target.value || 1)) })} />
                            <IconButton size="small" color="error" onClick={() => deleteSlot(idx)} sx={{ ml: { sm: 'auto' } }}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Stack>
                        ))}
                      </Stack>
                    )}
                  </Paper>
                );
              })}
            </Stack>

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
//    o, idx) => ({ row: o, idx }))
//                   .filter((s) => s.row.day_of_week === day);
//                 return (
//                   <Paper key={day} variant="outlined" sx={{ p: 1.25 }}>
//                     <Stack direction="row" alignItems="center" spacing={2} flexWrap="wrap">
//                       <FormControlLabel
//                         sx={{ minWidth: 90 }}
//                         control={<Switch checked={!!row} onChange={(e) => toggleDay(day, e.target.checked)} />}
//                         label={label}
//                       />
//                       {row && (
//                         <>
//                           <TextField size="small" type="time" label="Open"  InputLabelProps={{ shrink: true }} value={row.open_time}  onChange={(e) => patchHour(hours.indexOf(row), { open_time: e.target.value })} />
//                           <TextField size="small" type="time" label="Close" InputLabelProps={{ shrink: true }} value={row.close_time} onChange={(e) => patchHour(hours.indexOf(row), { close_time: e.target.value })} />
//                           <TextField size="small" type="number" label="Slot (min)" sx={{ width: 120 }} value={row.slot_minutes} onChange={(e) => patchHour(hours.indexOf(row), { slot_minutes: Number(e.target.value) })} />
//                           <Button startIcon={<AddIcon />} size="small" onClick={() => addSlotForDay(day)} sx={{ ml: 'auto' }}>
//                             Add slot
//                           </Button>
//                         </>
//                       )}
//                     </Stack>

//                     {row && slotsForDay.length > 0 && (
//                       <Stack spacing={0.75} sx={{ mt: 1.5, pl: { sm: 11 } }}>
//                         {slotsForDay.map(({ row: s, idx }) => (
//                           <Stack key={idx} direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
//                             <Chip label="Slot" size="small" />
//                             <TextField size="small" type="time" label="From" InputLabelProps={{ shrink: true }}
//                               value={s.start_time.slice(0, 5)}
//                               onChange={(e) => patchSlot(idx, { start_time: e.target.value })} />
//                             <TextField size="small" type="time" label="To" InputLabelProps={{ shrink: true }}
//                               value={s.end_time.slice(0, 5)}
//                               onChange={(e) => patchSlot(idx, { end_time: e.target.value })} />
//                             <TextField size="small" type="number" label="Min" sx={{ width: 100 }}
//                               value={s.min_attendees}
//                               onChange={(e) => patchSlot(idx, { min_attendees: Math.max(1, Number(e.target.value || 1)) })} />
//                             <TextField size="small" type="number" label="Max" sx={{ width: 100 }}
//                               value={s.max_attendees}
//                               onChange={(e) => patchSlot(idx, { max_attendees: Math.max(1, Number(e.target.value || 1)) })} />
//                             <IconButton size="small" color="error" onClick={() => deleteSlot(idx)} sx={{ ml: { sm: 'auto' } }}>
//                               <DeleteIcon fontSize="small" />
//                             </IconButton>
//                           </Stack>
//                         ))}
//                       </Stack>
//                     )}
//                   </Paper>
//                 );
//               })}
//             </Stack>

//             <Box>
//               <FacilityPantriesPicker
//                 value={pantryIds}
//                 onChange={setPantryIds}
//                 siteId={form.site_id}
//               />
//             </Box>

//             {error && <Alert severity="error">{error}</Alert>}
//             <Stack direction="row" justifyContent="flex-end" spacing={1}>
//               <Button onClick={() => navigate('/admin/facilities')}>Cancel</Button>
//               <Button type="submit" variant="contained" disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
//             </Stack>
//           </Stack>
//         </form>
//       </Paper>
//     </Box>
//   );
// }
// umber(e.target.value) })} />
//                           <Button startIcon={<AddIcon />} size="small" onClick={() => addSlotForDay(day)} sx={{ ml: 'auto' }}>
//                             Add slot
//                           </Button>
//                         </>
//                       )}
//                     </Stack>

//                     {row && slotsForDay.length > 0 && (
//                       <Stack spacing={0.75} sx={{ mt: 1.5, pl: { sm: 11 } }}>
//                         {slotsForDay.map(({ row: s, idx }) => (
//                           <Stack key={idx} direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
//                             <Chip label="Slot" size="small" />
//                             <TextField size="small" type="time" label="From" InputLabelProps={{ shrink: true }}
//                               value={s.start_time.slice(0, 5)}
//                               onChange={(e) => patchSlot(idx, { start_time: e.target.value })} />
//                             <TextField size="small" type="time" label="To" InputLabelProps={{ shrink: true }}
//                               value={s.end_time.slice(0, 5)}
//                               onChange={(e) => patchSlot(idx, { end_time: e.target.value })} />
//                             <TextField size="small" type="number" label="Min" sx={{ width: 100 }}
//                               value={s.min_attendees}
//                               onChange={(e) => patchSlot(idx, { min_attendees: Math.max(1, Number(e.target.value || 1)) })} />
//                             <TextField size="small" type="number" label="Max" sx={{ width: 100 }}
//                               value={s.max_attendees}
//                               onChange={(e) => patchSlot(idx, { max_attendees: Math.max(1, Number(e.target.value || 1)) })} />
//                             <IconButton size="small" color="error" onClick={() => deleteSlot(idx)} sx={{ ml: { sm: 'auto' } }}>
//                               <DeleteIcon fontSize="small" />
//                             </IconButton>
//                           </Stack>
//                         ))}
//                       </Stack>
//                     )}
//                   </Paper>
//                 );
//               })}
//             </Stack>

//             <Box>
//               <FacilityPantriesPicker
//     