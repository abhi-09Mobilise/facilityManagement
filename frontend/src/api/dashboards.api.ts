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
    // Today-overlap stats (any booking whose window intersects CURDATE).
    // Added for the "Booked today" KPI tile which replaced the live
    // "Booked right now" counter — same data is already visible in the
    // Peak Booking Times heatmap, so the tile now covers the daily view.
    facilities_booked_today?: number;
    bookings_today?: number;
    seats_booked_today?: number;
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

// Peak-times heatmap payload — feeds the SpaceDesk PeakBookingTimes widget.
// `cells` is a sparse list: only (weekday, hour) buckets that actually have
// bookings appear. The summary strings are rendered as-is in the UI.
export interface PeakTimesCell {
  weekday: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
  hour: number;        // 0..23
  count: number;
}
export interface PeakTimesPayload {
  cells: PeakTimesCell[];
  busiestSlot: string;        // e.g. 'Tue, 10:00–11:00'
  busiestHour: string;        // e.g. '10:00 · Tue'
  quietestWorking: string;    // e.g. '18:00–19:00'
  maxPerSlot: number;
  window: { from: string; to: string } | null;
  as_of: string;
}

// Booking-channel donut — aggregated by the booking.channel enum
// ('portal' / 'app' / 'qr' / 'tablet'). Backend always returns all four
// slices (zero-count channels included) so the widget doesn't need to
// pad missing slices.
export interface BookingChannelSlice {
  name: 'QR walk-in' | 'Mobile app' | 'Web portal' | 'Door tablet';
  value: number;
  color: string;
}
export interface BookingChannelPayload {
  slices: BookingChannelSlice[];
  total: number;
  window: { from: string; to: string } | null;
  as_of: string;
}

// Feedback dashboard aggregation — fed by facility_ratings table rows,
// grouped per-facility and bucketed into "needs attention" (avg < 4) vs
// "top rated" (avg >= 4). Empty response when no ratings exist in window.
export interface FeedbackFacilityRow {
  initials: string;
  name: string;
  type: string;
  site: string;
  rating: number;
  reviews: number;
  mostMentioned: string;
}
export interface FeedbackPayload {
  overall: number;
  reviews: number;
  distribution: { stars: 5 | 4 | 3 | 2 | 1; percent: number }[];
  needsAttention: FeedbackFacilityRow[];
  topRated: FeedbackFacilityRow[];
  window: { from: string; to: string } | null;
  as_of: string;
}

// Recent activity feed — union of new bookings, check-ins (QR scans),
// ratings, and pantry orders across the current scope, sorted by
// timestamp DESC. The backend pre-computes `ago` for immediate display;
// `ts` is the raw ISO so the UI can refresh labels for a long-open panel.
export interface RecentActivityItem {
  id: string;
  icon: 'checkin' | 'rating' | 'pantry' | 'booking';
  title: string;        // supports **bold** markers (same as sampleData)
  description: string;
  ago: string;
  ts: string | null;
}
export interface RecentActivityPayload {
  items: RecentActivityItem[];
  as_of: string;
}

// Pantry orders aggregation — delivery-lifecycle fields are nullable
// because the current pantry schema doesn't track them yet. The widget
// renders null as a muted "—" placeholder.
export interface PantryOrdersPayload {
  created: number;
  delivered: number | null;
  inProgress: number | null;
  avgDeliveryMin: number | null;
  daily: { day: string; orders: number }[];
  topItems: { name: string; orders: number; color: string }[];
  window: { from: string; to: string } | null;
  as_of: string;
}

export const dashboardsApi = {
  tenantAdmin(params: {
    tenant_id?: number;
    organisation_id?: number;
    site_id?: number;
    limit?: number;
  } = {}) {
    return api
      .get<ApiEnvelope<DashboardPayload>>('/dashboards/tenant-admin', { params })
      .then((r) => r.data);
  },
  gantt(params: {
    tenant_id?: number;
    organisation_id?: number;
    site_id?: number;
    from?: string;
    to?: string;
  } = {}) {
    return api
      .get<ApiEnvelope<GanttPayload>>('/dashboards/gantt', { params })
      .then((r) => r.data);
  },
  peakTimes(params: {
    tenant_id?: number;
    organisation_id?: number;
    site_id?: number;
    facility_type?: string;
    from?: string;
    to?: string;
  } = {}) {
    return api
      .get<ApiEnvelope<PeakTimesPayload>>('/dashboards/peak-times', { params })
      .then((r) => r.data);
  },
  pantryOrders(params: {
    tenant_id?: number;
    organisation_id?: number;
    site_id?: number;
    from?: string;
    to?: string;
  } = {}) {
    return api
      .get<ApiEnvelope<PantryOrdersPayload>>('/dashboards/pantry-orders', { params })
      .then((r) => r.data);
  },
  bookingChannel(params: {
    tenant_id?: number;
    organisation_id?: number;
    site_id?: number;
    from?: string;
    to?: string;
  } = {}) {
    return api
      .get<ApiEnvelope<BookingChannelPayload>>('/dashboards/booking-channel', { params })
      .then((r) => r.data);
  },
  feedback(params: {
    tenant_id?: number;
    organisation_id?: number;
    site_id?: number;
    from?: string;
    to?: string;
  } = {}) {
    return api
      .get<ApiEnvelope<FeedbackPayload>>('/dashboards/feedback', { params })
      .then((r) => r.data);
  },
  recentActivity(params: {
    tenant_id?: number;
    organisation_id?: number;
    site_id?: number;
    limit?: number;
  } = {}) {
    return api
      .get<ApiEnvelope<RecentActivityPayload>>('/dashboards/recent-activity', { params })
      .then((r) => r.data);
  },
};
