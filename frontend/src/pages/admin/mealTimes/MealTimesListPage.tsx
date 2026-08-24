import { useEffect, useMemo, useState } from 'react';
import { Box, Stack, Switch, Typography } from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { useNavigate } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import CrudTable from '@/components/CrudTable';
import { mealTimesApi } from '@/api/mealTimes.api';
import { useRegisterRefresh } from '@/context/RefreshContext';
import type { MealTime } from '@/types';

type MealTimeRow = MealTime & { _sno: number };

export default function MealTimesListPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<MealTime[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await mealTimesApi.list();
      setRows((r.data as MealTime[]) || []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useRegisterRefresh(load);

  const [savingId, setSavingId] = useState<number | null>(null);
  async function toggleStatus(row: MealTime, on: boolean) {
    const next: 0 | 1 = on ? 1 : 0;
    if (row.status === next) return;
    setSavingId(row.id);
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, status: next } : r)));
    try {
      await mealTimesApi.update(row.id, { status: next });
    } catch (err) {
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, status: row.status } : r)));
      const msg = (err as { response?: { data?: { msg?: string } } })?.response?.data?.msg
        || (err as Error)?.message || 'Failed to update status';
      alert(msg);
    } finally {
      setSavingId(null);
    }
  }

  const displayRows: MealTimeRow[] = useMemo(
    () => rows.map((r, i) => ({ ...r, _sno: i + 1 })),
    [rows],
  );

  const columns: GridColDef<MealTimeRow>[] = [
    { field: '_sno', headerName: 'S.No', width: 80, sortable: false, filterable: false },
    { field: 'name', headerName: 'Name', flex: 1, minWidth: 200 },
    { field: 'start_time', headerName: 'Start', width: 120 },
    { field: 'end_time', headerName: 'End', width: 120 },
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
        title="Meal times"
        subtitle="Pre-book windows employees can attach to bookings"
        addLabel="New meal time"
        onAdd={() => navigate('/admin/meal-times/new')}
      />
      <CrudTable<MealTimeRow>
        rows={displayRows} columns={columns} loading={loading}
        emptyMessage="No meal times yet."
        emptyHint="Define morning/lunch/evening slots so bookers can pre-book."
        getRowId={(r) => r.id}
        onEdit={(row) => navigate(`/admin/meal-times/${row.id}`)}
        onDelete={async (row) => { await mealTimesApi.remove(row.id); load(); }}
      />
    </Box>
  );
}
