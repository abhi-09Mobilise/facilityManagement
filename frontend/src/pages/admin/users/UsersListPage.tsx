import { useEffect, useState } from 'react';
import { Box, Chip, Paper, Stack, TextField } from '@mui/material';
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
    { field: 'id', headerName: 'ID', width: 70 },
    { field: 'username', headerName: 'Username', width: 140 },
    {
      field: 'name', headerName: 'Name', flex: 1, minWidth: 180,
      valueGetter: (_v, row) => [row.name, row.lname].filter(Boolean).join(' '),
    },
    { field: 'designation', headerName: 'Designation', width: 160 },
    { field: 'email', headerName: 'Email', width: 200 },
    {
      field: 'role', headerName: 'Role', width: 130,
      renderCell: (p) => <Chip size="small" color={ROLE_COLOR[p.row.role || 'employee']} label={p.row.role} />,
    },
    {
      field: 'is_approver', headerName: 'Approver', width: 110,
      renderCell: (p) => p.row.is_approver
        ? <Chip size="small" color="warning" label="approver" />
        : <Chip size="small" label="—" variant="outlined" />,
    },
    {
      field: 'status', headerName: 'Status', width: 110,
      renderCell: (p) => <Chip size="small" color={p.row.status ? 'success' : 'default'} label={p.row.status ? 'active' : 'inactive'} />,
    },
  ];

  return (
    <Box>
      <PageHeader title="Employees" subtitle="People in your tenant" onRefresh={load}
        addLabel="New employee" onAdd={() => navigate('/users/new')} />
      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={2}>
          <TextField label="Search" size="small" sx={{ minWidth: 280 }} value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }} />
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
