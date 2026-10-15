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
        // SoCampus Desk prototype palette — now wired to CSS variables so
        // the whole palette flips with the `.dark` class on <html>. Values
        // live in src/styles/globals.css (both :root and .dark blocks).
        // Note: Tailwind's `/opacity` modifier doesn't work with var() refs;
        // for the few places that need opacity on a brand token, use an
        // explicit hex (`bg-[#3657E8]/30`) or add a channel-RGB var.
        ink:   { DEFAULT: 'var(--ink)',     2: 'var(--ink-2)' },
        paper: 'var(--paper)',
        line:  { DEFAULT: 'var(--line)',    2: 'var(--line-2)' },
        inktext: 'var(--text)',
        mutedx: 'var(--muted-x)',
        faint:  'var(--faint)',
        indigo: { DEFAULT: 'var(--indigo)', soft: 'var(--indigo-soft)', ink: 'var(--indigo-ink)' },
        teal:   { DEFAULT: 'var(--teal)',   soft: 'var(--teal-soft)',   ink: 'var(--teal-ink)' },
        amber:  { DEFAULT: 'var(--amber)',  soft: 'var(--amber-soft)',  ink: 'var(--amber-ink)' },
        coral:  { DEFAULT: 'var(--coral)',  soft: 'var(--coral-soft)',  ink: 'var(--coral-ink)' },
        violet: { DEFAULT: 'var(--violet)', soft: 'var(--violet-soft)' },
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
