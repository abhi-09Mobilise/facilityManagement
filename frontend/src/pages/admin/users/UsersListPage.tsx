import { useEffect, useState } from 'react';
import { Box, Chip, Paper, Stack } from '@mui/material';
import SearchInput from '@/components/SearchInput';
import type { GridColDef } from '@mui/x-data-grid';
import { useNavigate } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import CrudTable from '@/components/CrudTable';
import { usersApi } from '@/api/users.api';
import type { User } from '@/types';

const ROLE_COLOR: Record<string, 'primary' | 'success' | 'default'> = {
  super_admin: 'primary',
  tenant_admin: 'success',
  employee: 'default',
};

export default function UsersListPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await usersApi.list({ page, limit: pageSize, q });
      setRows(r.data?.data || []);
      setTotal(r.data?.total || 0);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [page, pageSize, q]);

  const columns: GridColDef<User>[] = [
    { field: 'username', headerName: 'Username', width: 110 },
    {
      field: 'name', headerName: 'Name', flex: 1, minWidth: 150,
      valueGetter: (_v, row) => [row.name, row.lname].filter(Boolean).join(' '),
    },
    { field: 'designation', headerName: 'Designation', width: 130 },
    // Email gets flex so it shrinks when the viewport narrows; minWidth
    // keeps it readable but won't push the actions column off-screen.
    { field: 'email', headerName: 'Email', flex: 1, minWidth: 160 },
    {
      field: 'role', headerName: 'Role', width: 100,
      renderCell: (p) => <Chip size="small" color={ROLE_COLOR[p.row.role || 'employee']} label={p.row.role} />,
    },
    {
      field: 'is_approver', headerName: 'Approver', width: 90,
      renderCell: (p) => p.row.is_approver
        ? <Chip size="small" color="warning" label="approver" />
        : <Chip size="small" label="—" variant="outlined" />,
    },
    {
      field: 'status', headerName: 'Status', width: 90,
      renderCell: (p) => <Chip size="small" color={p.row.status ? 'success' : 'default'} label={p.row.status ? 'active' : 'inactive'} />,
    },
  ];

  return (
    <Box>
      <PageHeader title="Employees" subtitle="People in your tenant" onRefresh={load}
        addLabel="New employee" onAdd={() => navigate('/users/new')} />
      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={2}>
          {/* Debounced — only fires the API call 300ms after the admin
              stops typing, so a 7k-user tenant doesn't get hammered. */}
          <SearchInput
            value={q}
            onChange={(v) => { setQ(v); setPage(1); }}
            placeholder="Search by name, email, username, designation…"
            className="min-w-[320px]"
          />
        </Stack>
      </Paper>
      <CrudTable<User>
        rows={rows} columns={columns} loading={loading} getRowId={(r) => r.id}
        rowCount={total} page={page} pageSize={pageSize}
        onPageChange={(p, ps) => { setPage(p); setPageSize(ps); }}
        onEdit={(row) => navigate(`/admin/users/${row.id}`)}
        onDelete={async (row) => { await usersApi.remove(row.id); load(); }}
      />
    </Box>
  );
}
