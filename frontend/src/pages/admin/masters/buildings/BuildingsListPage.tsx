// Buildings list — Phase B admin surface for the hierarchy layer.
//
// Scope model (post navbar-owned tenant/org refactor):
//   - Tenant + Organisation are picked in the navbar (TenantScopeContext).
//   - Site is picked in the popover (MastersFilterContext — masters shell only).
//   - Search / status stay page-local.

import { useEffect, useMemo, useState } from 'react';
import { Box, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { useNavigate } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import CrudTable from '@/components/CrudTable';
import FilterPopover from '@/components/FilterPopover';
import { buildingsApi } from '@/api/buildings.api';
import { sitesApi } from '@/api/sites.api';
import { useMastersFilter } from '@/contexts/MastersFilterContext';
import { useTenantScope } from '@/context/TenantScopeContext';
import { useRegisterRefresh } from '@/context/RefreshContext';
import type { Building, Site } from '@/types';

type BuildingRow = Building & { _sno: number };

export default function BuildingsListPage() {
  const navigate = useNavigate();
  const scope = useTenantScope();
  const filter = useMastersFilter();
  const [rows, setRows] = useState<Building[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);

  // Draft state (bound to popover fields, committed on Apply).
  const [draftQ, setDraftQ] = useState('');
  const [draftSiteId, setDraftSiteId] = useState<number | ''>('');

  // Sites narrowed by the active tenant + org scope so the picker only shows
  // valid options.
  const [sites, setSites] = useState<Site[]>([]);
  useEffect(() => {
    const params: Record<string, unknown> = { limit: 200 };
    if (scope.tenantId !== null)       params.tenant_id       = scope.tenantId;
    if (scope.organisationId !== null) params.organisation_id = scope.organisationId;
    sitesApi.list(params)
      .then((r) => setSites((r.data?.data as Site[]) || []))
      .catch(() => setSites([]));
  }, [scope.tenantId, scope.organisationId]);

  async function load() {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, limit: pageSize, q };
      if (scope.tenantId !== null)       params.tenant_id       = scope.tenantId;
      if (scope.organisationId !== null) params.organisation_id = scope.organisationId;
      if (filter.siteId !== null)        params.site_id         = filter.siteId;
      const r = await buildingsApi.list(params);
      setRows(r.data?.data || []);
      setTotal(r.data?.total || 0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, q, scope.tenantId, scope.organisationId, filter.siteId]);

  useRegisterRefresh(load);

  const activeFilterCount = (q ? 1 : 0) + (filter.siteId !== null ? 1 : 0);

  const [savingId, setSavingId] = useState<number | null>(null);
  async function toggleStatus(row: Building, on: boolean) {
    const next: 0 | 1 = on ? 1 : 0;
    if (row.status === next) return;
    setSavingId(row.id);
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, status: next } : r)));
    try {
      await buildingsApi.update(row.id, { status: next });
    } catch (err) {
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, status: row.status } : r)));
      const msg = (err as { response?: { data?: { msg?: string } } })?.response?.data?.msg
        || (err as Error)?.message || 'Failed to update status';
      alert(msg);
    } finally {
      setSavingId(null);
    }
  }

  const displayRows: BuildingRow[] = useMemo(
    () => rows.map((r, i) => ({ ...r, _sno: (page - 1) * pageSize + i + 1 })),
    [rows, page, pageSize],
  );

  const columns: GridColDef<BuildingRow>[] = [
    { field: '_sno', headerName: 'S.No', width: 80, sortable: false, filterable: false },
    { field: 'name', headerName: 'Name', flex: 1, minWidth: 200 },
    { field: 'site_name', headerName: 'Site', width: 180,
      valueGetter: (_v, row) => row.site_name || row.site_id },
    { field: 'code', headerName: 'Code', width: 110 },
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

  return (
    <Box>
      <PageHeader
        title="Buildings"
        subtitle="Group floors within a site"
        addLabel="New building"
        onAdd={() => navigate('/admin/masters/buildings/new')}
      >
        <FilterPopover
          count={activeFilterCount}
          onOpen={() => {
            setDraftQ(q);
            setDraftSiteId(filter.siteId ?? '');
          }}
          onApply={() => {
            setQ(draftQ);
            filter.setSiteId(draftSiteId === '' ? null : draftSiteId);
            setPage(1);
          }}
          onClear={() => {
            setDraftQ(''); setDraftSiteId('');
            setQ('');
            filter.setSiteId(null);
            setPage(1);
          }}
        >
          <TextField
            label="Search" size="small"
            value={draftQ} onChange={(e) => setDraftQ(e.target.value)}
            placeholder="Name, code or address"
            autoFocus
          />
          <TextField
            select size="small" label="Site"
            value={draftSiteId}
            onChange={(e) => setDraftSiteId(e.target.value ? Number(e.target.value) : '')}
          >
            <MenuItem value="">All sites</MenuItem>
            {sites.map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
          </TextField>
        </FilterPopover>
      </PageHeader>

      <CrudTable<BuildingRow>
        rows={displayRows} columns={columns} loading={loading}
        emptyMessage="No buildings yet."
        emptyHint="Add a building to group floors."
        getRowId={(r) => r.id}
        rowCount={total} page={page} pageSize={pageSize}
        onPageChange={(p, ps) => { setPage(p); setPageSize(ps); }}
        onEdit={(row) => navigate(`/admin/masters/buildings/${row.id}`)}
        onDelete={async (row) => { await buildingsApi.remove(row.id); load(); }}
      />
    </Box>
  );
}
