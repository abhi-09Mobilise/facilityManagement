// F01 - Per-slot capacity API
import api from './client';
import type { ApiEnvelope } from '@/types';

export interface SlotOverride {
  id?: number;
  facility_id?: number;
  day_of_week: number;          // 0..6 (Sun..Sat)
  start_time: string;           // 'HH:MM' or 'HH:MM:SS'
  end_time: string;
  min_attendees: number;
  max_attendees: number;
  status?: 0 | 1;
}

export const slotCapacitiesApi = {
  list(facilityId: number) {
    return api
      .get<ApiEnvelope<SlotOverride[]>>(`/facilities/${facilityId}/slot-capacities`)
      .then((r) => r.data);
  },
  replace(facilityId: number, overrides: SlotOverride[]) {
    return api
      .put<ApiEnvelope<{ count: number }>>(`/facilities/${facilityId}/slot-capacities`, { overrides })
      .then((r) => r.data);
  },
};
