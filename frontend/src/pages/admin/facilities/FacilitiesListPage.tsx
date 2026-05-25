import { useEffect, useState } from 'react';
import { Box, Chip, MenuItem, Paper, Stack, TextField } from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { useNavigate } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import CrudTable from '@/components/CrudTable';
import { facilitiesApi } from '@/api/facilities.api';
import { sitesApi } from '@/api/sites.api';
import type { Facility, FacilityType, Site } from '@/types';

const TYPES: { value: '' | FacilityType; label: string }[] = [
  { value: '', label: 'All types' },
  { value: 'meeting_room', label: 'Meeting room' },
  { value: 'gym', label: 'Gym' },
  { value: 'conference_room', label: 'Conference room' },
  { value: 'desk', label: 'Desk' },
  { value: 'swimming_pool', label: 'Swimming pool' },
  { value: 'other', label: 'Other' },
];

export default function FacilitiesListPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Facility[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [siteId, setSiteId] = useState<number | ''>('');
  const [type, setType] = useState<'' | FacilityType>('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await facilitiesApi.list({ page, limit: pageSize, site_id: siteId, type, q });
      setRows(r.data?.data || []);
      setTotal(r.data?.total || 0);
    } finally { setLoading(false); }
  }
  useEffect(() => { sitesApi.list({ limit: 100 }).then((r) => setSites(r.data?.data || [])); }, []);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [page, pageSize, siteId, type, q]);

  const columns: GridColDef<Facility>[] = [
    { field: 'id', headerName: 'ID', width: 80 },
    { field: 'tenant_name', headerName: 'Tenant', width: 180,
      valueGetter: (_v, row) => row.tenant_name || row.tenant_id },
    { field: 'name', headerName: 'Name', flex: 1, minWidth: 200 },
    { field: 'type', headerName: 'Type', width: 140 },
    { field: 'site_name', headerName: 'Site', width: 180 },
    { field: 'floor_name', headerName: 'Floor', width: 160 },
    { field: 'capacity', headerName: 'Capacity', width: 100, align: 'right', headerAlign: 'right' },
    {
      field: 'requires_approval', headerName: 'Approval', width: 110,
      renderCell: (p) => p.row.requires_approval ? <Chip size="small" color="warning" label="required" /> : <Chip size="small" label="auto" />,
    },
    {
      field: 'status', headerName: 'Status', width: 110,
      renderCell: (p) => <Chip size="small" color={p.row.status ? 'success' : 'default'} label={p.row.status ? 'active' : 'inactive'} />,
    },
  ];

  return (
    <Box>
      <PageHeader title="Facilities" subtitle="Bookable rooms, gyms, desks" onRefresh={load}
        addLabel="New facility" onAdd={() => navigate('/admin/facilities/new')} />
      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField size="small" label="Search" sx={{ minWidth: 220 }} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <TextField select size="small" label="Site" sx={{ minWidth: 220 }} value={siteId} onChange={(e) => { setSiteId(e.target.value ? Number(e.target.value) : ''); setPage(1); }}>
            <MenuItem value="">All sites</MenuItem>
            {sites.map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Type" sx={{ minWidth: 200 }} value={type} onChange={(e) => { setType(e.target.value as '' | FacilityType); setPage(1); }}>
            {TYPES.map((t) => <MenuItem key={t.value || 'all'} value={t.value}>{t.label}</MenuItem>)}
          </TextField>
        </Stack>
      </Paper>
      <CrudTable<Facility>
        rows={rows} columns={columns} loading={loading} getRowId={(r) => r.id}
        rowCount={total} page={page} pageSize={pageSize}
        onPageChange={(p, ps) => { setPage(p); setPageSize(ps); }}
        onEdit={(row) => navigate(`/admin/facilities/${row.id}`)}
        onDelete={async (row) => { await facilitiesApi.remove(row.id); load(); }}
      />
    </Box>
  );
}
