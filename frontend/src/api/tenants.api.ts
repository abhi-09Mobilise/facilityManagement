import { createCrudApi } from './createCrudApi';
import type { Tenant } from '@/types';

export const tenantsApi = createCrudApi<Tenant>('/tenants');
