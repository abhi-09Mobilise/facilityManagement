// Admin facilities list.
//
// UX (unified with the other master pages):
//   - Header: filter icon + Download Excel + "New facility" button.
//   - Filter popover holds Search, Site and Type.
//   - Row status is a live Active / Inactive Switch.
//   - Refresh handler is exposed to the navbar via useRegisterRefresh.

import { useEffect, useMemo, useState } from 'react';
import {
  Box, Button, Chip, CircularProgress, MenuItem, Stack, Switch, TextField, Typography,
} from '@mui/material';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import * as XLSX from 'xlsx';
import type { GridColDef } from '@mui/x-data-grid';
import { useLocation, useNavigate } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import CrudTable from '@/components/CrudTable';
import FilterPopover from '@/components/FilterPopover';
import { facilitiesApi } from '@/api/facilities.api';
import { sitesApi } from '@/api/sites.api';
import { buildingsApi } from '@/api/buildings.api';
import { useMastersFilterOptional } from '@/contexts/MastersFilterContext';
import { useTenantScope } from '@/context/TenantScopeContext';
import { useRegisterRefresh } from '@/context/RefreshContext';
import type { Building, Facility, FacilityType, Site } from '@/types';

const TYPE_LABEL: Record<FacilityType, string> = {
  meeting_room:    'Meeting room',
  gym:             'Gym',
  conference_room: 'Conference room',
  desk:            'Desk',
  swimming_pool:   'Swimming pool',
  other:           'Other',
};

const TYPE_ORDER: FacilityType[] = [
  'meeting_room', 'conference_room', 'gym', 'desk', 'swimming_pool', 'other',
];

type FacilityRow = Facility & { _sno: number };

