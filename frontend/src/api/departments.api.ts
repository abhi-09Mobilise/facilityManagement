import { createCrudApi } from './createCrudApi';
import type { Department } from '@/types';

export const departmentsApi = createCrudApi<Department, Department[]>('/departments');
