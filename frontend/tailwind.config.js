/** @type {import('tailwindcss').Config} */
export default {
  // shadcn/ui uses the "class" strategy so we can opt into dark mode later
  // by toggling a class on <html>. Leave it off by default.
  darkMode: ['class'],

  // Scan every TS/TSX/JS/JSX file in src/ for class names so Tailwind purges
  // unused utilities at build time.
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],

  theme: {
    container: {
      center: true,
      padding: '1.5rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      // Brand palette. Navy mirrors what the LoginPage was already using
      // hard-coded; the rest of the scale is shadcn's neutral set wired to
      // CSS variables so theme overrides are easy later.
      fontFamily: {
        display: ['"Space Grotesk"', '"Segoe UI"', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
        sans:    ['"IBM Plex Sans"', '"Segoe UI"', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
        mono:    ['"IBM Plex Mono"', 'ui-monospace', '"SF Mono"', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(15,27,45,.06), 0 6px 20px -8px rgba(15,27,45,.12)',
      },
      colors: {
        // SoCampus Desk prototype palette (source of truth: UI prototype HTML)
        ink:   { DEFAULT: '#0F1B2D', 2: '#172640' },
        paper: '#F2F4F8',
        line:  { DEFAULT: '#E2E6EE', 2: '#CBD2DE' },
        inktext: '#1C2433',
        mutedx: '#667089',
        faint:  '#98A2B8',
        indigo: { DEFAULT: '#3657E8', soft: '#E7ECFF', ink: '#1E3AB5' },
        teal:   { DEFAULT: '#0E8C7F', soft: '#DCF3EE', ink: '#0A6B61' },
        amber:  { DEFAULT: '#D98A0B', soft: '#FFF0D3', ink: '#9A6100' },
        coral:  { DEFAULT: '#D8432A', soft: '#FBE4DF', ink: '#A42E1B' },
        violet: { DEFAULT: '#7A3BE8', soft: '#EFE6FF' },
        // Legacy brand aliases -> remapped to the new palette so every
        // existing `bg-brand-navy` / `bg-brand-surface` class restyles
        // itself without touching page markup.
        brand: {
          navy:        '#0F1B2D',                 // was #1a3a6e -> ink
          'navy-dark': '#172640',                 // -> ink-2
          'navy-soft': 'rgba(54, 87, 232, 0.10)', // -> indigo tint
          surface:     '#F2F4F8',                 // -> paper
        },
        // shadcn-style semantic tokens. The actual values live in globals.css
        // as HSL CSS variables so we can theme without touching the config.
        border:       'hsl(var(--border))',
        input:        'hsl(var(--input))',
        ring:         'hsl(var(--ring))',
        background:   'hsl(var(--background))',
        foreground:   'hsl(var(--foreground))',
        primary: {
          DEFAULT:    'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT:    'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT:    'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT:    'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT:    'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT:    'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT:    'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
        'accordion-up':   { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up':   'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
