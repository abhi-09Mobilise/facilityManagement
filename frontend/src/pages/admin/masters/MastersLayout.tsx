// MastersLayout — the tabbed shell that wraps every /admin/masters/* page.
//
// Renders (top-to-bottom):
//   1. "Masters" PageHeader
//   2. MUI <Tabs> strip: Organisations | Sites | Buildings | Floors | Facilities
//      (active tab derived from URL segment)
//   3. <Outlet /> — the current tab's list or form page
//
// The cascade filter (Organisation -> Site -> Building -> Floor) used to
// render here as a bar under the tabs; it has been moved into each
// individual page's per-page FilterPopover so filters live next to the
// "Add" button and don't take up horizontal space at the top of every
// tab. The <MastersFilterProvider> is still mounted here so the shared
// (session-persisted, cascading) state remains available to every child
// page via useMastersFilter() / useMastersFilterOptional().

import { Suspense } from 'react';
import { Box, Paper, Tab, Tabs } from '@mui/material';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import PageSpinner from '@/components/PageSpinner';
import { MastersFilterProvider } from '@/contexts/MastersFilterContext';

// Ordered list of tabs. The `segment` matches the URL under /admin/masters/.
const TABS: { segment: string; label: string }[] = [
  { segment: 'organisations', label: 'Organisations' },
  { segment: 'sites',         label: 'Sites' },
  { segment: 'buildings',     label: 'Buildings' },
  { segment: 'floors',        label: 'Floors' },
  { segment: 'facilities',    label: 'Facilities' },
];

function activeSegmentFor(pathname: string): string {
  // /admin/masters/<segment>/... -> <segment>. Fall back to 'sites' when
  // the URL is just /admin/masters (should be redirected by the routes
  // anyway).
  const m = pathname.match(/^\/admin\/masters\/([^/]+)/);
  return m ? m[1] : 'sites';
}

function MastersShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const activeSegment = activeSegmentFor(location.pathname);

  function handleTabChange(_e: React.SyntheticEvent, next: string) {
    if (next === activeSegment) return;
    navigate('/admin/masters/' + next);
  }

  return (
    <Box>
      <PageHeader
        title="Masters"
        subtitle="One place to manage the tenant hierarchy — organisations, sites, buildings, floors, and facilities."
      />

      <Paper sx={{ mb: 2 }}>
        <Tabs
          value={activeSegment}
          onChange={handleTabChange}
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          sx={{ borderBottom: 1, borderColor: 'divider', px: 1 }}
        >
          {TABS.map((t) => (
            <Tab key={t.segment} value={t.segment} label={t.label} sx={{ textTransform: 'none' }} />
          ))}
        </Tabs>
      </Paper>

      <Suspense fallback={<PageSpinner />}>
        <Outlet />
      </Suspense>
    </Box>
  );
}

export default function MastersLayout() {
  return (
    <MastersFilterProvider>
      <MastersShell />
    </MastersFilterProvider>
  );
}
