import api from './client';
import type { ApiEnvelope, BookingStatus, FacilityType } from '@/types';

export interface DashboardFacility {
  id: number;
  name: string;
  type: FacilityType;
  capacity: number;
  today_open_minutes: number;
  today_booked_minutes: number;
  occupied_now: boolean;
}

export interface DashboardPayload {
  summary: {
    total_facilities: number;
    occupied_now: number;
    free_now: number;
  };
  per_facility: DashboardFacility[];
  as_of: string; // ISO timestamp
}

// F08 - Gantt timeline (facilities × time)
export interface GanttFacility {
  id: number;
  name: string;
  type: FacilityType;
}
export interface GanttItem {
  id: number;
  facility_id: number;
  title: string | null;
  start_at: string;   // 'YYYY-MM-DD HH:MM:SS'
  end_at:   string;
  status: BookingStatus;
  booker_name: string | null;
}
export interface GanttPayload {
  facilities: GanttFacility[];
  items: GanttItem[];
  window: { from: string; to: string };
}

export const dashboardsApi = {
  tenantAdmin(params: { tenant_id?: number } = {}) {
    return api
      .get<ApiEnvelope<DashboardPayload>>('/dashboards/tenant-admin', { params })
      .then((r) => r.data);
  },
  gantt(params: { site_id?: number; from?: string; to?: string; tenant_id?: number } = {}) {
    return api
      .get<ApiEnvelope<GanttPayload>>('/dashboards/gantt', { params })
      .then((r) => r.data);
  },
};
