// Admin facilities list.
//
// Filter UX (this rev):
//   - Primary filter: one button per facility type that actually exists
//     in this tenant (derived from a one-time full list fetch on mount).
//     "All" is the default. Single-select; clicking the active button
//     reverts to "All".
//   - Secondary filters (Search + Site) are tucked behind a "More filters"
//     toggle — kept off-screen by default to make the type buttons the
//     focal point. The toggle text shows a chip with the count of active
//     non-type filters so admins know there's something hidden.

import { useEffect, useMemo, useState } from 'react';
import { Box, Button, Chip, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import type { GridColDef } from '@mui/x-data-grid';
import { useNavigate } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import CrudTable from '@/components/CrudTable';
import { facilitiesApi } from '@/api/facilities.api';
import { sitesApi } from '@/api/sites.api';
import type { Facility, FacilityType, Site } from '@/types';

const TYPE_LABEL: Record<FacilityType, string> = {
  meeting_room:    'Meeting room',
  gym:             'Gym',
  conference_room: 'Conference room',
  desk:            'Desk',
  swimming_pool:   'Swimming pool',
  other:           'Other',
};

// Stable display order (so the buttons don't shuffle around as data loads).
const TYPE_ORDER: FacilityType[] = [
  'meeting_room', 'conference_room', 'gym', 'desk', 'swimming_pool', 'other',
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

  // Toggle for the collapsible "More filters" panel — defaults to closed
  // so the type buttons are the only thing competing for the user's eye.
  const [moreOpen, setMoreOpen] = useState(false);

  // Distinct facility types this tenant actually owns. Fetched once on
  // mount via a slightly larger page so even tenants with hundreds of
  // facilities get a complete type picture. We don't expose the data
  // itself — only the unique set of types.
  const [availableTypes, setAvailableTypes] = useState<FacilityType[]>([]);
  // Per-type count chip (cosmetic — admins like to know "3 gyms" before
  // they click).
  const [typeCounts, setTypeCounts] = useState<Record<FacilityType, number>>({} as Record<FacilityType, number>);

  async function load() {
    setLoading(true);
    try {
      const r = await facilitiesApi.list({ page, limit: pageSize, site_id: siteId, type, q });
      setRows(r.data?.data || []);
      setTotal(r.data?.total || 0);
    } finally { setLoading(false); }
  }

  // Mount: load sites + a "fat" facility list (just to compute the type
  // universe and per-type counts). 500 is the same cap the admin can
  // already paginate to and avoids a dedicated /types endpoint.
  useEffect(() => {
    sitesApi.list({ limit: 100 }).then((r) => setSites(r.data?.data || []));
    facilitiesApi.list({ limit: 500 }).then((r) => {
      const data = (r.data?.data || []) as Facility[];
      const counts: Record<FacilityType, number> = {} as Record<FacilityType, number>;
      for (const f of data) {
        if (!f.type) continue;
        counts[f.type] = (counts[f.type] || 0) + 1;
      }
      const present = TYPE_ORDER.filter((t) => counts[t] > 0);
      setAvailableTypes(present);
      setTypeCounts(counts);
    }).catch(() => { /* leave empty — UI just shows nothing */ });
  }, []);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [page, pageSize, siteId, type, q]);

  // Count of active secondary filters — drives the chip on the
  // "More filters" toggle so it's clear when something's hidden.
  const moreFilterCount = useMemo(() => {
    return (q ? 1 : 0) + (siteId !== '' ? 1 : 0);
  }, [q, siteId]);

  function clickType(t: FacilityType) {
    // Clicking the active button reverts to "All" — a familiar toggle
    // pattern that saves a separate "clear" affordance.
    setType((current) => (current === t ? '' : t));
    setPage(1);
  }

  function clearAllFilters() {
    setType('');
    setSiteId('');
    setQ('');
    setPage(1);
  }

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
      renderCell: (p) => p.row.requires_approval
        ? <Chip size="small" color="warning" label="required" />
        : <Chip size="small" label="auto" />,
    },
    {
      field: 'status', headerName: 'Status', width: 110,
      renderCell: (p) => <Chip size="small" color={p.row.status ? 'success' : 'default'} label={p.row.status ? 'active' : 'inactive'} />,
    },
  ];

  return (
    <Box>
      <PageHeader
        title="Facilities" subtitle="Bookable rooms, gyms, desks" onRefresh={load}
        addLabel="New facility" onAdd={() => navigate('/admin/facilities/new')}
      />

      <Paper sx={{ p: 2, mb: 2 }}>
        {/* ----- Primary: type buttons -----
            One button per type the tenant actually has, plus "All" first.
            The active button gets the filled "contained" variant; others
            stay outlined so the choice is unambiguous at a glance. */}
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
          <Button
            size="small"
            variant={type === '' ? 'contained' : 'outlined'}
            onClick={() => { setType(''); setPage(1); }}
          >
            All
          </Button>
          {availableTypes.map((t) => {
            const active = type === t;
            return (
              <Button
                key={t}
                size="small"
                variant={active ? 'contained' : 'outlined'}
                color={active ? 'primary' : 'inherit'}
                onClick={() => clickType(t)}
                sx={{ textTransform: 'none' }}
              >
                {TYPE_LABEL[t] || t}
                <Chip
                  size="small"
                  label={typeCounts[t] || 0}
                  sx={{
                    ml: 1, height: 18, fontSize: 11,
                    bgcolor: active ? 'primary.dark' : 'action.hover',
                    color: active ? 'primary.contrastText' : 'text.secondary',
                  }}
                />
              </Button>
            );
          })}

          {/* Empty-state hint for tenants that don't have any facilities
              yet — keeps the row from looking awkwardly blank. */}
          {availableTypes.length === 0 && (
            <Typography variant="caption" color="text.secondary">
              No facilities yet — click "New facility" to add the first one.
            </Typography>
          )}

          {/* Spacer pushes the "More filters" toggle to the right edge of
              the row on wide screens; on mobile it wraps below the buttons. */}
          <Box sx={{ flexGrow: 1, minWidth: 0 }} />

          <Button
            size="small"
            variant="text"
            color="inherit"
            startIcon={<TuneOutlinedIcon fontSize="small" />}
            endIcon={moreOpen ? <KeyboardArrowUpIcon fontSize="small" /> : <KeyboardArrowDownIcon fontSize="small" />}
            onClick={() => setMoreOpen((v) => !v)}
            sx={{ textTransform: 'none' }}
          >
            More filters
            {moreFilterCount > 0 && (
              <Chip
                size="small"
                color="primary"
                label={moreFilterCount}
                sx={{ ml: 1, height: 18, fontSize: 11 }}
              />
            )}
          </Button>
        </Stack>

        {/* ----- Secondary: collapsible Search + Site -----
            Hidden by default. Animates open via maxHeight transition so
            the table doesn't jump abruptly. */}
        <Box
          sx={{
            overflow: 'hidden',
            transition: 'max-height 0.25s ease, opacity 0.2s ease, margin-top 0.2s ease',
            maxHeight: moreOpen ? 200 : 0,
            opacity: moreOpen ? 1 : 0,
            mt: moreOpen ? 1.5 : 0,
          }}
        >
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={2}
            sx={{ pt: 0.5 }}
          >
            <TextField
              size="small" label="Search by name" sx={{ minWidth: 240 }}
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }}
            />
            <TextField
              select size="small" label="Site" sx={{ minWidth: 220 }}
              value={siteId}
              onChange={(e) => { setSiteId(e.target.value ? Number(e.target.value) : ''); setPage(1); }}
            >
              <MenuItem value="">All sites</MenuItem>
              {sites.map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
            </TextField>
            {moreFilterCount > 0 && (
              <Button
                size="small" variant="text" color="inherit"
                onClick={clearAllFilters}
                sx={{ alignSelf: { md: 'center' }, textTransform: 'none' }}
              >
                Clear filters
              </Button>
            )}
          </Stack>
        </Box>
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
// (() => {
//     return (q ? 1 : 0) + (siteId !== '' ? 1 : 0);
//   }, [q, siteId]);

//   function clickType(t: FacilityType) {
//     setType((current) => (current === t ? '' : t));
//     setPage(1);
//   }

//   function clearAllFilters() {
//     setType('');
//     setSiteId('');
//     setQ('');
//     setPage(1);
//   }

//   const columns: GridColDef<Facility>[] = [
//     { field: 'id', headerName: 'ID', width: 80 },
//     { field: 'tenant_name', headerName: 'Tenant', width: 180,
//       valueGetter: (_v, row) => row.tenant_name || row.tenant_id },
//     { field: 'name', headerName: 'Name', flex: 1, minWidth: 200 },
//     { field: 'type', headerName: 'Type', width: 140 },
//     { field: 'site_name', headerName: 'Site', width: 180 },
//     { field: 'floor_name', headerName: 'Floor', width: 160 },
//     { field: 'capacity', headerName: 'Capacity', width: 100, align: 'right', headerAlign: 'right' },
//     {
//       field: 'requires_approval', headerName: 'Approval', width: 110,
//       renderCell: (p) => p.row.requires_approval
//         ? <Chip size="small" color="warning" label="required" />
//         : <Chip size="small" label="auto" />,
//     },
//     {
//       field: 'status', headerName: 'Status', width: 110,
//       renderCell: (p) => <Chip size="small" color={p.row.status ? 'success' : 'default'} label={p.row.status ? 'active' : 'inactive'} />,
//     },
//   ];

//   return (
//     <Box>
//       <PageHeader
//         title="Facilities" subtitle="Bookable rooms, gyms, desks" onRefresh={load}
//         addLabel="New facility" onAdd={() => navigate('/admin/facilities/new')}
//       />

//       <Paper sx={{ p: 2, mb: 2 }}>
//         <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
//           <Button
//             size="small"
//             variant={type === '' ? 'contained' : 'outlined'}
//             onClick={() => { setType(''); setPage(1); }}
//           >
//             All
//           </Button>
//           {availableTypes.map((t) => {
//             const active = type === t;
//             return (
//               <Button
//                 key={t}
//                 size="small"
//                 variant={active ? 'contained' : 'outlined'}
//                 color={active ? 'primary' : 'inherit'}
//                 onClick={() => clickType(t)}
//                 sx={{ textTransform: 'none' }}
//               >
//                 {TYPE_LABEL[t] || t}
//                 <Chip
//                   size="small"
//                   label={typeCounts[t] || 0}
//                   sx={{
//                     ml: 1, height: 18, fontSize: 11,
//                     bgcolor: active ? 'primary.dark' : 'action.hover',
//                     color: active ? 'primary.contrastText' : 'text.secondary',
//                   }}
//                 />
//               </Button>
//             );
//           })}

//           {availableTypes.length === 0 && (
//             <Typography variant="caption" color="text.secondary">
//               No facilities yet — click "New facility" to add the first one.
//             </Typography>
//           )}

//           <Box sx={{ flexGrow: 1, minWidth: 0 }} />

//           <Button
//             size="small"
//             variant="text"
//             color="inherit"
//             startIcon={<TuneOutlinedIcon fontSize="small" />}
//             endIcon={moreOpen ? <KeyboardArrowUpIcon fontSize="small" /> : <KeyboardArrowDownIcon fontSize="small" />}
//             onClick={() => setMoreOpen((v) => !v)}
//             sx={{ textTransform: 'none' }}
//           >
//             More filters
//             {moreFilterCount > 0 && (
//               <Chip
//                 size="small"
//                 color="primary"
//                 label={moreFilterCount}
//                 sx={{ ml: 1, height: 18, fontSize: 11 }}
//               />
//             )}
//           </Button>
//         </Stack>

//         <Box
//           sx={{
//             overflow: 'hidden',
//             transition: 'max-height 0.25s ease, opacity 0.2s ease, margin-top 0.2s ease',
//             maxHeight: moreOpen ? 200 : 0,
//             opacity: moreOpen ? 1 : 0,
//             mt: moreOpen ? 1.5 : 0,
//           }}
//         >
//           <Stack
//             direction={{ xs: 'column', md: 'row' }}
//             spacing={2}
//             sx={{ pt: 0.5 }}
//           >
//             <TextField
//               size="small" label="Search by name" sx={{ minWidth: 240 }}
//               value={q}
//               onChange={(e) => { setQ(e.target.value); setPage(1); }}
//             />
//             <TextField
//               select size="small" label="Site" sx={{ minWidth: 220 }}
//               value={siteId}
//               onChange={(e) => { setSiteId(e.target.value ? Number(e.target.value) : ''); setPage(1); }}
//             >
//               <MenuItem value="">All sites</MenuItem>
//               {sites.map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
//             </TextField>
//             {moreFilterCount > 0 && (
//               <Button
//                 size="small" variant="text" color="inherit"
//                 onClick={clearAllFilters}
//                 sx={{ alignSelf: { md: 'center' }, textTransform: 'none' }}
//               >
//                 Clear filters
//               </Button>
//             )}
//           </Stack>
//         </Box>
//       </Paper>

//       <CrudTable<Facility>
//         rows={rows} columns={columns} loading={loading} getRowId={(r) => r.id}
//         rowCount={total} page={page} pageSize={pageSize}
//         onPageChange={(p, ps) => { setPage(p); setPageSize(ps); }}
//         onEdit={(row) => navigate(`/admin/facilities/${row.id}`)}
//         onDelete={async (row) => { await facilitiesApi.remove(row.id); load(); }}
//       />
//     </Box>
//   );
// }
//    {sites.map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
//             </TextField>
//             {moreFilterCount > 0 && (
//               <Button
//                 size="small" variant="text" color="inherit"
//                 onClick={clearAllFilters}
//                 sx={{ alignSelf: { md: 'center' }, textTransform: 'none' }}
//               >
//                 Clear filters
//               </Button>
//             )}
//           </Stack>
//         </Box>
//       </Paper>

//       <CrudTable<Facility>
//         rows={rows} columns={columns} loading={loading} getRowId={(r) => r.id}
//         rowCount={total} page={page} pageSize={pageSize}
//         onPageChange={(p, ps) => { setPage(p); setPageSize(ps); }}
//         onEdit={(row) => navigate(`/admin/facilities/${row.id}`)}
//         onDelete={async (row) => { await facilitiesApi.remove(row.id); load(); }}
//       />
//     </Box>
//   );
// }
