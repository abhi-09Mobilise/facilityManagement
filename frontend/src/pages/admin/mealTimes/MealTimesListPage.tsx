import { useEffect, useState } from 'react';
import { Box, Chip } from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { useNavigate } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import CrudTable from '@/components/CrudTable';
import { mealTimesApi } from '@/api/mealTimes.api';
import type { MealTime } from '@/types';

export default function MealTimesListPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<MealTime[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await mealTimesApi.list();
      setRows((r.data as MealTime[]) || []);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const columns: GridColDef<MealTime>[] = [
    { field: 'id', headerName: 'ID', width: 80 },
    { field: 'name', headerName: 'Name', flex: 1, minWidth: 200 },
    { field: 'start_time', headerName: 'Start', width: 120 },
    { field: 'end_time', headerName: 'End', width: 120 },
    {
      field: 'status', headerName: 'Status', width: 110,
      renderCell: (p) => <Chip size="small" color={p.row.status ? 'success' : 'default'} label={p.row.status ? 'active' : 'inactive'} />,
    },
  ];

  return (
    <Box>
      <PageHeader title="Meal times" subtitle="Pre-book windows employees can attach to bookings" onRefresh={load}
        addLabel="New meal time" onAdd={() => navigate('/admin/meal-times/new')} />
      <CrudTable<MealTime>
        rows={rows} columns={columns} loading={loading} getRowId={(r) => r.id}
        onEdit={(row) => navigate(`/admin/meal-times/${row.id}`)}
        onDelete={async (row) => { await mealTimesApi.remove(row.id); load(); }}
      />
    </Box>
  );
}
