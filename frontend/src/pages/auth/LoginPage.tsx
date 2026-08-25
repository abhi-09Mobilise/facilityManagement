// Login page — SoCampus Desk prototype theme.
//
// Layout mirrors SoCampus_Login.html exactly:
//   - Left (>= md): ink brand panel — logo, feature badges, headline,
//                   desk-state grid motif (the floor-map legend as art).
//   - Right (always): white card — Sign in heading, inputs with focus ring,
//                     password eye toggle, remember-me, Forgot link, button.
// Behaviour preserved from the previous version: login(), error formatting,
// ?next= deep-link bounce, /forgot-password and /register routes.

import { useState } from 'react';
import { Building2, Eye, EyeOff, User as UserIcon, Lock } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useNavigate, useLocation, Link as RouterLink } from 'react-router-dom';
import { cn } from '@/lib/utils';

// Desk-state motif cells: teal outline = free, indigo = checked-in,
// indigo tint = booked, amber tint = pending, hatch = blocked.
const MOTIF: Array<'free' | 'in' | 'book' | 'pend' | 'blk'> = [
  'in', 'free', 'book', 'free', 'pend', 'free',
  'free', 'in', 'free', 'blk', 'free', 'book',
  'book', 'free', 'in', 'free', 'free', 'pend',
];

