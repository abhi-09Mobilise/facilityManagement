import api from './client';
import type { ApiEnvelope, Role } from '@/types';

export type PermValue = 'yes' | 'team' | 'no';
export type MatrixRole = Exclude<Role, 'super_admin'>;

export interface PermCatalog {
  roles: MatrixRole[];
  groups: Record<string, Array<{ key: string; label: string }>>;
}

export interface PermMatrix {
  tenant_id: number | null;
  resolved: Record<MatrixRole, Record<string, PermValue>>;
  overrides: Partial<Record<MatrixRole, Record<string, PermValue>>>;
  defaults: Record<MatrixRole, Record<string, PermValue>>;
}

export interface PermChange {
  role: MatrixRole;
  permission_key: string;
  allowed: PermValue | null; // null = clear override (revert to inherited)
}

export const permissionsApi = {
  catalog() {
    return api.get<ApiEnvelope<PermCatalog>>('/permissions/catalog').then((r) => r.data);
  },
  effective() {
    return api
      .get<ApiEnvelope<{ role: Role; permissions: Record<string, PermValue> }>>('/permissions/effective')
      .then((r) => r.data);
  },
  matrix(tenantId?: number | null) {
    return api
      .get<ApiEnvelope<PermMatrix>>('/permissions/matrix', {
        params: tenantId ? { tenant_id: tenantId } : {},
      })
      .then((r) => r.data);
  },
  save(changes: PermChange[], tenantId?: number | null) {
    return api
      .put<ApiEnvelope<{ saved: number }>>('/permissions/matrix', {
        changes,
        tenant_id: tenantId || undefined,
      })
      .then((r) => r.data);
  },
};
