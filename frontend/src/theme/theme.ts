import { createTheme } from '@mui/material/styles';

// Picked colors close to the existing Socampus look-and-feel.
const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#2A295C' },   // matches the existing report header color
    secondary: { main: '#1976d2' },
    background: { default: '#f5f6fa' },
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h6: { fontWeight: 600 },
  },
  components: {
    MuiButton: { styleOverrides: { root: { textTransform: 'none', fontWeight: 600 } } },
    MuiPaper:  { styleOverrides: { root: { backgroundImage: 'none' } } },
  },
});

export default theme;
