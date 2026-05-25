import { useEffect, useState } from 'react';
import { Box, Chip } from '@mui/material';
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

  async function load() {
    setLoading(true);
    try {
      const r = await departmentsApi.list();
      setRows((r.data as Department[]) || []);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const columns: GridColDef<Department>[] = [
    { field: 'id', headerName: 'ID', width: 80 },
    {
      field: 'site_name', headerName: 'Site', width: 180,
      valueGetter: (_v, row) =>
        row.site_name || (row.site_id ? `#${row.site_id}` : '—'),
    },
    { field: 'name', headerName: 'Name', flex: 1, minWidth: 200 },
    { field: 'code', headerName: 'Code', width: 120 },
    {
      field: 'manager_name', headerName: 'Manager', width: 220,
      valueGetter: (_v, row) => row.manager_name ? `${row.manager_name} ${row.manager_lname || ''}` : '—',
    },
    {
      field: 'status', headerName: 'Status', width: 110,
      renderCell: (p) => <Chip size="small" color={p.row.status ? 'success' : 'default'} label={p.row.status ? 'active' : 'inactive'} />,
    },
  ];

  return (
    <Box>
      <PageHeader title="Departments" subtitle="Org chart" onRefresh={load}
        addLabel="New department" onAdd={() => navigate('/admin/departments/new')} />
      <CrudTable<Department>
        rows={rows} columns={columns} loading={loading} getRowId={(r) => r.id}
        onEdit={(row) => navigate(`/admin/departments/${row.id}`)}
        onDelete={async (row) => { await departmentsApi.remove(row.id); load(); }}
      />
    </Box>
  );
}
