import api from './client';
import type {
  ApiEnvelope, Paginated, LiveBooking, CreateBookingPayload, BookingStatus,
} from '@/types';

export interface BookingListFilters {
  page?: number;
  limit?: number;
  scope?: 'mine' | 'tenant' | 'team';
  status?: BookingStatus;
  facility_id?: number;
  from_date?: string;
  to_date?: string;
  tenant_id?: number;
}

// /bookings/check now returns capacity-aware fields. `conflict` is preserved
// for backwards compatibility - true if the candidate booking doesn't fit.
export interface BookingCheckResult {
  conflict: boolean;
  mode: 'exclusive' | 'shared';
  capacity: number;
  seats_taken: number;
  seats_remaining: number;
  // F09 - chair ids already claimed in this exact window (across all
  // pending/approved/completed bookings for the facility). Empty for
  // facilities without a desk layout.
  occupied_desks?: string[];
}

// F07 - response from GET /bookings/:id/act
export interface BookingActResult {
  id: number;
  action: 'cancel' | 'reschedule';
  booking_id?: number;
}

export const bookingsApi = {
  list(filters: BookingListFilters = {}) {
    return api
      .get<ApiEnvelope<Paginated<LiveBooking>>>('/bookings', { params: filters })
      .then((r) => r.data);
  },
  getOne(id: number) {
    return api.get<ApiEnvelope<LiveBooking>>(`/bookings/${id}`).then((r) => r.data);
  },
  create(payload: CreateBookingPayload) {
    return api
      .post<ApiEnvelope<{ id: number; status: BookingStatus }>>('/bookings', payload)
      .then((r) => r.data);
  },
  cancel(id: number) {
    return api.post<ApiEnvelope>(`/bookings/${id}/cancel`).then((r) => r.data);
  },
  // attendees defaults to 1 (the booker). Pass 1 + guests.length to find out
  // whether the full party will fit in a shared facility.
  check(params: { facility_id: number; start_at: string; end_at: string; attendees?: number }) {
    return api
      .get<ApiEnvelope<BookingCheckResult>>('/bookings/check', { params })
      .then((r) => r.data);
  },

  // F07 - reschedule / cancel via mail
  //
  // Hit GET /:id/act?token=&action= first (after login bounce). On cancel
  // it cancels immediately and returns ok. On reschedule it returns ok
  // and the UI should then render the form, then POST /:id/reschedule.
  act(id: number, token: string, action: 'cancel' | 'reschedule') {
    return api
      .get<ApiEnvelope<BookingActResult>>(`/bookings/${id}/act`, { params: { token, action } })
      .then((r) => r.data);
  },
  reschedule(id: number, payload: { token: string; start_at: string; end_at: string }) {
    return api
      .post<ApiEnvelope<{ id: number; start_at: string; end_at: string }>>(
        `/bookings/${id}/reschedule`,
        payload
      )
      .then((r) => r.data);
  },
};
