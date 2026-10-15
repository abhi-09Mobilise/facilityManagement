// Facility feedback ratings — authenticated client.
//
// Used by /my-bookings "Rate" modal to submit a rating and check whether
// the user already rated a given booking (so the UI can toggle between
// "Rate" and "✓ Rated" without a separate flag on the booking row).
//
// Public (token-based) submission from the email link lives in a separate
// public.ratings.api.ts client — this file is for signed-in users only.

import api from './client';
import type { ApiEnvelope } from '@/types';

export interface Rating {
  id: number;
  stars: number;         // 1-5
  comment: string | null;
  tags: string[];
  created_at: string;
}

export interface CreateRatingPayload {
  booking_id: number;
  stars: number;         // 1-5
  comment?: string;
  tags?: string[];
}

export const ratingsApi = {
  // Returns the caller's existing rating for this booking, or `null` if
  // they haven't rated yet. 404-shaped responses from the backend (not
  // the user's booking) also come back as `rating: null`.
  mineForBooking(bookingId: number) {
    return api
      .get<ApiEnvelope<{ rating: Rating | null }>>(`/ratings/mine/${bookingId}`)
      .then((r) => r.data);
  },
  // Submits or updates (upsert on booking_id) the rating for a completed
  // booking. Backend enforces status === 'completed' and user ownership.
  create(payload: CreateRatingPayload) {
    return api
      .post<ApiEnvelope<{ rating: Rating }>>('/ratings', payload)
      .then((r) => r.data);
  },
};
