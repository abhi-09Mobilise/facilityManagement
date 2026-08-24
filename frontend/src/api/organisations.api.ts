import { createCrudApi } from './createCrudApi';
import type { Organisation } from '@/types';

// Standard CRUD wrapper. The extras (list/add/remove admins) will land in a
// later stage — Stage 3 only needs the basic CRUD.
export const organisationsApi = createCrudApi<Organisation>('/organisations');
