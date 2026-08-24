import { useEffect, useMemo, useState } from 'react';
import { Box, Stack, Switch, TextField, Typography } from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { useNavigate } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import CrudTable from '@/components/CrudTable';
import FilterPopover from '@/components/FilterPopover';
import { departmentsApi } from '@/api/departments.api';
import { useRegisterRefresh } from '@/context/RefreshContext';
import { useTenantScope } from '@/context/TenantScopeContext';
import type { Department } from '@/types';

type DepartmentRow = Department & { _sno: number };

export default function DepartmentsListPage() {
  const navigate = useNavigate();
  const scope = useTenantScope();
  const [rows, setRows] = useState<Department[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [draftQ, setDraftQ] = useState('');

  async function load() {
    setLoading(true);
    try {
      const params: Record<string, unknown> = {};
      if (q)                             params.q               = q;
      // Tenant + Organisation come from the navbar TenantScope.
      if (scope.tenantId !== null)       params.tenant_id       = scope.tenantId;
      if (scope.organisationId !== null) params.organisation_id = scope.organisationId;
      const r = await departmentsApi.list(Object.keys(params).length ? params : undefined);
      setRows((r.data as Department[]) || []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    /* eslint-disable-next-line */
  }, [q, scope.tenantId, scope.organisationId]);

  useRegisterRefresh(load);

  const activeFilterCount = q ? 1 : 0;

  const [savingId, setSavingId] = useState<number | null>(null);
  async function toggleStatus(row: Department, on: boolean) {
    const next: 0 | 1 = on ? 1 : 0;
    if (row.status === next) return;
    setSavingId(row.id);
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, status: next } : r)));
    try {
      await departmentsApi.update(row.id, { status: next });
    } catch (err) {
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, status: row.status } : r)));
      const msg = (err as { response?: { data?: { msg?: string } } })?.response?.data?.msg
        || (err as Error)?.message || 'Failed to update status';
      alert(msg);
    } finally {
      setSavingId(null);
    }
  }

  const displayRows: DepartmentRow[] = useMemo(
    () => rows.map((r, i) => ({ ...r, _sno: i + 1 })),
    [rows],
  );

  const columns: GridColDef<DepartmentRow>[] = [
    { field: '_sno', headerName: 'S.No', width: 80, sortable: false, filterable: false },
    {
      field: 'site_name', headerName: 'Site', width: 160,
      valueGetter: (_v, row) => row.site_name || (row.site_id ? `#${row.site_id}` : '—'),
    },
    { field: 'name', headerName: 'Name', flex: 1, minWidth: 160 },
    { field: 'code', headerName: 'Code', width: 90 },
    {
      field: 'manager_name', headerName: 'Manager', flex: 1, minWidth: 160,
      valueGetter: (_v, row) => row.manager_name ? `${row.manager_name} ${row.manager_lname || ''}` : '—',
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

  return (
    <Box>
      <PageHeader
        title="Departments"
        subtitle="Org chart"
        addLabel="New department"
        onAdd={() => navigate('/admin/departments/new')}
      >
        <FilterPopover
          count={activeFilterCount}
          onOpen={() => setDraftQ(q)}
          onApply={() => setQ(draftQ)}
          onClear={() => { setDraftQ(''); setQ(''); }}
        >
          <TextField
            label="Search" size="small"
            value={draftQ} onChange={(e) => setDraftQ(e.target.value)}
            placeholder="Name or code"
            autoFocus
          />
        </FilterPopover>
      </PageHeader>

      <CrudTable<DepartmentRow>
        rows={displayRows} columns={columns} loading={loading}
        emptyMessage="No departments yet."
        emptyHint="Add a department so bookings roll up by team."
        getRowId={(r) => r.id}
        onEdit={(row) => navigate(`/admin/departments/${row.id}`)}
        onDelete={async (row) => { await departmentsApi.remove(row.id); load(); }}
      />
    </Box>
  );
}