export default function FacilitiesListPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const inMasters = location.pathname.startsWith('/admin/masters/');
  const mastersFilter = useMastersFilterOptional();
  const scope = useTenantScope();

  const [rows, setRows] = useState<Facility[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [siteId, setSiteId] = useState<number | ''>('');
  const [type, setType] = useState<'' | FacilityType>('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Draft filter state, applied only on the popover's Apply.
  const [draftQ, setDraftQ] = useState('');
  const [draftSiteId, setDraftSiteId] = useState<number | ''>('');
  const [draftBuildingId, setDraftBuildingId] = useState<number | ''>('');
  const [draftType, setDraftType] = useState<'' | FacilityType>('');
  const [buildings, setBuildings] = useState<Building[]>([]);

  async function exportToExcel() {
    setExporting(true);
    try {
      const r = await facilitiesApi.list({ page: 1, limit: 5000, q });
      const raw = ((r as unknown) as { data?: { data?: Facility[] } })?.data?.data || [];
      const rowsX = raw.map((f: Facility) => ({
        Name: f.name || '',
        Type: f.type || '',
        Site: f.site_name || '',
        Floor: f.floor_name || '',
        Capacity: f.capacity ?? 0,
        'Offline seats': f.offline_capacity ?? 0,
        'Requires approval': f.requires_approval ? 'Yes' : 'No',
        Status: f.status ? 'Active' : 'Inactive',
        Description: f.description || '',
      }));
      const ws = XLSX.utils.json_to_sheet(rowsX);
      const colWidths = Object.keys(rowsX[0] || {}).map((k) => ({
        wch: Math.max(k.length + 2, 18),
      }));
      ws['!cols'] = colWidths;
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Facilities');
      const stamp = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `facilities-${stamp}.xlsx`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      alert('Export failed: ' + msg);
    } finally {
      setExporting(false);
    }
  }

  async function load() {
    setLoading(true);
    try {
      const effectiveSiteId     = inMasters ? mastersFilter.siteId     : (siteId || '');
      const effectiveBuildingId = inMasters ? mastersFilter.buildingId : null;
      const params: Record<string, unknown> = {
        page, limit: pageSize, site_id: effectiveSiteId, type, q,
      };
      // Tenant + Organisation come from the navbar TenantScope so every
      // masters page sees the same slice of data.
      if (scope.tenantId !== null)       params.tenant_id       = scope.tenantId;
      if (scope.organisationId !== null) params.organisation_id = scope.organisationId;
      if (effectiveBuildingId) params.building_id = effectiveBuildingId;
      const r = await facilitiesApi.list(params);
      setRows(r.data?.data || []);
      setTotal(r.data?.total || 0);
    } finally {
      setLoading(false);
    }
  }

  // Sites in the popover picker are scoped to the navbar tenant + org.
  useEffect(() => {
    const params: Record<string, unknown> = { limit: 100 };
    if (scope.tenantId !== null)       params.tenant_id       = scope.tenantId;
    if (scope.organisationId !== null) params.organisation_id = scope.organisationId;
    sitesApi.list(params).then((r) => setSites(r.data?.data || []));
  }, [scope.tenantId, scope.organisationId]);

  // Buildings for the popover under masters mode - scoped to draft site.
  useEffect(() => {
    if (!inMasters) return;
    if (!draftSiteId) { setBuildings([]); return; }
    buildingsApi.list({ site_id: draftSiteId, limit: 200 })
      .then((r) => setBuildings((r.data?.data as Building[]) || []))
      .catch(() => setBuildings([]));
  }, [inMasters, draftSiteId]);

  useEffect(() => {
    load();
    /* eslint-disable-next-line */
  }, [
    page, pageSize, siteId, type, q, inMasters,
    mastersFilter.siteId, mastersFilter.buildingId,
    scope.tenantId, scope.organisationId,
  ]);

  useRegisterRefresh(load);

  const activeFilterCount = inMasters
    ? (q ? 1 : 0) + (mastersFilter.siteId ? 1 : 0) + (mastersFilter.buildingId ? 1 : 0) + (type ? 1 : 0)
    : (q ? 1 : 0) + (siteId !== '' ? 1 : 0) + (type ? 1 : 0);

  const [savingId, setSavingId] = useState<number | null>(null);
  async function toggleStatus(row: Facility, on: boolean) {
    const next: 0 | 1 = on ? 1 : 0;
    if (row.status === next) return;
    setSavingId(row.id);
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, status: next } : r)));
    try {
      await facilitiesApi.update(row.id, { status: next });
    } catch (err) {
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, status: row.status } : r)));
      const msg = (err as { response?: { data?: { msg?: string } } })?.response?.data?.msg
        || (err as Error)?.message || 'Failed to update status';
      alert(msg);
    } finally {
      setSavingId(null);
    }
  }

  const displayRows: FacilityRow[] = useMemo(
    () => rows.map((r, i) => ({ ...r, _sno: (page - 1) * pageSize + i + 1 })),
    [rows, page, pageSize],
  );

  const columns: GridColDef<FacilityRow>[] = [
    { field: '_sno', headerName: 'S.No', width: 80, sortable: false, filterable: false },
    { field: 'name', headerName: 'Name', flex: 1, minWidth: 160 },
    {
      field: 'type', headerName: 'Type', width: 140,
      valueGetter: (_v, row) => TYPE_LABEL[row.type as FacilityType] || row.type,
    },
    { field: 'site_name', headerName: 'Site', width: 150 },
    { field: 'floor_name', headerName: 'Floor', width: 130 },
    { field: 'capacity', headerName: 'Capacity', width: 90 },
    {
      field: 'requires_approval', headerName: 'Approval', width: 110,
      renderCell: (p) => p.row.requires_approval
        ? <Chip size="small" color="warning" label="required" />
        : <Chip size="small" label="auto" />,
    },
    {
      field: 'status', headerName: 'Status', width: 140, sortable: false,
      renderCell: (p) => {
        const isActive = p.row.status === 1;
        return (
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <Switch
              size="small"
              checked={isActive}
              disabled={savingId === p.row.id}
              onChange={(_e, on) => toggleStatus(p.row, on)}
              onClick={(e) => e.stopPropagation()}
            />
            <Typography
              variant="caption"
              sx={{ color: isActive ? 'success.main' : 'text.secondary', fontWeight: 500 }}
            >
              {isActive ? 'Active' : 'Inactive'}
            </Typography>
          </Stack>
        );
      },
    },
  ];

  const editBase = inMasters ? '/admin/masters/facilities' : '/admin/facilities';

  return (
    <Box>
      <PageHeader
        title="Facilities"
        subtitle="Bookable rooms, gyms, desks"
        addLabel="New facility"
        onAdd={() => navigate(`${editBase}/new`)}
      >
        <FilterPopover
          count={activeFilterCount}
          onOpen={() => {
            setDraftQ(q);
            setDraftType(type);
            if (inMasters) {
              setDraftSiteId(mastersFilter.siteId ?? '');
              setDraftBuildingId(mastersFilter.buildingId ?? '');
            } else {
              setDraftSiteId(siteId);
              setDraftBuildingId('');
            }
          }}
          onApply={() => {
            setQ(draftQ);
            setType(draftType);
            if (inMasters) {
              mastersFilter.setSiteId(draftSiteId === '' ? null : draftSiteId);
              mastersFilter.setBuildingId(draftBuildingId === '' ? null : draftBuildingId);
            } else {
              setSiteId(draftSiteId);
            }
            setPage(1);
          }}
          onClear={() => {
            setDraftQ(''); setDraftSiteId(''); setDraftBuildingId(''); setDraftType('');
            setQ(''); setType('');
            if (inMasters) mastersFilter.setSiteId(null);
            else           setSiteId('');
            setPage(1);
          }}
        >
          <TextField
            label="Search" size="small"
            value={draftQ} onChange={(e) => setDraftQ(e.target.value)}
            placeholder="Facility name"
            autoFocus
          />
          <TextField
            select size="small" label="Site"
            value={draftSiteId}
            onChange={(e) => {
              const v = e.target.value ? Number(e.target.value) : '';
              setDraftSiteId(v);
              // Site change invalidates any drafted building.
              setDraftBuildingId('');
            }}
          >
            <MenuItem value="">All sites</MenuItem>
            {sites.map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
          </TextField>
          {inMasters && (
            <TextField
              select size="small" label="Building"
              value={draftBuildingId}
              disabled={!draftSiteId}
              onChange={(e) => setDraftBuildingId(e.target.value ? Number(e.target.value) : '')}
            >
              <MenuItem value="">All buildings</MenuItem>
              {buildings.map((b) => <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>)}
            </TextField>
          )}
          <TextField
            select size="small" label="Type"
            value={draftType}
            onChange={(e) => setDraftType(e.target.value as '' | FacilityType)}
          >
            <MenuItem value="">All types</MenuItem>
            {TYPE_ORDER.map((t) => <MenuItem key={t} value={t}>{TYPE_LABEL[t]}</MenuItem>)}
          </TextField>
        </FilterPopover>

        <Button
          variant="outlined"
          disabled={exporting}
          startIcon={exporting ? <CircularProgress size={14} /> : <FileDownloadIcon />}
          onClick={exportToExcel}
        >
          {exporting ? 'Exporting…' : 'Download Excel'}
        </Button>
      </PageHeader>

      <CrudTable<FacilityRow>
        rows={displayRows} columns={columns} loading={loading}
        emptyMessage="No facilities yet."
        emptyHint="Add a facility to make it bookable."
        getRowId={(r) => r.id}
        rowCount={total} page={page} pageSize={pageSize}
        onPageChange={(p, ps) => { setPage(p); setPageSize(ps); }}
        onEdit={(row) => navigate(`${editBase}/${row.id}`)}
        onDelete={async (row) => { await facilitiesApi.remove(row.id); load(); }}
      />
    </Box>
  );
}
