import api from './client';
import type { ApiEnvelope, Currency, Locale, Timezone } from '@/types';

export const lookupsApi = {
  // Reads - any logged-in user
  currencies: () => api.get<ApiEnvelope<Currency[]>>('/lookups/currencies').then((r) => r.data),
  timezones:  () => api.get<ApiEnvelope<Timezone[]>>('/lookups/timezones').then((r) => r.data),
  locales:    () => api.get<ApiEnvelope<Locale[]>>('/lookups/locales').then((r) => r.data),

  // Writes - super_admin only
  createCurrency: (b: Partial<Currency>) =>
    api.post<ApiEnvelope>('/lookups/currencies', b).then((r) => r.data),
  updateCurrency: (code: string, b: Partial<Currency>) =>
    api.put<ApiEnvelope>(`/lookups/currencies/${code}`, b).then((r) => r.data),
  createTimezone: (b: Partial<Timezone>) =>
    api.post<ApiEnvelope>('/lookups/timezones', b).then((r) => r.data),
  createLocale: (b: Partial<Locale>) =>
    api.post<ApiEnvelope>('/lookups/locales', b).then((r) => r.data),
};
