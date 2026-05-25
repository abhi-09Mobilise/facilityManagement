import { createCrudApi } from './createCrudApi';
import type { Site } from '@/types';

export const sitesApi = createCrudApi<Site>('/sites');
