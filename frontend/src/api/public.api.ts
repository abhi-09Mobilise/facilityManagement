// F03 - Public portal API. Hits /public/* (no auth, no /api prefix).
//
// Uses a brand-new axios instance so we don't accidentally attach a JWT
// or trigger the 401-bounce interceptor of the regular client.

import axios from 'axios';

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
}

export const publicApi = {
  // validateStatus lets us read the JSON body on 4xx (window/approval errors)
  // instead of axios throwing before we can show a friendly reason.
  checkin: (code: string): Promise<CheckinOutcome> =>
    pub
      .post('/public/checkin', { code }, { validateStatus: () => true })
      .then((r) => {
        const b: Record<string, unknown> = r.data || {};
        const card = (b.data as Record<string, unknown>) || b;
        return {
          ok: !!b.status,
          msg: (b.msg as string) || (b.status ? 'Checked in' : 'Check-in failed'),
          code: b.code as string | undefined,
          already: card.already as boolean | undefined,
          facility_name: card.facility_name as string | undefined,
          facility_type: card.facility_type as string | undefined,
          start_at: card.start_at as string | undefined,
          end_at: card.end_at as string | undefined,
          checked_in_at: card.checked_in_at as string | undefined,
        };
      }),
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
};
