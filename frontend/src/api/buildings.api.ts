// Buildings CRUD — Phase B layer between Site and Floor.
// Backend module lives at /buildings and mirrors the standard paginated
// list envelope, so the one-liner factory is all we need.

import { createCrudApi } from './createCrudApi';
import type { Building } from '@/types';

export const buildingsApi = createCrudApi<Building>('/buildings');
