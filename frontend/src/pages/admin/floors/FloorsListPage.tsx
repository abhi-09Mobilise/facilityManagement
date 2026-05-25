import { useEffect, useState } from 'react';
import { Box, MenuItem, Paper, Stack, TextField } from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { useNavigate } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import CrudTable from '@/components/CrudTable';
import { floorsApi } from '@/api/floors.api';
import { sitesApi } from '@/api/sites.api';
import type { Floor, Site } from '@/types';

export default function FloorsListPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Floor[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<number | ''>('');
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await floorsApi.list(siteId ? { site_id: siteId } : undefined);
      setRows((r.data as Floor[]) || []);
    } finally { setLoading(false); }
  }
  useEffect(() => { sitesApi.list({ limit: 100 }).then((r) => setSites(r.data?.data || [])); }, []);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [siteId]);

  const columns: GridColDef<Floor>[] = [
    { field: 'id', headerName: 'ID', width: 80 },
    { field: 'tenant_name', headerName: 'Tenant', width: 180,
      valueGetter: (_v, row) => row.tenant_name || row.tenant_id },
    { field: 'site_id', headerName: 'Site', width: 200,
      valueGetter: (_v, row) => row.site_name || sites.find((s) => s.id === row.site_id)?.name || row.site_id },
    { field: 'name', headerName: 'Name', flex: 1, minWidth: 200 },
    { field: 'level_number', headerName: 'Level', width: 100 },
  ];

  return (
    <Box>
      <PageHeader title="Floors" subtitle="Sub-divisions within sites" onRefresh={load}
        addLabel="New floor" onAdd={() => navigate('/admin/floors/new')} />
      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={2}>
          <TextField select size="small" label="Filter by site" sx={{ minWidth: 280 }} value={siteId}
            onChange={(e) => setSiteId(e.target.value ? Number(e.target.value) : '')}>
            <MenuItem value="">All sites</MenuItem>
            {sites.map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
          </TextField>
        </Stack>
      </Paper>
      <CrudTable<Floor>
        rows={rows} columns={columns} loading={loading} getRowId={(r) => r.id}
        onEdit={(row) => navigate(`/admin/floors/${row.id}`)}
        onDelete={async (row) => { await floorsApi.remove(row.id); load(); }}
      />
    </Box>
  );
}
