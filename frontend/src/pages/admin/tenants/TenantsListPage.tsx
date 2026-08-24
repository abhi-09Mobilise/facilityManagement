import { useEffect, useMemo, useState } from 'react';
import {
  Box, MenuItem, Stack, Switch, TextField, Typography,
} from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { useNavigate } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import CrudTable from '@/components/CrudTable';
import FilterPopover from '@/components/FilterPopover';
import { tenantsApi } from '@/api/tenants.api';
import { useRegisterRefresh } from '@/context/RefreshContext';
import type { Tenant } from '@/types';

// Adds a pagination-aware serial number to each row so the S.No column can
// render it directly without knowing about page/pageSize from within the grid.
type TenantRow = Tenant & { _sno: number };

export default function TenantsListPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Tenant[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  // Draft filter state - the popover's fields bind here; committed to the
  // outer q/status only when the user hits Apply.
  const [draftQ, setDraftQ] = useState('');
  const [draftStatus, setDraftStatus] = useState('');

  async function load() {
    setLoading(true);
    try {
      const r = await tenantsApi.list({ page, limit: pageSize, q, status });
      setRows(r.data?.data || []);
      setTotal(r.data?.total || 0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [page, pageSize, q, status]);

  // Expose refresh to the navbar's global button.
  useRegisterRefresh(load);

  const activeFilterCount = (q ? 1 : 0) + (status ? 1 : 0);

  // Track which rows are mid-toggle so the switch can show a disabled state
  // while the API call is in flight.
  const [savingId, setSavingId] = useState<number | null>(null);

  async function toggleStatus(row: Tenant, on: boolean) {
    const next = on ? 'active' : 'suspended';
    if (row.status === next) return;
    setSavingId(row.id);
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, status: next } : r)));
    try {
      await tenantsApi.update(row.id, { status: next });
    } catch (err) {
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, status: row.status } : r)));
      const msg = (err as { response?: { data?: { msg?: string } } })?.response?.data?.msg
        || (err as Error)?.message || 'Failed to update status';
      alert(msg);
    } finally {
      setSavingId(null);
    }
  }

  const displayRows: TenantRow[] = useMemo(
    () => rows.map((r, i) => ({ ...r, _sno: (page - 1) * pageSize + i + 1 })),
    [rows, page, pageSize],
  );

  const columns: GridColDef<TenantRow>[] = [
    {
      field: '_sno', headerName: 'S.No', width: 80,
      sortable: false, filterable: false,
    },
    { field: 'name', headerName: 'Name', flex: 1, minWidth: 180 },
    { field: 'slug', headerName: 'Slug', width: 120 },
    {
      field: 'admin',
      headerName: 'Admin',
      flex: 1.4,
      minWidth: 240,
      sortable: false,
      renderCell: (p) => {
        const email = p.row.contact_email;
        const phone = p.row.contact_phone;
        if (!email && !phone) {
          return <Typography variant="body2" color="text.secondary">—</Typography>;
        }
        return (
          <Stack sx={{ py: 0.5, lineHeight: 1.2 }}>
            {email && <Typography variant="body2">{email}</Typography>}
            {phone && <Typography variant="caption" color="text.secondary">{phone}</Typography>}
          </Stack>
        );
      },
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 140,
      sortable: false,
      renderCell: (p) => {
        const isActive = p.row.status === 'active';
        const label =
          p.row.status === 'active'    ? 'Active' :
          p.row.status === 'suspended' ? 'Inactive' : 'Trial';
        const labelColor =
          p.row.status === 'active'    ? 'success.main' :
          p.row.status === 'suspended' ? 'text.secondary' : 'warning.main';
        return (
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <Switch
              size="small"
              checked={isActive}
              disabled={savingId === p.row.id}
              onChange={(_e, on) => toggleStatus(p.row, on)}
              onClick={(e) => e.stopPropagation()}
            />
            <Typography variant="caption" sx={{ color: labelColor, fontWeight: 500 }}>
              {label}
            </Typography>
          </Stack>
        );
      },
    },
  ];

  return (
    <Box>
      <PageHeader
        title="Tenants"
        subtitle="Organizations on the platform"
        addLabel="New tenant"
        onAdd={() => navigate('/admin/tenants/new')}
      >
        <FilterPopover
          count={activeFilterCount}
          onOpen={() => { setDraftQ(q); setDraftStatus(status); }}
          onApply={() => { setQ(draftQ); setStatus(draftStatus); setPage(1); }}
          onClear={() => { setDraftQ(''); setDraftStatus(''); setQ(''); setStatus(''); setPage(1); }}
        >
          <TextField
            label="Search" size="small"
            value={draftQ} onChange={(e) => setDraftQ(e.target.value)}
            autoFocus
          />
          <TextField
            select label="Status" size="small"
            value={draftStatus} onChange={(e) => setDraftStatus(e.target.value)}
          >
            <MenuItem value="">All</MenuItem>
            <MenuItem value="trial">Trial</MenuItem>
            <MenuItem value="active">Active</MenuItem>
            <MenuItem value="suspended">Suspended</MenuItem>
          </TextField>
        </FilterPopover>
      </PageHeader>

      <CrudTable<TenantRow>
        rows={displayRows}
        columns={columns}
        loading={loading}
        emptyMessage="No tenants yet."
        emptyHint="Add a tenant to onboard a new customer."
        getRowId={(r) => r.id}
        rowCount={total}
        page={page}
        pageSize={pageSize}
        onPageChange={(p, ps) => { setPage(p); setPageSize(ps); }}
        onEdit={(row) => navigate(`/admin/tenants/${row.id}`)}
        onDelete={async (row) => { await tenantsApi.remove(row.id); load(); }}
        deleteConfirmMessage={(r) => `Mark "${r.name}" as deleted? (trash=1)`}
      />
    </Box>
  );
}
