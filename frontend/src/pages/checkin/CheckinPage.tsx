// M15 - QR arrival check-in (public, no login).
// Route: /checkin  — the single generic page every venue QR points at.
//
// Flow: scan QR -> land here -> type the check-in code from the confirmation
// email -> POST /public/checkin. Phone-first, kiosk-style: no navbar, no auth,
// large touch targets (status-report #19). The code is the only credential.

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, CheckCircle2, XCircle, Clock, QrCode } from 'lucide-react';
import { publicApi, type CheckinOutcome } from '@/api/public.api';

// "2026-10-06 09:00:00" -> "Mon 6 Oct, 09:00". Falls back to raw on parse fail.
function fmtWhen(s?: string): string {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}

// Display helper: group the 8 chars as "ABCD-2345" as the user types.
function pretty(raw: string): string {
  return raw.length > 4 ? raw.slice(0, 4) + '-' + raw.slice(4) : raw;
}

type Phase = 'form' | 'loading' | 'done';

export default function CheckinPage() {
  const [params] = useSearchParams();
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<Phase>('form');
  const [result, setResult] = useState<CheckinOutcome | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Allow a deep-link prefill (?code=...) even though the generic QR carries none.
  useEffect(() => {
    const pre = (params.get('code') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (pre) setCode(pre.slice(0, 8));
  }, [params]);

  useEffect(() => { if (phase === 'form') inputRef.current?.focus(); }, [phase]);

  function onChange(v: string) {
    // Keep only alphabet chars, uppercase, max 8 (strip the display hyphen).
    const clean = v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    setCode(clean);
    if (formError) setFormError(null);
  }

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (code.length !== 8) {
      setFormError('Enter the full 8-character code from your email.');
      return;
    }
    setPhase('loading');
    try {
      const out = await publicApi.checkin(code);
      setResult(out);
      setPhase('done');
    } catch {
      setResult({ ok: false, msg: 'Network error — please try again.' });
      setPhase('done');
    }
  }

  function reset() {
    setResult(null);
    setCode('');
    setFormError(null);
    setPhase('form');
  }

  const ok = result?.ok;
  const isWindow = result?.code === 'CHECKIN_TOO_EARLY' || result?.code === 'CHECKIN_TOO_LATE';

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        {/* Brand header */}
        <div className="flex items-center justify-center gap-2 mb-6 text-slate-700">
          <QrCode className="h-6 w-6 text-blue-600" />
          <span className="text-lg font-bold">Check in</span>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          {phase === 'form' && (
            <form onSubmit={submit}>
              <p className="text-sm text-slate-600 mb-4 text-center">
                Enter the <strong>check-in code</strong> from your booking
                confirmation email.
              </p>
              <input
                ref={inputRef}
                value={pretty(code)}
                onChange={(e) => onChange(e.target.value)}
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="one-time-code"
                spellCheck={false}
                placeholder="ABCD-2345"
                aria-label="Check-in code"
                className="w-full text-center tracking-[0.3em] font-mono text-2xl uppercase
                           rounded-xl border border-slate-300 bg-slate-50 px-4 py-4
                           focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              {formError && (
                <p className="text-sm text-red-600 mt-2 text-center">{formError}</p>
              )}
              <button
                type="submit"
                className="mt-5 w-full rounded-xl bg-blue-600 text-white font-semibold
                           text-base py-4 active:bg-blue-700 hover:bg-blue-700 transition
                           disabled:opacity-50"
                disabled={code.length !== 8}
              >
                Confirm I'm here
              </button>
            </form>
          )}

          {phase === 'loading' && (
            <div className="flex flex-col items-center py-10">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
              <p className="text-sm text-slate-500 mt-3">Checking you in…</p>
            </div>
          )}

          {phase === 'done' && result && (
            <div className="text-center">
              {ok ? (
                <CheckCircle2 className="h-14 w-14 text-green-500 mx-auto" />
              ) : isWindow ? (
                <Clock className="h-14 w-14 text-amber-500 mx-auto" />
              ) : (
                <XCircle className="h-14 w-14 text-red-500 mx-auto" />
              )}

              <h2 className="text-xl font-bold mt-3 text-slate-800">
                {ok ? (result.already ? "Already checked in" : "You're checked in") : 'Not checked in'}
              </h2>
              <p className="text-sm text-slate-600 mt-1">{result.msg}</p>

              {(result.facility_name || result.start_at) && (
                <div className="mt-4 rounded-xl bg-slate-50 border border-slate-200 p-4 text-left">
                  {result.facility_name && (
                    <div className="font-semibold text-slate-800">
                      {result.facility_name}
                      {result.facility_type && (
                        <span className="text-slate-400 font-normal"> · {result.facility_type}</span>
                      )}
                    </div>
                  )}
                  {result.start_at && (
                    <div className="text-sm text-slate-500 mt-1">
                      {fmtWhen(result.start_at)}
                      {result.end_at && <> – {fmtWhen(result.end_at)}</>}
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={reset}
                className="mt-6 w-full rounded-xl border border-slate-300 text-slate-700
                           font-semibold text-base py-3.5 hover:bg-slate-50 transition"
              >
                {ok ? 'Check in another' : 'Try again'}
              </button>
            </div>
          )}
        </div>

        <p className="text-xs text-slate-400 text-center mt-5">
          Having trouble? Check the code in your confirmation email.
        </p>
      </div>
    </div>
  );
}
