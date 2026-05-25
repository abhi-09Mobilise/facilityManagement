// Tailwind class merge helper. clsx handles conditional class composition,
// tailwind-merge resolves conflicting Tailwind utilities so the LAST one wins
// (e.g. cn('px-2', 'px-4') -> 'px-4'). Standard shadcn boilerplate.

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
