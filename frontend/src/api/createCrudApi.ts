import api from './client';
import type { ApiEnvelope, Paginated } from '@/types';

/**
 * Tiny factory that produces the standard CRUD surface for a module.
 * Most module APIs are 3-5 lines because of this.
 *
 *   const sitesApi = createCrudApi<Site>('/sites');
 *   sitesApi.list({ tenant_id: 7 });
 *   sitesApi.getOne(3);
 *   sitesApi.create({ name: 'HQ', ... });
 *   sitesApi.update(3, { name: 'HQ-2' });
 *   sitesApi.remove(3);
 *
 * Pass `paginatedList: false` for endpoints that return a flat array
 * instead of a paginated envelope.
 */
export interface CrudFactoryOpts {
  paginatedList?: boolean;
  idKey?: string; // for resources with non-numeric keys (e.g. currencies.code)
}

export function createCrudApi<T, ListResp = Paginated<T>>(
  basePath: string,
  opts: CrudFactoryOpts = {}
) {
  const idKey = opts.idKey || 'id';

  function clean<O extends Record<string, unknown>>(obj?: O): Record<string, unknown> | undefined {
    if (!obj) return undefined;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj)) {
      const v = (obj as Record<string, unknown>)[k];
      if (v !== '' && v !== undefined && v !== null) out[k] = v;
    }
    return out;
  }

  return {
    list(params?: Record<string, unknown>) {
      return api
        .get<ApiEnvelope<ListResp>>(basePath, { params: clean(params) })
        .then((r) => r.data);
    },
    getOne(id: number | string) {
      return api
        .get<ApiEnvelope<T>>(`${basePath}/${id}`)
        .then((r) => r.data);
    },
    create(body: Partial<T> & Record<string, unknown>) {
      return api
        .post<ApiEnvelope<{ id?: number; [k: string]: unknown }>>(basePath, body)
        .then((r) => r.data);
    },
    update(id: number | string, body: Partial<T> & Record<string, unknown>) {
      return api
        .put<ApiEnvelope>(`${basePath}/${id}`, body)
        .then((r) => r.data);
    },
    remove(id: number | string) {
      return api
        .delete<ApiEnvelope>(`${basePath}/${id}`)
        .then((r) => r.data);
    },
    idKey,
  };
}
