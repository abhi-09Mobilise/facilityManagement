// Login page - split-panel layout, now Tailwind + shadcn instead of MUI.
//
// Visual parity with the previous MUI version:
//   - Left (>= md):  navy brand panel with the FMS title + tagline +
//                    SVG city illustration with floating icon chips.
//   - Right (always): white form panel with building badge, "Welcome
//                    Back!" heading, icon-prefixed inputs, password eye
//                    toggle, Forgot link, Login button, "or" Contact
//                    Administrator footer.
// Behaviour preserved: login(), error formatting, ?next= deep-link bounce.

import { useState } from 'react';
import {
  Building2, User as UserIcon, Lock, Eye, EyeOff,
  Zap, Wrench, Droplet, ShieldCheck, ClipboardCheck,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useNavigate, useLocation, Link as RouterLink } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

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
    <div className="min-h-screen flex items-center justify-center bg-brand-surface md:p-6">
      <div className={cn(
        'w-full max-w-[1100px] bg-white overflow-hidden',
        'flex flex-col md:flex-row',
        'min-h-screen md:min-h-[620px]',
        'md:rounded-2xl md:shadow-[0_12px_40px_rgba(20,46,87,0.12)]'
      )}>
        {/* ---------------- LEFT: navy brand panel ---------------- */}
        <div className="hidden md:flex md:basis-1/2 md:flex-col relative bg-brand-navy text-white p-10">
          <h1 className="text-4xl font-extrabold leading-tight mb-2">
            Facility<br />Management<br />System
          </h1>
          <p className="text-base opacity-80">
            Smart facilities. Seamless management.
          </p>

          <div className="mt-auto relative flex justify-center min-h-[340px]">
            <CityIllustration />
            <FloatingIcon top="12%" left="48%"><Wrench className="h-5 w-5 text-brand-navy" /></FloatingIcon>
            <FloatingIcon top="40%" left="14%"><Zap className="h-5 w-5 text-brand-navy" /></FloatingIcon>
            <FloatingIcon top="38%" right="14%"><Droplet className="h-5 w-5 text-brand-navy" /></FloatingIcon>
            <FloatingIcon top="70%" left="8%"><ShieldCheck className="h-5 w-5 text-brand-navy" /></FloatingIcon>
            <FloatingIcon top="68%" right="20%"><ClipboardCheck className="h-5 w-5 text-brand-navy" /></FloatingIcon>
          </div>
        </div>

        {/* ---------------- RIGHT: form panel ---------------- */}
        <div className="flex flex-col justify-center basis-full md:basis-1/2 p-8 md:p-12">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-lg bg-brand-navy-soft">
            <Building2 className="h-8 w-8 text-brand-navy" />
          </div>

          <h2 className="text-center text-3xl font-extrabold text-brand-navy mb-1">
            OpsSphere!
          </h2>
          <p className="text-center text-sm text-muted-foreground mb-8">
            Login to continue to your account
          </p>

          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="username">Username</Label>
              <div className="relative">
                <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="username"
                  required autoFocus
                  placeholder="Enter your username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  required
                  type={showPwd ? 'text' : 'password'}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 pr-10"
                />
                <button
                  type="button"
                  aria-label={showPwd ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPwd((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="text-right">
              <RouterLink
                to="/forgot-password"
                className="text-sm font-semibold text-brand-navy hover:underline"
              >
                Forgot Password?
              </RouterLink>
            </div>

            <Button
              type="submit"
              disabled={loading}
              size="lg"
              className="w-full text-base"
            >
              {loading ? 'Signing in...' : 'Login'}
            </Button>

            <div className="flex items-center gap-3 my-2">
              <Separator className="flex-1" />
              <span className="text-xs text-muted-foreground">or</span>
              <Separator className="flex-1" />
            </div>

            <p className="text-center text-sm text-muted-foreground">
              Need help?{' '}
              <RouterLink to="/register" className="font-semibold text-brand-navy hover:underline">
                Contact Administrator
              </RouterLink>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}

// --------- presentational helpers ---------

function FloatingIcon({ children, top, left, right }: {
  children: React.ReactNode;
  top?: string; left?: string; right?: string;
}) {
  return (
    <div
      className="absolute h-11 w-11 rounded-full bg-white flex items-center justify-center shadow-[0_4px_12px_rgba(0,0,0,0.25)]"
      style={{ top, left, right }}
    >
      {children}
    </div>
  );
}

// Inline SVG illustration. Same shapes as the MUI version - just sitting
// inside a Tailwind container.
function CityIllustration() {
  return (
    <svg viewBox="0 0 420 320" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <g fill="#3b5a8c" opacity="0.6">
        <ellipse cx="60" cy="40" rx="22" ry="9" />
        <ellipse cx="80" cy="48" rx="18" ry="7" />
        <ellipse cx="350" cy="55" rx="24" ry="9" />
        <ellipse cx="330" cy="62" rx="16" ry="6" />
      </g>
      <g fill="none" stroke="#6b8bbf" strokeWidth="1.5" strokeDasharray="3 5" opacity="0.55">
        <path d="M 70 200 Q 210 30 350 200" />
        <path d="M 90 240 Q 210 100 330 240" />
      </g>
      <g>
        <rect x="180" y="90"  width="60"  height="180" fill="#cfe0f4" />
        <rect x="190" y="100" width="10" height="12" fill="#5878a8" />
        <rect x="210" y="100" width="10" height="12" fill="#5878a8" />
        <rect x="190" y="125" width="10" height="12" fill="#5878a8" />
        <rect x="210" y="125" width="10" height="12" fill="#5878a8" />
        <rect x="190" y="150" width="10" height="12" fill="#5878a8" />
        <rect x="210" y="150" width="10" height="12" fill="#5878a8" />
        <rect x="190" y="175" width="10" height="12" fill="#5878a8" />
        <rect x="210" y="175" width="10" height="12" fill="#5878a8" />
        <rect x="190" y="200" width="10" height="12" fill="#5878a8" />
        <rect x="210" y="200" width="10" height="12" fill="#5878a8" />
        <rect x="190" y="225" width="10" height="12" fill="#5878a8" />
        <rect x="210" y="225" width="10" height="12" fill="#5878a8" />
        <rect x="100" y="160" width="80"  height="110" fill="#a9c4e6" />
        <rect x="115" y="180" width="14" height="14" fill="#3b5a8c" />
        <rect x="142" y="180" width="14" height="14" fill="#3b5a8c" />
        <rect x="115" y="210" width="14" height="14" fill="#3b5a8c" />
        <rect x="142" y="210" width="14" height="14" fill="#3b5a8c" />
        <rect x="240" y="140" width="70"  height="130" fill="#a9c4e6" />
        <rect x="252" y="160" width="14" height="14" fill="#3b5a8c" />
        <rect x="280" y="160" width="14" height="14" fill="#3b5a8c" />
        <rect x="252" y="190" width="14" height="14" fill="#3b5a8c" />
        <rect x="280" y="190" width="14" height="14" fill="#3b5a8c" />
        <rect x="252" y="220" width="14" height="14" fill="#3b5a8c" />
        <rect x="280" y="220" width="14" height="14" fill="#3b5a8c" />
        <rect x="310" y="200" width="55"  height="70"  fill="#cfe0f4" />
        <rect x="320" y="215" width="10" height="10" fill="#5878a8" />
        <rect x="340" y="215" width="10" height="10" fill="#5878a8" />
        <rect x="320" y="235" width="10" height="10" fill="#5878a8" />
        <rect x="340" y="235" width="10" height="10" fill="#5878a8" />
      </g>
      <g fill="#6b8bbf">
        <circle cx="70"  cy="260" r="14" />
        <circle cx="85"  cy="265" r="10" />
        <circle cx="380" cy="265" r="12" />
        <circle cx="395" cy="270" r="9"  />
      </g>
      <line x1="0" y1="270" x2="420" y2="270" stroke="#3b5a8c" strokeWidth="2" />
    </svg>
  );
}
