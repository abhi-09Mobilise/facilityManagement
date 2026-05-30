import { useEffect, useState } from 'react';
import { Box, Chip, Paper, Stack } from '@mui/material';
import SearchInput from '@/components/SearchInput';
import type { GridColDef } from '@mui/x-data-grid';
import { useNavigate } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import CrudTable from '@/components/CrudTable';
import { departmentsApi } from '@/api/departments.api';
import type { Department } from '@/types';

export default function DepartmentsListPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Department[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');

  async function load() {
    setLoading(true);
    try {
      const r = await departmentsApi.list(q ? { q } : undefined);
      setRows((r.data as Department[]) || []);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [q]);

  const columns: GridColDef<Department>[] = [
    {
      field: 'site_name', headerName: 'Site', width: 140,
      valueGetter: (_v, row) =>
        row.site_name || (row.site_id ? `#${row.site_id}` : '—'),
    },
    { field: 'name', headerName: 'Name', flex: 1, minWidth: 160 },
    { field: 'code', headerName: 'Code', width: 90 },
    // Manager gets flex — a long full name shouldn't push actions off-screen.
    {
      field: 'manager_name', headerName: 'Manager', flex: 1, minWidth: 160,
      valueGetter: (_v, row) => row.manager_name ? `${row.manager_name} ${row.manager_lname || ''}` : '—',
    },
    {
      field: 'status', headerName: 'Status', width: 90,
      renderCell: (p) => <Chip size="small" color={p.row.status ? 'success' : 'default'} label={p.row.status ? 'active' : 'inactive'} />,
    },
  ];

  return (
    <Box>
      <PageHeader title="Departments" subtitle="Org chart" onRefresh={load}
        addLabel="New department" onAdd={() => navigate('/admin/departments/new')} />
      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={2}>
          {/* Debounced — backend ?q= matches name + code. Depts are tiny
              (5-10 per tenant) so no pagination needed. */}
          <SearchInput
            value={q}
            onChange={setQ}
            placeholder="Search by name or code…"
            className="min-w-[280px]"
          />
        </Stack>
      </Paper>
      <CrudTable<Department>
        rows={rows} columns={columns} loading={loading} getRowId={(r) => r.id}
        onEdit={(row) => navigate(`/admin/departments/${row.id}`)}
        onDelete={async (row) => { await departmentsApi.remove(row.id); load(); }}
      />
    </Box>
  );
}
