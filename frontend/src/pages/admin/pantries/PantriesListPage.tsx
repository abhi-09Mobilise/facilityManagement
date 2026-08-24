// F06 - Pantries list (admin).
// Aligned with the other master list pages: PageHeader + FilterPopover
// + CrudTable + navbar-registered refresh + S.No + status toggle.

import { useEffect, useMemo, useState } from 'react';
import { Box, Stack, Switch, TextField, Typography } from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { useNavigate } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import CrudTable from '@/components/CrudTable';
import FilterPopover from '@/components/FilterPopover';
import { pantriesApi, type Pantry } from '@/api/pantries.api';
import { useRegisterRefresh } from '@/context/RefreshContext';

type PantryRow = Pantry & { _sno: number };

// Client-side name filter — the API doesn't support ?q= for pantries, and
// the row count is small enough (dozens per tenant, not thousands) that
// filtering in-memory is fine.
export default function PantriesListPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Pantry[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [draftQ, setDraftQ] = useState('');

  async function load() {
    setLoading(true);
    try {
      const r = await pantriesApi.list();
      if (r.status) setRows(r.data || []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useRegisterRefresh(load);

  const activeFilterCount = q ? 1 : 0;

  const [savingId, setSavingId] = useState<number | null>(null);
  async function toggleStatus(row: Pantry, on: boolean) {
    const next: 0 | 1 = on ? 1 : 0;
    if (row.status === next) return;
    setSavingId(row.id);
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, status: next } : r)));
    try {
      await pantriesApi.update(row.id, { status: next });
    } catch (err) {
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, status: row.status } : r)));
      const msg = (err as { response?: { data?: { msg?: string } } })?.response?.data?.msg
        || (err as Error)?.message || 'Failed to update status';
      alert(msg);
    } finally {
      setSavingId(null);
    }
  }

  const filtered = useMemo(() => {
    if (!q) return rows;
    const needle = q.toLowerCase();
    return rows.filter((r) =>
      r.name?.toLowerCase().includes(needle) ||
      (r.site_name || '').toLowerCase().includes(needle)
    );
  }, [rows, q]);

  const displayRows: PantryRow[] = useMemo(
    () => filtered.map((r, i) => ({ ...r, _sno: i + 1 })),
    [filtered],
  );

  const columns: GridColDef<PantryRow>[] = [
    { field: '_sno', headerName: 'S.No', width: 80, sortable: false, filterable: false },
    { field: 'name', headerName: 'Name', flex: 1, minWidth: 200 },
    {
      field: 'site_id', headerName: 'Site', width: 200,
      valueGetter: (_v, row) => row.site_name || `#${row.site_id}`,
    },
    { field: 'menu_count', headerName: 'Menu items', width: 130 },
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
        title="Pantries"
        subtitle="Cafés, canteens and pantries — linked to facilities to power booking orders."
        addLabel="New pantry"
        onAdd={() => navigate('/admin/pantries/new')}
      >
        <FilterPopover
          count={activeFilterCount}
          onOpen={() => setDraftQ(q)}
          onApply={() => setQ(draftQ)}
          onClear={() => { setDraftQ(''); setQ(''); }}
        >
          <TextField
            label="Search" size="small"
            value={draftQ} onChange={(e) => setDraftQ(e.target.value)}
            placeholder="Name or site"
            autoFocus
          />
        </FilterPopover>
      </PageHeader>

      <CrudTable<PantryRow>
        rows={displayRows} columns={columns} loading={loading}
        emptyMessage="No pantries yet."
        emptyHint="Create one to start linking it from facilities."
        getRowId={(r) => r.id}
        onEdit={(row) => navigate(`/admin/pantries/${row.id}`)}
        onDelete={async (row) => { await pantriesApi.remove(row.id); load(); }}
      />
    </Box>
  );
}
