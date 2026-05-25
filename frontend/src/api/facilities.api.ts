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
  // Per-facility approval chain.
  // F02 - chain GET/PUT now accept ?stage=checkin|checkout. Defaults to
  // 'checkin' both server- and client-side, so existing call sites keep working.
  getChain: (facilityId: number, stage: 'checkin' | 'checkout' = 'checkin') =>
    api.get<ApiEnvelope<FacilityApprovalChainStep[]>>(
      `/facilities/${facilityId}/chain`, { params: { stage } }
    ).then((r) => r.data),
  replaceChain: (
    facilityId: number,
    steps: { approver_kind: 'user' | 'dynamic_dept_manager'; approver_user_id?: number | null }[],
    stage: 'checkin' | 'checkout' = 'checkin',
  ) =>
    api.put<ApiEnvelope>(
      `/facilities/${facilityId}/chain`, { steps }, { params: { stage } }
    ).then((r) => r.data),
};
