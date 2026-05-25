import { createCrudApi } from './createCrudApi';
import type { Floor } from '@/types';

// Floors GET returns a flat array.
export const floorsApi = createCrudApi<Floor, Floor[]>('/floors');
