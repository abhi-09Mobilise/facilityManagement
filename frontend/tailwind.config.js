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
      colors: {
        brand: {
          navy:        '#1a3a6e',
          'navy-dark': '#142e57',
          'navy-soft': 'rgba(26, 58, 110, 0.08)',
          surface:     '#eef2f7',
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
