// F03 - Public portal API. Hits /public/* (no auth, no /api prefix).
//
// Uses a brand-new axios instance so we don't accidentally attach a JWT
// or trigger the 401-bounce interceptor of the regular client.

import axios from 'axios';
import type { FacilityLayout, FacilityLayoutV1 } from '@/types';

const baseURL = (import.meta.env.VITE_API_BASE_URL || '');
const pub = axios.create({ baseURL });

export interface PublicTenant { name: string; slug: string; }
export interface PublicSite { id: number; name: string; address?: string; facility_count: number; }
export interface PublicFacilityCard {
  id: number; name: string; type: string; capacity: number; image_url?: string; site_name?: string;
  description?: string;
}
export interface PublicHour { day_of_week: number; open_time: string; close_time: string; }

export interface LandingPayload {
  tenant: PublicTenant;
  site_count: number;
  facility_count: number;
  featured: PublicFacilityCard[];
}
export interface SitesPayload {
  tenant: PublicTenant;
  sites: PublicSite[];
}
export interface SiteFacilitiesPayload {
  tenant: PublicTenant;
  site: { id: number; name: string; address?: string };
  facilities: PublicFacilityCard[];
}
export interface FacilityDetailPayload {
  tenant: PublicTenant;
  facility: PublicFacilityCard;
  operating_hours: PublicHour[];
}

// M15 - QR arrival check-in. Normalised outcome so the page doesn't have to
// know the success-vs-failure envelope shapes (success nests the card under
// `data`; failure spreads it at the top level alongside `code`).
export interface CheckinOutcome {
  ok: boolean;
  msg: string;
  code?: string;          // CHECKIN_* reason on failure
  already?: boolean;      // true if they were already checked in
  facility_name?: string;
  facility_type?: string;
  start_at?: string;
  end_at?: string;
  checked_in_at?: string;
  checked_out_at?: string;
}

// Shared parser for /public/checkin + /public/checkout (same envelope shapes).
function parseCheckinOutcome(data: unknown): CheckinOutcome {
  const b: Record<string, unknown> = (data as Record<string, unknown>) || {};
  const card = (b.data as Record<string, unknown>) || b;
  return {
    ok: !!b.status,
    msg: (b.msg as string) || (b.status ? 'Done' : 'Request failed'),
    code: b.code as string | undefined,
    already: card.already as boolean | undefined,
    facility_name: card.facility_name as string | undefined,
    facility_type: card.facility_type as string | undefined,
    start_at: card.start_at as string | undefined,
    end_at: card.end_at as string | undefined,
    checked_in_at: card.checked_in_at as string | undefined,
    checked_out_at: card.checked_out_at as string | undefined,
  };
}

// Builds the request body for /public/checkin + /public/checkout. When a
// wall QR encodes `?facility=<id>`, the page forwards it as
// `scope_facility_id` so the backend can reject a code whose booking is
// for a different facility. Omitted entirely when the kiosk is unscoped
// (legacy generic QR still works).
function checkinBody(code: string, scopeFacilityId?: number | null): Record<string, unknown> {
  const body: Record<string, unknown> = { code };
  if (scopeFacilityId != null) body.scope_facility_id = scopeFacilityId;
  return body;
}

export const publicApi = {
  // validateStatus lets us read the JSON body on 4xx (window/approval errors)
  // instead of axios throwing before we can show a friendly reason.
  checkin: (code: string, scopeFacilityId?: number | null): Promise<CheckinOutcome> =>
    pub
      .post('/public/checkin', checkinBody(code, scopeFacilityId), { validateStatus: () => true })
      .then((r) => parseCheckinOutcome(r.data)),
  checkout: (code: string, scopeFacilityId?: number | null): Promise<CheckinOutcome> =>
    pub
      .post('/public/checkout', checkinBody(code, scopeFacilityId), { validateStatus: () => true })
      .then((r) => parseCheckinOutcome(r.data)),
  landing: (slug: string) =>
    pub.get<{ status: boolean; data?: LandingPayload; msg?: string }>(`/public/t/${encodeURIComponent(slug)}`).then((r) => r.data),
  sites: (slug: string) =>
    pub.get<{ status: boolean; data?: SitesPayload; msg?: string }>(`/public/t/${encodeURIComponent(slug)}/sites`).then((r) => r.data),
  siteFacilities: (slug: string, siteId: number) =>
    pub.get<{ status: boolean; data?: SiteFacilitiesPayload; msg?: string }>(
      `/public/t/${encodeURIComponent(slug)}/sites/${siteId}/facilities`
    ).then((r) => r.data),
  facility: (slug: string, id: number) =>
    pub.get<{ status: boolean; data?: FacilityDetailPayload; msg?: string }>(
      `/public/t/${encodeURIComponent(slug)}/facilities/${id}`
    ).then((r) => r.data),
  // Email-driven feedback — token encodes bookingId + userId, signed by
  // the backend. No auth required; token IS the proof of identity.
  getRatingBooking: (token: string) =>
    pub.get<{
      status: boolean;
      msg?: string;
      data?: {
        booking: {
          id: number;
          facility_name: string;
          facility_type: string;
          site_name: string | null;
          start_at: string;
          end_at: string;
        };
        existing_rating: {
          stars: number;
          comment: string | null;
          tags: string[];
        } | null;
      };
    }>(`/public/ratings/${encodeURIComponent(token)}`, { validateStatus: () => true })
      .then((r) => r.data),
  submitRating: (token: string, payload: { stars: number; comment?: string; tags?: string[] }) =>
    pub.post<{ status: boolean; msg?: string }>(
      `/public/ratings/${encodeURIComponent(token)}`, payload, { validateStatus: () => true }
    ).then((r) => r.data),
};

