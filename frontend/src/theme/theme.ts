import { createTheme } from '@mui/material/styles';
import type {} from '@mui/x-data-grid/themeAugmentation';

// SoCampus Desk theme — tokens mirror the approved UI prototype exactly.
// Source of truth: prototype HTML :root variables.
const INK = '#0F1B2D';
const PAPER = '#F2F4F8';
const LINE = '#E2E6EE';
const LINE2 = '#CBD2DE';
const TEXT = '#1C2433';
const MUTED = '#667089';
const INDIGO = '#3657E8';
const INDIGO_INK = '#1E3AB5';
const TEAL = '#0E8C7F';
const AMBER = '#D98A0B';
const CORAL = '#D8432A';

const DISPLAY = '"Space Grotesk", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const BODY = '"IBM Plex Sans", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: INDIGO, dark: INDIGO_INK, contrastText: '#fff' },
    secondary: { main: TEAL, contrastText: '#fff' },
    success: { main: TEAL },
    warning: { main: AMBER },
    error: { main: CORAL },
    background: { default: PAPER, paper: '#FFFFFF' },
    text: { primary: TEXT, secondary: MUTED },
    divider: LINE,
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
        outlined: { borderColor: LINE2, color: TEXT, '&:hover': { backgroundColor: PAPER, borderColor: LINE2 } },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
        outlined: { borderColor: LINE },
        elevation1: { boxShadow: '0 1px 2px rgba(15,27,45,.06), 0 6px 20px -8px rgba(15,27,45,.12)' },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          border: `1px solid ${LINE}`,
          boxShadow: '0 1px 2px rgba(15,27,45,.06), 0 6px 20px -8px rgba(15,27,45,.12)',
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 9,
          backgroundColor: '#fff',
          '& .MuiOutlinedInput-notchedOutline': { borderColor: LINE2 },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: LINE2 },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: INDIGO, borderWidth: 1.5 },
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
            color: MUTED,
            fontWeight: 600,
            borderBottom: `1px solid ${LINE}`,
            whiteSpace: 'nowrap',
          },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: { root: { borderBottom: `1px solid ${LINE}` } },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: { backgroundColor: INK, fontSize: 12, borderRadius: 8, padding: '6px 10px' },
      },
    },
    // Master tables (CrudTable + list pages) — prototype table skin:
    // uppercase muted headers, hairline rows, soft hover, rounded card frame.
    MuiDataGrid: {
      styleOverrides: {
        root: {
          border: `1px solid ${LINE}`,
          borderRadius: 12,
          backgroundColor: '#fff',
          boxShadow: '0 1px 2px rgba(15,27,45,.06), 0 6px 20px -8px rgba(15,27,45,.12)',
          '--DataGrid-rowBorderColor': LINE,
        },
        columnHeaders: {
          borderBottom: `1px solid ${LINE}`,
        },
        columnHeader: {
          backgroundColor: '#fff',
          '&:focus, &:focus-within': { outline: 'none' },
        },
        columnHeaderTitle: {
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '.08em',
          color: MUTED,
          fontWeight: 600,
        },
        columnSeparator: { display: 'none' },
        cell: {
          borderTop: `1px solid ${LINE}`,
          fontSize: 13,
          '&:focus, &:focus-within': { outline: 'none' },
        },
        row: {
          '&:hover': { backgroundColor: '#FAFBFD' },
          '&.Mui-selected': { backgroundColor: '#E7ECFF', '&:hover': { backgroundColor: '#E7ECFF' } },
        },
        footerContainer: { borderTop: `1px solid ${LINE}` },
        toolbarContainer: { padding: '10px 12px', gap: 8 },
      },
    },
  },
});

export default theme;
