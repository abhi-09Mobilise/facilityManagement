import api from './client';
import { createCrudApi } from './createCrudApi';
import type { ApiEnvelope, Facility, OperatingHour, FacilityApprovalChainStep } from '@/types';

const base = createCrudApi<Facility>('/facilities');

export const facilitiesApi = {
  ...base,
  // Nested operating hours
  listHours: (facilityId: number) =>
    api.get<ApiEnvelope<OperatingHour[]>>(`/facilities/${facilityId}/hours`).then((r) => r.data),
  replaceHours: (facilityId: number, hours: OperatingHour[]) =>
    api.put<ApiEnvelope>(`/facilities/${facilityId}/hours`, { hours }).then((r) => r.data),
  // F09 - delete-guard: how many active future bookings hold this chair id?
  // Used by the layout editor to warn before deleting a chair that's
  // currently reserved.
  chairBookings: (facilityId: number, chairId: string) =>
    api.get<ApiEnvelope<{ count: number; chair_id: string }>>(
      `/facilities/${facilityId}/chair-bookings`,
      { params: { chair_id: chairId } }
    ).then((r) => r.data),
  // Per-facility approval / notification chain.
  // F02 added stage='checkin'|'checkout'. F09 added stage='notification' for
  // FYI recipients that aren't part of the approval workflow.
  getChain: (facilityId: number, stage: 'checkin' | 'checkout' | 'notification' | 'cleanup' = 'checkin') =>
    api.get<ApiEnvelope<FacilityApprovalChainStep[]>>(
      `/facilities/${facilityId}/chain`, { params: { stage } }
    ).then((r) => r.data),
  replaceChain: (
    facilityId: number,
    steps: { approver_kind: 'user' | 'dynamic_dept_manager'; approver_user_id?: number | null }[],
    stage: 'checkin' | 'checkout' | 'notification' | 'cleanup' = 'checkin',
  ) =>
    api.put<ApiEnvelope>(
      `/facilities/${facilityId}/chain`, { steps }, { params: { stage } }
    ).then((r) => r.data),
};
