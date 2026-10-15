// Chart-chrome colors (grid lines, axis tick text, tooltip surface) chosen
// to match the current light/dark theme. Recharts props expect raw color
// strings — they don't resolve CSS vars — so each chart calls this hook
// and threads the returned values into stroke/fill/contentStyle props.

import { useMemo } from 'react';
import { useThemeMode } from '@/context/ThemeContext';

export interface ChartColors {
  grid: string;        // CartesianGrid stroke
  tick: string;        // XAxis / YAxis tick text fill
  axisLine: string;    // axis line stroke (if drawn)
  tooltipBg: string;   // Tooltip surface
  tooltipText: string; // Tooltip label color
  cursor: string;      // Tooltip cursor line
  // Chip-style soft bg + ink text for annotation cards.
  softBg: string;
  softFg: string;
}

export function useChartColors(): ChartColors {
  const { mode } = useThemeMode();
  return useMemo<ChartColors>(() => {
    if (mode === 'dark') {
      return {
        grid: '#1e2a3c',
        tick: '#8a98b0',
        axisLine: '#2a3a52',
        tooltipBg: '#141e2e',
        tooltipText: '#e6edf5',
        cursor: '#2a3a52',
        softBg: '#1e2a3c',
        softFg: '#cbd5e3',
      };
    }
    return {
      grid: '#e2e8f0',
      tick: '#64748b',
      axisLine: '#cbd5e1',
      tooltipBg: '#1e293b',
      tooltipText: '#f8fafc',
      cursor: '#cbd5e1',
      softBg: '#f1f5f9',
      softFg: '#334155',
    };
  }, [mode]);
}
