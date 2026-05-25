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

export const publicApi = {
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
