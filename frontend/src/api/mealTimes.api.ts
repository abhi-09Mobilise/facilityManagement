import { createCrudApi } from './createCrudApi';
import type { MealTime } from '@/types';

export const mealTimesApi = createCrudApi<MealTime, MealTime[]>('/meal-times');
