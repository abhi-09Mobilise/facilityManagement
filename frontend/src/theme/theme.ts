import { createTheme, type Theme } from '@mui/material/styles';
import type {} from '@mui/x-data-grid/themeAugmentation';

// SoCampus Desk theme — tokens mirror the approved UI prototype exactly.
// Source of truth: prototype HTML :root variables.
//
// Dark variant: same shape, re-mapped tokens. The MUI theme is produced via
// createAppTheme(mode) so <ThemeContext> can swap it reactively.

interface Palette {
  INK: string; INK_2: string;
  PAPER: string;         // app background
  CARD: string;          // panel surface (lighter than PAPER in dark mode)
  LINE: string; LINE2: string;
  TEXT: string; MUTED: string;
  INDIGO: string; INDIGO_INK: string;
  TEAL: string; AMBER: string; CORAL: string;
  HOVER_ROW: string;     // DataGrid hover
  SELECTED_ROW: string;  // DataGrid selected
  SHADOW: string;
}

const LIGHT: Palette = {
  INK: '#0F1B2D', INK_2: '#172640',
  PAPER: '#F2F4F8',
  CARD: '#FFFFFF',
  LINE: '#E2E6EE', LINE2: '#CBD2DE',
  TEXT: '#1C2433', MUTED: '#667089',
  INDIGO: '#3657E8', INDIGO_INK: '#1E3AB5',
  TEAL: '#0E8C7F', AMBER: '#D98A0B', CORAL: '#D8432A',
  HOVER_ROW: '#FAFBFD',
  SELECTED_ROW: '#E7ECFF',
  SHADOW: '0 1px 2px rgba(15,27,45,.06), 0 6px 20px -8px rgba(15,27,45,.12)',
};

// Dark palette — matched 1:1 with the `.dark` block in globals.css so MUI
// surfaces (DataGrid, Dialog, Paper, Chip, OutlinedInput) share the same
// contrast ratios as native Tailwind components. Updating one requires the
// other to be nudged too — otherwise MUI tables will look washed out next
// to Tailwind cards (or vice-versa).
const DARK: Palette = {
  INK: '#E6EDF5', INK_2: '#CBD5E3',
  PAPER: '#0A121D',
  CARD: '#1A2538',
  LINE: '#2A3A52', LINE2: '#3A4D6A',
  TEXT: '#EEF2F8', MUTED: '#A1AEC3',
  INDIGO: '#6E89F2', INDIGO_INK: '#B9C7FF',
  TEAL: '#3BC2AE', AMBER: '#ECAE3C', CORAL: '#EC7560',
  HOVER_ROW: '#232F45',
  SELECTED_ROW: '#1F2E5A',
  SHADOW: '0 1px 2px rgba(0,0,0,.5), 0 10px 24px -8px rgba(0,0,0,.7)',
};

const DISPLAY = '"Space Grotesk", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const BODY = '"IBM Plex Sans", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export function createAppTheme(mode: 'light' | 'dark'): Theme {
  const p = mode === 'dark' ? DARK : LIGHT;

  return createTheme({
    palette: {
      mode,
      primary: { main: p.INDIGO, dark: p.INDIGO_INK, contrastText: '#fff' },
      secondary: { main: p.TEAL, contrastText: '#fff' },
      success: { main: p.TEAL },
      warning: { main: p.AMBER },
      error: { main: p.CORAL },
      background: { default: p.PAPER, paper: p.CARD },
      text: { primary: p.TEXT, secondary: p.MUTED },
      divider: p.LINE,
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: BODY,
      h1: { fontFamily: DISPLAY, fontWeight: 700, letterSpacing: '-0.01em' },
      h2: { fontFamily: DISPLAY, fontWeight: 700, letterSpacing: '-0.01em' },
      h3: { fontFamily: DISPLAY, fontWeight: 600, letterSpacing: '-0.01em' },
      h4: { fontFamily: DISPLAY, fontWeight: 600, letterSpacing: '-0.01em' },
      h5: { fontFamily: DISPLAY, fontWeight: 600, letterSpacing: '-0.01em' },
      h6: { fontFamily: DISPLAY, fontWeight: 600, letterSpacing: '-0.01em' },
      button: { textTransform: 'none', fontWeight: 500 },
    },
    components: {
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            fontWeight: 500,
            borderRadius: 9,
            boxShadow: 'none',
            '&:hover': { boxShadow: 'none' },
          },
          outlined: {
            borderColor: p.LINE2, color: p.TEXT,
            '&:hover': { backgroundColor: p.PAPER, borderColor: p.LINE2 },
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: 'none' },
          outlined: { borderColor: p.LINE },
          elevation1: { boxShadow: p.SHADOW },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            border: `1px solid ${p.LINE}`,
            boxShadow: p.SHADOW,
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 9,
            backgroundColor: p.CARD,
            '& .MuiOutlinedInput-notchedOutline': { borderColor: p.LINE2 },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: p.LINE2 },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: p.INDIGO, borderWidth: 1.5 },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { fontWeight: 600, fontSize: 11.5, borderRadius: 999 },
        },
      },
      MuiDialog: {
        styleOverrides: { paper: { borderRadius: 16 } },
      },
      MuiTableHead: {
        styleOverrides: {
          root: {
            '& .MuiTableCell-head': {
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '.08em',
              color: p.MUTED,
              fontWeight: 600,
              borderBottom: `1px solid ${p.LINE}`,
              whiteSpace: 'nowrap',
            },
          },
        },
      },
      MuiTableCell: {
        styleOverrides: { root: { borderBottom: `1px solid ${p.LINE}` } },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            backgroundColor: mode === 'dark' ? p.CARD : p.INK,
            color: mode === 'dark' ? p.TEXT : '#fff',
            fontSize: 12,
            borderRadius: 8,
            padding: '6px 10px',
            border: mode === 'dark' ? `1px solid ${p.LINE}` : 'none',
          },
        },
      },
      // Master tables (CrudTable + list pages) — prototype table skin:
      // uppercase muted headers, hairline rows, soft hover, rounded card frame.
      MuiDataGrid: {
        styleOverrides: {
          root: {
            border: `1px solid ${p.LINE}`,
            borderRadius: 12,
            backgroundColor: p.CARD,
            boxShadow: p.SHADOW,
            '--DataGrid-rowBorderColor': p.LINE,
          },
          columnHeaders: {
            borderBottom: `1px solid ${p.LINE}`,
          },
          columnHeader: {
            backgroundColor: p.CARD,
            '&:focus, &:focus-within': { outline: 'none' },
          },
          columnHeaderTitle: {
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '.08em',
            color: p.MUTED,
            fontWeight: 600,
          },
          columnSeparator: { display: 'none' },
          cell: {
            borderTop: `1px solid ${p.LINE}`,
            fontSize: 13,
            '&:focus, &:focus-within': { outline: 'none' },
          },
          row: {
            '&:hover': { backgroundColor: p.HOVER_ROW },
            '&.Mui-selected': { backgroundColor: p.SELECTED_ROW, '&:hover': { backgroundColor: p.SELECTED_ROW } },
          },
          footerContainer: { borderTop: `1px solid ${p.LINE}` },
          toolbarContainer: { padding: '10px 12px', gap: 8 },
        },
      },
    },
  });
}

// Default export preserves the pre-dark-mode import shape for anything
// that still imports the singleton. New code should pull `createAppTheme`
// via ThemeContext.
const theme = createAppTheme('light');
export default theme;
