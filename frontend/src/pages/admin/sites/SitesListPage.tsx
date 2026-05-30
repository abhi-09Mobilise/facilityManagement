import { useEffect, useState } from 'react';
import { Box, Chip, Paper, Stack } from '@mui/material';
import SearchInput from '@/components/SearchInput';
import type { GridColDef } from '@mui/x-data-grid';
import { useNavigate } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import CrudTable from '@/components/CrudTable';
import { sitesApi } from '@/api/sites.api';
import type { Site } from '@/types';

export default function SitesListPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Site[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await sitesApi.list({ page, limit: pageSize, q });
      setRows(r.data?.data || []);
      setTotal(r.data?.total || 0);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [page, pageSize, q]);

  const columns: GridColDef<Site>[] = [
    { field: 'tenant_name', headerName: 'Tenant', width: 180,
      valueGetter: (_v, row) => row.tenant_name || row.tenant_id },
    { field: 'name', headerName: 'Name', flex: 1, minWidth: 220 },
    { field: 'code', headerName: 'Code', width: 140 },
    { field: 'address', headerName: 'Address', flex: 1.5, minWidth: 240 },
    { field: 'timezone', headerName: 'Timezone', width: 160 },
    {
      field: 'status', headerName: 'Status', width: 110,
      renderCell: (p) => <Chip size="small" color={p.row.status ? 'success' : 'default'} label={p.row.status ? 'active' : 'inactive'} />,
    },
  ];

  return (
    <Box>
      <PageHeader title="Sites" subtitle="Physical campuses / offices" onRefresh={load}
        addLabel="New site" onAdd={() => navigate('/admin/sites/new')} />
      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={2}>
          {/* Debounced — backend now has real LIMIT/OFFSET + ?q= over name/code/address. */}
          <SearchInput
            value={q}
            onChange={(v) => { setQ(v); setPage(1); }}
            placeholder="Search by name, code or address…"
            className="min-w-[320px]"
          />
        </Stack>
      </Paper>
      <CrudTable<Site>
        rows={rows} columns={columns} loading={loading} getRowId={(r) => r.id}
        rowCount={total} page={page} pageSize={pageSize}
        onPageChange={(p, ps) => { setPage(p); setPageSize(ps); }}
        onEdit={(row) => navigate(`/admin/sites/${row.id}`)}
        onDelete={async (row) => { await sitesApi.remove(row.id); load(); }}
      />
    </Box>
  );
}
