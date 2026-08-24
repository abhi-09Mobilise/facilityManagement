import { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Snackbar, Stack, Switch, TextField, Typography } from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { useNavigate } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import CrudTable from '@/components/CrudTable';
import FilterPopover from '@/components/FilterPopover';
import { organisationsApi } from '@/api/organisations.api';
import { useRegisterRefresh } from '@/context/RefreshContext';
import type { Organisation } from '@/types';

type OrganisationRow = Organisation & { _sno: number };

export default function OrganisationsListPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Organisation[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftQ, setDraftQ] = useState('');

  async function load() {
    setLoading(true);
    try {
      const r = await organisationsApi.list({ page, limit: pageSize, q });
      setRows(r.data?.data || []);
      setTotal(r.data?.total || 0);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [page, pageSize, q]);

  useRegisterRefresh(load);

  const activeFilterCount = q ? 1 : 0;

  const [savingId, setSavingId] = useState<number | null>(null);
  async function toggleStatus(row: Organisation, on: boolean) {
    const next: 0 | 1 = on ? 1 : 0;
    if (row.status === next) return;
    setSavingId(row.id);
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, status: next } : r)));
    try {
      await organisationsApi.update(row.id, { status: next });
    } catch (err) {
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, status: row.status } : r)));
      const msg = (err as { response?: { data?: { msg?: string } } })?.response?.data?.msg
        || (err as Error)?.message || 'Failed to update status';
      setError(msg);
    } finally {
      setSavingId(null);
    }
  }

  const displayRows: OrganisationRow[] = useMemo(
    () => rows.map((r, i) => ({ ...r, _sno: (page - 1) * pageSize + i + 1 })),
    [rows, page, pageSize],
  );

  const columns: GridColDef<OrganisationRow>[] = [
    { field: '_sno', headerName: 'S.No', width: 80, sortable: false, filterable: false },
    { field: 'tenant_name', headerName: 'Tenant', width: 180,
      valueGetter: (_v, row) => row.tenant_name || row.tenant_id },
    { field: 'name', headerName: 'Name', flex: 1, minWidth: 220 },
    { field: 'slug', headerName: 'Slug', width: 160 },
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
        title="Organisations"
        subtitle="The layer between a tenant and its sites"
        addLabel="New organisation"
        onAdd={() => navigate('/admin/masters/organisations/new')}
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
            placeholder="Name or slug"
            autoFocus
          />
        </FilterPopover>
      </PageHeader>

      <CrudTable<OrganisationRow>
        rows={displayRows} columns={columns} loading={loading}
        emptyMessage="No organisations yet."
        emptyHint="Create an organisation to group sites and facilities."
        getRowId={(r) => r.id}
        rowCount={total} page={page} pageSize={pageSize}
        onPageChange={(p, ps) => { setPage(p); setPageSize(ps); }}
        onEdit={(row) => navigate(`/admin/masters/organisations/${row.id}`)}
        onDelete={async (row) => {
          try {
            await organisationsApi.remove(row.id);
            load();
          } catch (err: unknown) {
            const msg = (err as { response?: { data?: { msg?: string } } })?.response?.data?.msg
              || 'Delete failed';
            setError(msg);
          }
        }}
      />

      <Snackbar
        open={!!error}
        autoHideDuration={5000}
        onClose={() => setError(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>
      </Snackbar>
    </Box>
  );
}
