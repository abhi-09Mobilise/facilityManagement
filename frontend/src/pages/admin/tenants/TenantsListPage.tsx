import { useEffect, useState } from 'react';
import { Box, Chip, Stack, TextField, MenuItem, Paper } from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { useNavigate } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import CrudTable from '@/components/CrudTable';
import { tenantsApi } from '@/api/tenants.api';
import type { Tenant } from '@/types';

export default function TenantsListPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Tenant[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

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

  const columns: GridColDef<Tenant>[] = [
    { field: 'id',   headerName: 'ID', width: 80 },
    { field: 'name', headerName: 'Name', flex: 1, minWidth: 200 },
    { field: 'slug', headerName: 'Slug', width: 140 },
    { field: 'contact_email', headerName: 'Contact', width: 220 },
    { field: 'currency_code', headerName: 'Currency', width: 100 },
    { field: 'timezone', headerName: 'Timezone', width: 160 },
    {
      field: 'status', headerName: 'Status', width: 120,
      renderCell: (p) => {
        const color = p.row.status === 'active' ? 'success' : p.row.status === 'suspended' ? 'error' : 'warning';
        return <Chip size="small" color={color} label={p.row.status} />;
      },
    },
  ];

  return (
    <Box>
      <PageHeader
        title="Tenants"
        subtitle="Organizations on the platform"
        onRefresh={load}
        addLabel="New tenant"
        onAdd={() => navigate('/admin/tenants/new')}
      />
      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField label="Search" size="small" sx={{ minWidth: 240 }} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <TextField select label="Status" size="small" sx={{ minWidth: 160 }} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <MenuItem value="">All</MenuItem>
            <MenuItem value="trial">Trial</MenuItem>
            <MenuItem value="active">Active</MenuItem>
            <MenuItem value="suspended">Suspended</MenuItem>
          </TextField>
        </Stack>
      </Paper>
      <CrudTable<Tenant>
        rows={rows}
        columns={columns}
        loading={loading}
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
