import { useEffect, useMemo, useState } from 'react';
import { Box, Chip, Stack, Switch, TextField, Typography } from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { useNavigate } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import CrudTable from '@/components/CrudTable';
import FilterPopover from '@/components/FilterPopover';
import { usersApi } from '@/api/users.api';
import { useRegisterRefresh } from '@/context/RefreshContext';
import { useTenantScope } from '@/context/TenantScopeContext';
import type { User } from '@/types';

const ROLE_COLOR: Record<string, 'primary' | 'success' | 'default'> = {
  super_admin: 'primary',
  tenant_admin: 'success',
  employee: 'default',
};

type UserRow = User & { _sno: number };

export default function UsersListPage() {
  const navigate = useNavigate();
  const scope = useTenantScope();
  const [rows, setRows] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [draftQ, setDraftQ] = useState('');

  async function load() {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, limit: pageSize, q };
      // Tenant + Organisation come from the navbar TenantScope.
      if (scope.tenantId !== null)       params.tenant_id       = scope.tenantId;
      if (scope.organisationId !== null) params.organisation_id = scope.organisationId;
      const r = await usersApi.list(params);
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

  useRegisterRefresh(load);

  const activeFilterCount = q ? 1 : 0;

  const [savingId, setSavingId] = useState<number | null>(null);
  async function toggleStatus(row: User, on: boolean) {
    const next: 0 | 1 = on ? 1 : 0;
    if (row.status === next) return;
    setSavingId(row.id);
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, status: next } : r)));
    try {
      await usersApi.update({ id: row.id, status: next });
    } catch (err) {
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, status: row.status } : r)));
      const msg = (err as { response?: { data?: { msg?: string } } })?.response?.data?.msg
        || (err as Error)?.message || 'Failed to update status';
      alert(msg);
    } finally {
      setSavingId(null);
    }
  }

  const displayRows: UserRow[] = useMemo(
    () => rows.map((r, i) => ({ ...r, _sno: (page - 1) * pageSize + i + 1 })),
    [rows, page, pageSize],
  );

  const columns: GridColDef<UserRow>[] = [
    { field: '_sno', headerName: 'S.No', width: 80, sortable: false, filterable: false },
    { field: 'username', headerName: 'Username', width: 130 },
    {
      field: 'name', headerName: 'Name', flex: 1, minWidth: 150,
      valueGetter: (_v, row) => [row.name, row.lname].filter(Boolean).join(' '),
    },
    { field: 'designation', headerName: 'Designation', width: 130 },
    { field: 'email', headerName: 'Email', flex: 1, minWidth: 160 },
    {
      field: 'role', headerName: 'Role', width: 110,
      renderCell: (p) => <Chip size="small" color={ROLE_COLOR[p.row.role || 'employee']} label={p.row.role} />,
    },
    {
      field: 'is_approver', headerName: 'Approver', width: 100,
      renderCell: (p) => p.row.is_approver
        ? <Chip size="small" color="warning" label="approver" />
        : <Chip size="small" label="—" variant="outlined" />,
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
        title="Employees"
        subtitle="People in your tenant"
        addLabel="New employee"
        onAdd={() => navigate('/users/new')}
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
            placeholder="Name, email, username, designation"
            autoFocus
          />
        </FilterPopover>
      </PageHeader>

      <CrudTable<UserRow>
        rows={displayRows} columns={columns} loading={loading}
        emptyMessage="No users yet."
        emptyHint="Invite your first employee to start booking."
        getRowId={(r) => r.id}
        rowCount={total} page={page} pageSize={pageSize}
        onPageChange={(p, ps) => { setPage(p); setPageSize(ps); }}
        onEdit={(row) => navigate(`/admin/users/${row.id}`)}
        onDelete={async (row) => { await usersApi.remove(row.id); load(); }}
      />
    </Box>
  );
}
