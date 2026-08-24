// Floors list - dual mode.
//
// Under /admin/floors        the FilterPopover exposes just "Site" (local state).
// Under /admin/masters/floors the FilterPopover exposes "Site" and "Building"
//                             bound to the shared MastersFilterContext.

import { useEffect, useMemo, useState } from 'react';
import { Box, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { useLocation, useNavigate } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import CrudTable from '@/components/CrudTable';
import FilterPopover from '@/components/FilterPopover';
import { floorsApi } from '@/api/floors.api';
import { sitesApi } from '@/api/sites.api';
import { buildingsApi } from '@/api/buildings.api';
import { useMastersFilterOptional } from '@/contexts/MastersFilterContext';
import { useTenantScope } from '@/context/TenantScopeContext';
import { useRegisterRefresh } from '@/context/RefreshContext';
import type { Building, Floor, Site } from '@/types';

type FloorRow = Floor & { _sno: number };

export default function FloorsListPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const inMasters = location.pathname.startsWith('/admin/masters/');
  const scope = useTenantScope();
  const filter = useMastersFilterOptional();

  const [rows, setRows] = useState<Floor[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [siteId, setSiteId] = useState<number | ''>('');
  const [loading, setLoading] = useState(false);

  // Draft state (bound to popover fields).
  const [draftSiteId, setDraftSiteId] = useState<number | ''>('');
  const [draftBuildingId, setDraftBuildingId] = useState<number | ''>('');

  const effectiveSiteId     = inMasters ? filter.siteId     : (siteId || null);
  const effectiveBuildingId = inMasters ? filter.buildingId : null;

  async function load() {
    setLoading(true);
    try {
      const params: Record<string, unknown> = {};
      // Tenant + Organisation come from the navbar TenantScope so every
      // masters page sees the same slice of data.
      if (scope.tenantId !== null)       params.tenant_id       = scope.tenantId;
      if (scope.organisationId !== null) params.organisation_id = scope.organisationId;
      if (effectiveSiteId)     params.site_id     = effectiveSiteId;
      if (effectiveBuildingId) params.building_id = effectiveBuildingId;
      const r = await floorsApi.list(Object.keys(params).length ? params : undefined);
      setRows((r.data as Floor[]) || []);
    } finally {
      setLoading(false);
    }
  }
  // Sites in the popover picker are also scoped to the navbar tenant + org so
  // an admin can't accidentally pick a site outside their current context.
  useEffect(() => {
    const params: Record<string, unknown> = { limit: 100 };
    if (scope.tenantId !== null)       params.tenant_id       = scope.tenantId;
    if (scope.organisationId !== null) params.organisation_id = scope.organisationId;
    sitesApi.list(params).then((r) => setSites(r.data?.data || []));
  }, [scope.tenantId, scope.organisationId]);

  // Buildings for the popover — scoped to the drafted site so the picker
  // only shows valid options.
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
  }, [scope.tenantId, scope.organisationId, effectiveSiteId, effectiveBuildingId]);

  useRegisterRefresh(load);

  const activeFilterCount = inMasters
    ? (filter.siteId ? 1 : 0) + (filter.buildingId ? 1 : 0)
    : (siteId ? 1 : 0);

  const [savingId, setSavingId] = useState<number | null>(null);
  async function toggleStatus(row: Floor, on: boolean) {
    const next: 0 | 1 = on ? 1 : 0;
    if (row.status === next) return;
    setSavingId(row.id);
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, status: next } : r)));
    try {
      await floorsApi.update(row.id, { status: next });
    } catch (err) {
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, status: row.status } : r)));
      const msg = (err as { response?: { data?: { msg?: string } } })?.response?.data?.msg
        || (err as Error)?.message || 'Failed to update status';
      alert(msg);
    } finally {
      setSavingId(null);
    }
  }

  const displayRows: FloorRow[] = useMemo(
    () => rows.map((r, i) => ({ ...r, _sno: i + 1 })),
    [rows],
  );

  const columns: GridColDef<FloorRow>[] = [
    { field: '_sno', headerName: 'S.No', width: 80, sortable: false, filterable: false },
    { field: 'tenant_name', headerName: 'Tenant', width: 180,
      valueGetter: (_v, row) => row.tenant_name || row.tenant_id },
    { field: 'site_id', headerName: 'Site', width: 200,
      valueGetter: (_v, row) => row.site_name || sites.find((s) => s.id === row.site_id)?.name || row.site_id },
    { field: 'name', headerName: 'Name', flex: 1, minWidth: 200 },
    { field: 'level_number', headerName: 'Level', width: 100 },
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

  const editBase = inMasters ? '/admin/masters/floors' : '/admin/floors';

  return (
    <Box>
      <PageHeader
        title="Floors"
        subtitle="Sub-divisions within sites"
        addLabel="New floor"
        onAdd={() => navigate(`${editBase}/new`)}
      >
        <FilterPopover
          count={activeFilterCount}
          onOpen={() => {
            if (inMasters) {
              setDraftSiteId(filter.siteId ?? '');
              setDraftBuildingId(filter.buildingId ?? '');
            } else {
              setDraftSiteId(siteId);
            }
          }}
          onApply={() => {
            if (inMasters) {
              filter.setSiteId(draftSiteId === '' ? null : draftSiteId);
              filter.setBuildingId(draftBuildingId === '' ? null : draftBuildingId);
            } else {
              setSiteId(draftSiteId);
            }
          }}
          onClear={() => {
            setDraftSiteId(''); setDraftBuildingId('');
            if (inMasters) filter.setSiteId(null);
            else           setSiteId('');
          }}
        >
          <TextField
            select size="small" label="Site"
            value={draftSiteId}
            onChange={(e) => {
              const v = e.target.value ? Number(e.target.value) : '';
              setDraftSiteId(v);
              // Changing site invalidates any drafted building.
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
        </FilterPopover>
      </PageHeader>

      <CrudTable<FloorRow>
        rows={displayRows} columns={columns} loading={loading}
        emptyMessage="No floors yet."
        emptyHint="Add a floor once you have at least one site."
        getRowId={(r) => r.id}
        onEdit={(row) => navigate(`${editBase}/${row.id}`)}
        onDelete={async (row) => { await floorsApi.remove(row.id); load(); }}
      />
    </Box>
  );
}