const MOTIF_CLASS: Record<string, string> = {
  free: 'border-teal bg-transparent',
  in:   'border-indigo bg-indigo',
  book: 'border-indigo bg-indigo/30',
  pend: 'border-amber bg-amber/25',
  blk:  'border-white/25 bg-[repeating-linear-gradient(45deg,rgba(255,255,255,.16),rgba(255,255,255,.16)_2px,transparent_2px,transparent_5px)]',
};

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const loc = useLocation();
  // Prefer ?next= (used by deep links like /approvals/act?token=...).
  const nextParam = new URLSearchParams(loc.search).get('next');
  const from = nextParam || (loc.state as { from?: string } | null)?.from || '/';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login({ username, password });
      navigate(from, { replace: true });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { msg?: string } } })?.response?.data?.msg ||
        (err as Error)?.message ||
        'Login failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-2 bg-paper">
      {/* ---------------- LEFT: ink brand panel ---------------- */}
      <aside className="relative hidden md:flex flex-col justify-between overflow-hidden bg-ink p-12 text-white">
        {/* radial glows, as in the prototype */}
        <div
          className="pointer-events-none absolute -right-36 -bottom-44 h-[460px] w-[460px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(54,87,232,.5), transparent 65%)' }}
        />
        <div
          className="pointer-events-none absolute -left-32 -top-40 h-[380px] w-[380px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(14,140,127,.35), transparent 65%)' }}
        />

        <div className="relative z-[1] flex items-center gap-3">
          <div className="grid h-[38px] w-[38px] place-items-center rounded-[11px] border border-white/[.18] bg-white/10">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <div className="font-display text-[19px] font-bold tracking-tight">SoCampus Desk</div>
            <div className="text-xs text-[#8FA0BA]">Workplace booking · Mobilise App Lab</div>
          </div>
        </div>

        <div className="relative z-[1] max-w-[420px]">
          <div className="mb-3.5 flex flex-wrap gap-2">
            {['QR check-in', 'Auto-release', 'Live floor maps', 'Approvals'].map((b) => (
              <span
                key={b}
                className="rounded-full border border-white/[.16] bg-white/[.06] px-3 py-1 text-[11.5px] font-medium text-[#DCE3F0]"
              >
                {b}
              </span>
            ))}
          </div>
          <h1 className="font-display text-[34px] font-bold leading-[1.15] tracking-tight">
            Your desk knows when you've arrived.
          </h1>
          <p className="mt-3.5 text-[14.5px] text-[#B8C3D6]">
            Book a desk near your team, check in with a scan, and let unused desks free
            themselves. Facilities sees occupancy live.
          </p>
          <div className="mt-8 grid w-max grid-cols-6 gap-2" aria-hidden>
            {MOTIF.map((m, i) => (
              <i key={i} className={cn('h-6 w-[34px] rounded-[5px] border-[1.4px]', MOTIF_CLASS[m])} />
            ))}
          </div>
        </div>

        <div className="relative z-[1] text-xs text-[#8FA0BA]">
          Multi-tenant · role-based access · every booking audited
        </div>
      </aside>

      {/* ---------------- RIGHT: form panel ---------------- */}
      <main className="grid place-items-center p-6">
        <div className="w-full max-w-[400px]">
          <div className="rounded-2xl border border-line bg-card p-7 shadow-card">
            {/* Mobile-only mini brand */}
            <div className="mb-5 flex items-center gap-2.5 md:hidden">
              <div className="grid h-[30px] w-[30px] place-items-center rounded-[9px] bg-ink text-white">
                <Building2 className="h-4 w-4" />
              </div>
              <div className="font-display text-[15px] font-bold">SoCampus Desk</div>
            </div>

            <h2 className="font-display text-[21px] font-semibold tracking-tight">Sign in</h2>
            <p className="mb-5 mt-1 text-[13px] text-mutedx">
              Use your work account. Your role and location come from the directory.
            </p>

            {error && (
              <div className="mb-4 rounded-[10px] bg-coral-soft px-3.5 py-2.5 text-[12.5px] text-coral-ink">
                <b className="font-semibold">We couldn't sign you in.</b> {error}
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate className="space-y-3.5">
              <div className="space-y-1.5">
                <label htmlFor="username" className="text-xs font-semibold text-mutedx">
                  Username
                </label>
                <div className="relative">
                  <UserIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                  <input
                    id="username"
                    required
                    autoFocus
                    autoComplete="username"
                    placeholder="you@company.com"
                    spellCheck={false}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full rounded-[10px] border border-line-2 bg-card py-2.5 pl-10 pr-3 text-sm outline-none transition-colors focus:border-indigo focus:ring-[3px] focus:ring-indigo-soft"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="password" className="text-xs font-semibold text-mutedx">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                  <input
                    id="password"
                    required
                    type={showPwd ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-[10px] border border-line-2 bg-card py-2.5 pl-10 pr-11 text-sm outline-none transition-colors focus:border-indigo focus:ring-[3px] focus:ring-indigo-soft"
                  />
                  <button
                    type="button"
                    aria-label={showPwd ? 'Hide password' : 'Show password'}
                    onClick={() => setShowPwd((v) => !v)}
                    className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-faint hover:bg-paper hover:text-inktext"
                  >
                    {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between pb-1 pt-0.5">
                <label className="flex cursor-pointer select-none items-center gap-2 text-[12.5px] text-mutedx">
                  <input type="checkbox" defaultChecked className="h-[15px] w-[15px] accent-indigo" />
                  Keep me signed in
                </label>
                <RouterLink
                  to="/forgot-password"
                  className="text-[12.5px] font-medium text-indigo hover:underline"
                >
                  Forgot password?
                </RouterLink>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-[10px] bg-indigo px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-ink disabled:cursor-wait disabled:opacity-60"
              >
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>

            <div className="my-4 flex items-center gap-3 text-[11.5px] font-semibold uppercase tracking-[.08em] text-faint">
              <span className="h-px flex-1 bg-line" />
              or
              <span className="h-px flex-1 bg-line" />
            </div>

            <p className="text-center text-[12.5px] text-mutedx">
              Need an account?{' '}
              <RouterLink to="/register" className="font-medium text-indigo hover:underline">
                Contact your administrator
              </RouterLink>
            </p>
          </div>

          <p className="mt-4 text-center text-xs text-faint">
            Trouble signing in? Contact Workplace IT
          </p>
        </div>
      </main>
    </div>
  );
}