// ===== doc 11 - Kiosk booking (public; pick tenant -> organisation -> facility)
export interface KioskTenant { id: number; name: string; }
export interface KioskOrg { id: number; name: string; }
export interface KioskSite { id: number; name: string; address?: string | null; }
export interface KioskFacilityCard {
  id: number; name: string; type: string; capacity: number;
  image_url?: string | null; site_name?: string; floor_name?: string | null;
}
export interface KioskFacilityDetail {
  id: number; name: string; type: string; capacity: number;
  // Raw layout for the desk canvas — DeskPicker accepts string/object/legacy/null.
  layout_json: string | FacilityLayout | FacilityLayoutV1 | null;
}
export interface KioskCheck {
  conflict?: boolean; mode?: string; capacity?: number;
  seats_remaining?: number; occupied_desks?: string[];
}
export interface KioskSlot { start: string; end: string; conflict: boolean; seats_taken: number; seats_remaining: number; }
export interface KioskDay { facility_id: number; date: string; mode: string; capacity: number; slots: KioskSlot[]; closed?: boolean; }
export interface KioskIdentity { id: number; name: string | null; masked_email: string | null; }

type Env<T> = { status: boolean; msg?: string; code?: string; data?: T };
const vs = { validateStatus: () => true as const };

export const kioskApi = {
  tenants: () =>
    pub.get<Env<{ tenants: KioskTenant[] }>>('/public/kiosk/tenants', vs).then((r) => r.data),
  organisations: (tenantId: number) =>
    pub.get<Env<{ tenant: KioskTenant; organisations: KioskOrg[] }>>('/public/kiosk/organisations', { params: { tenant_id: tenantId }, ...vs }).then((r) => r.data),
  sites: (tenantId: number, orgId: number) =>
    pub.get<Env<{ sites: KioskSite[] }>>('/public/kiosk/sites', { params: { tenant_id: tenantId, org_id: orgId }, ...vs }).then((r) => r.data),
  facilities: (tenantId: number, siteId: number) =>
    pub.get<Env<{ site: KioskSite; facilities: KioskFacilityCard[] }>>('/public/kiosk/facilities', { params: { tenant_id: tenantId, site_id: siteId }, ...vs }).then((r) => r.data),
  facilityDetail: (tenantId: number, facilityId: number) =>
    pub.get<Env<{ facility: KioskFacilityDetail }>>(`/public/kiosk/facilities/${facilityId}`, { params: { tenant_id: tenantId }, ...vs }).then((r) => r.data),
  check: (tenantId: number, facilityId: number, startAt: string, endAt: string) =>
    pub.get<Env<KioskCheck>>(`/public/kiosk/facilities/${facilityId}/check`, { params: { tenant_id: tenantId, start_at: startAt, end_at: endAt }, ...vs }).then((r) => r.data),
  day: (tenantId: number, facilityId: number, date: string) =>
    pub.get<Env<KioskDay>>(`/public/kiosk/facilities/${facilityId}/day`, { params: { tenant_id: tenantId, date }, ...vs }).then((r) => r.data),
  identify: (tenantId: number, identifier: string) =>
    pub.post<Env<{ user: KioskIdentity }>>('/public/kiosk/identify', { tenant_id: tenantId, identifier }, vs).then((r) => r.data),
  book: (tenantId: number, payload: {
    facility_id: number; start_at: string; end_at: string; title?: string;
    assignments: { identifier: string; desk_id?: string | null }[];
  }) =>
    pub.post<Env<KioskBookResult>>('/public/kiosk/book', { tenant_id: tenantId, ...payload }, vs).then((r) => r.data),
};

export interface KioskBookResult {
  results: { identifier: string; desk_id: string | null; ok: boolean; status: string | null; msg: string | null }[];
  booked: number;
  total: number;
  all_ok: boolean;
}
