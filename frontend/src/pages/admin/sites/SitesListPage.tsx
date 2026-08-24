// Sites list.
//
// Scope model (post navbar-owned tenant/org refactor):
//   - Tenant + Organisation are picked in the navbar (TenantScopeContext).
//     This page just reads them and forwards to the API.
//   - Search / status stay page-local, exposed via the FilterPopover.

import { useEffect, useMemo, useState } from 'react';
import { Box, Stack, Switch, TextField, Typography } from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { useLocation, useNavigate } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import CrudTable from '@/components/CrudTable';
import FilterPopover from '@/components/FilterPopover';
import { sitesApi } from '@/api/sites.api';
import { useTenantScope } from '@/context/TenantScopeContext';
import { useRegisterRefresh } from '@/context/RefreshContext';
import type { Site } from '@/types';

type SiteRow = Site & { _sno: number };

export default function SitesListPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const inMasters = location.pathname.startsWith('/admin/masters/');
  const scope = useTenantScope();

  const [rows, setRows] = useState<Site[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);

  // Draft state - bound to the popover fields; committed on Apply.
  const [draftQ, setDraftQ] = useState('');

  async function load() {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, limit: pageSize, q };
      if (scope.tenantId !== null)       params.tenant_id       = scope.tenantId;
      if (scope.organisationId !== null) params.organisation_id = scope.organisationId;
      const r = await sitesApi.list(params);
      setRows(r.data?.data || []);
      setTotal(r.data?.total || 0);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    /* eslint-disable-next-line */
  }, [page, pageSize, q, scope.tenantId, scope.organisationId]);

  // Expose refresh to the navbar's global button.
  useRegisterRefresh(load);

  const activeFilterCount = q ? 1 : 0;

  // Track per-row toggle state so double-clicks don't queue two updates.
  const [savingId, setSavingId] = useState<number | null>(null);

  async function toggleStatus(row: Site, on: boolean) {
    const next: 0 | 1 = on ? 1 : 0;
    if (row.status === next) return;
    setSavingId(row.id);
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, status: next } : r)));
    try {
      await sitesApi.update(row.id, { status: next });
    } catch (err) {
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, status: row.status } : r)));
      const msg = (err as { response?: { data?: { msg?: string } } })?.response?.data?.msg
        || (err as Error)?.message || 'Failed to update status';
      alert(msg);
    } finally {
      setSavingId(null);
    }
  }

  const displayRows: SiteRow[] = useMemo(
    () => rows.map((r, i) => ({ ...r, _sno: (page - 1) * pageSize + i + 1 })),
    [rows, page, pageSize],
  );

  const columns: GridColDef<SiteRow>[] = [
    {
      field: '_sno', headerName: 'S.No', width: 80,
      sortable: false, filterable: false,
    },
    { field: 'tenant_name', headerName: 'Tenant', width: 180,
      valueGetter: (_v, row) => row.tenant_name || row.tenant_id },
    { field: 'name', headerName: 'Name', flex: 1, minWidth: 220 },
    { field: 'code', headerName: 'Code', width: 140 },
    { field: 'address', headerName: 'Address', flex: 1.5, minWidth: 240 },
    { field: 'timezone', headerName: 'Timezone', width: 160 },
    {
      field: 'status',
      headerName: 'Status',
      width: 140,
      sortable: false,
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

  const editBase = inMasters ? '/admin/masters/sites' : '/admin/sites';

  return (
    <Box>
      <PageHeader
        title="Sites"
        subtitle="Physical campuses / offices"
        addLabel="New site"
        onAdd={() => navigate(`${editBase}/new`)}
      >
        <FilterPopover
          count={activeFilterCount}
          onOpen={() => setDraftQ(q)}
          onApply={() => { setQ(draftQ); setPage(1); }}
          onClear={() => { setDraftQ(''); setQ(''); setPage(1); }}
        >
          <TextField
            label="Search" size="small"
            value={draftQ} onChange={(e) => setDraftQ(e.target.value)}
            placeholder="Name, code or address"
            autoFocus
          />
        </FilterPopover>
      </PageHeader>

      <CrudTable<SiteRow>
        rows={displayRows}
        columns={columns}
        loading={loading}
        emptyMessage="No sites yet."
        emptyHint="Add a site (an office or campus) to start onboarding facilities."
        getRowId={(r) => r.id}
        rowCount={total}
        page={page}
        pageSize={pageSize}
        onPageChange={(p, ps) => { setPage(p); setPageSize(ps); }}
        onEdit={(row) => navigate(`${editBase}/${row.id}`)}
        onDelete={async (row) => { await sitesApi.remove(row.id); load(); }}
      />
    </Box>
  );
}
