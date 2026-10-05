// Employee landing for /facility.
//
// Bento-style card grid of facility types. Clicking a card routes to
// /facility/type/:type where the booker picks the specific room + slot.
// "My bookings" used to live underneath this page but was relocated to its
// own /my-bookings route (already in the sidebar) so this landing page
// stays focused on browsing/booking.

import { useEffect, useState } from 'react';
import { Alert, Box, CircularProgress } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import FacilityCardGrid from './components/FacilityCardGrid';
import { facilitiesApi } from '@/api/facilities.api';
import { useTenantScope } from '@/context/TenantScopeContext';
import type { Facility } from '@/types';

export default function FacilityBookingPage() {
  const navigate = useNavigate();
  const scope = useTenantScope();
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    // Scope to the selected tenant + organisation so admins see only the
    // picked org's facilities. Org-scoped roles (employee/approver/org_admin)
    // are auto-filtered by the backend via their JWT, so passing undefined
    // here is harmless for them (empty params are stripped before the request).
    facilitiesApi.list({
      limit: 200,
      tenant_id: scope.tenantId ?? undefined,
      organisation_id: scope.organisationId ?? undefined,
    })
      .then((r) => { if (alive) setFacilities(r.data?.data || []); })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(
          (e as { response?: { data?: { msg?: string } } })?.response?.data?.msg
            || 'Failed to load facilities'
        );
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [scope.tenantId, scope.organisationId]);

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {loading ? (
        <Box display="flex" justifyContent="center" p={5}><CircularProgress /></Box>
      ) : (
        <FacilityCardGrid
          facilities={facilities}
          onBook={(type) => navigate(`/facility/type/${type}`)}
        />
      )}
    </Box>
  );
}
