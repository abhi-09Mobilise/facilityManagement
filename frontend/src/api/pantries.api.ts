// F06 - Pantries + menu items + facility-link API.
import api from './client';
import type { ApiEnvelope } from '@/types';

export interface Pantry {
  id: number;
  tenant_id?: number;
  site_id: number;
  site_name?: string;
  name: string;
  status: 0 | 1;
  menu_count?: number;
}

export interface PantryMenuItem {
  id?: number;
  pantry_id?: number;
  name: string;
  meal_time_id?: number | null;
  // Whether the item carries a price; when 0 the backend forces price to 0
  // so the booker-side panel can show a "Free" badge instead of a price.
  is_paid?: 0 | 1;
  price: number;
  status?: 0 | 1;
}

export interface PantryDetail extends Pantry {
  menu: PantryMenuItem[];
}

// Used by FacilityDetailPage to render the booking pantry panel.
export interface FacilityMenuPantry {
  id: number;
  name: string;
  site_id: number;
  items: { id: number; pantry_id: number; name: string; meal_time_id: number | null; price: number }[];
}

export const pantriesApi = {
  list(params?: { site_id?: number; tenant_id?: number }) {
    return api.get<ApiEnvelope<Pantry[]>>('/pantries', { params }).then((r) => r.data);
  },
  getOne(id: number) {
    return api.get<ApiEnvelope<PantryDetail>>(`/pantries/${id}`).then((r) => r.data);
  },
  create(payload: Partial<Pantry>) {
    return api.post<ApiEnvelope<{ id: number }>>('/pantries', payload).then((r) => r.data);
  },
  update(id: number, payload: Partial<Pantry>) {
    return api.put<ApiEnvelope>(`/pantries/${id}`, payload).then((r) => r.data);
  },
  remove(id: number) {
    return api.delete<ApiEnvelope>(`/pantries/${id}`).then((r) => r.data);
  },
  listMenu(id: number) {
    return api.get<ApiEnvelope<PantryMenuItem[]>>(`/pantries/${id}/menu`).then((r) => r.data);
  },
  replaceMenu(id: number, items: PantryMenuItem[]) {
    return api.put<ApiEnvelope<{ count: number }>>(`/pantries/${id}/menu`, { items }).then((r) => r.data);
  },
};

// Facility <-> pantries helpers (mounted under /facilities/:id/pantries
// + /facilities/:id/menu).
export const facilityPantriesApi = {
  list(facilityId: number) {
    return api.get<ApiEnvelope<Pantry[]>>(`/facilities/${facilityId}/pantries`).then((r) => r.data);
  },
  replace(facilityId: number, pantryIds: number[]) {
    return api.put<ApiEnvelope<{ count: number }>>(`/facilities/${facilityId}/pantries`, { pantry_ids: pantryIds })
      .then((r) => r.data);
  },
  // For the booking page - returns pantries+items linked to a facility.
  menu(facilityId: number) {
    return api.get<ApiEnvelope<FacilityMenuPantry[]>>(`/facilities/${facilityId}/pantries/menu`).then((r) => r.data);
  },
};
