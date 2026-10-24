// doc 11 — Kiosk booking (public). UI inspired by the SpaceDesk lobby kiosk:
// teal theme, display headings, welcome hero with a big clock, large rounded
// cards, a 3-step stepper and a slot grid. BOOKING ONLY (no pantry / check-in).
//
// Flow: home → tenant → organisation → site → choice (AI | Manual) →
//   Manual: facility → identify (email) → date/time + seat + per-seat emails →
//   AI:     type request → on-device parse pre-fills facility+date+time → … →
//   confirm → done.
//
// The AI option uses an on-device natural-language parser (no external LLM in
// this app) to pre-fill the booking; the user confirms/adjusts as normal.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Loader2, MapPin, Clock, CheckCircle2, XCircle, ArrowLeft, Home, ChevronLeft, ChevronRight,
  Building2, Network, Sparkles, Hand, User, ArrowRight, Calendar,
} from 'lucide-react';
import {
  kioskApi,
  type KioskTenant, type KioskOrg, type KioskSite, type KioskFacilityCard, type KioskSlot,
  type KioskFacilityDetail, type KioskBookResult,
} from '@/api/public.api';
import DeskPicker from '@/pages/facility/components/DeskPicker';

type Phase = 'loading' | 'home' | 'tenant' | 'org' | 'site' | 'choice' | 'ai' | 'facility' | 'identify' | 'book' | 'confirm' | 'done';
type Resolved = 'loading' | { name: string | null; ok: boolean };

const DISPLAY = { fontFamily: '"Bricolage Grotesque", "Figtree", system-ui, sans-serif' } as const;
const pad = (n: number) => String(n).padStart(2, '0');
function isoOf(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function todayIso() { return isoOf(new Date()); }
function prettyDate(iso: string) {
  const d = new Date(iso + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
}
function greeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
function countChairs(layout: unknown): number {
  try {
    const l = (typeof layout === 'string' ? JSON.parse(layout) : layout) as { objects?: { type?: string; isVip?: boolean }[]; desks?: { type?: string }[] } | null;
    if (!l) return 0;
    if (Array.isArray(l.objects)) return l.objects.filter((o) => o && o.type === 'chair' && !o.isVip).length;
    if (Array.isArray(l.desks)) return l.desks.filter((d) => d && d.type === 'desk').length;
    return 0;
  } catch { return 0; }
}

// On-device parse of a free-text booking request -> hints.
function parseRequest(text: string) {
  const t = text.toLowerCase();
  let type: string | null = null;
  for (const [k, v] of [['phone', 'meeting_room'], ['booth', 'meeting_room'], ['conference', 'conference_room'], ['hall', 'conference_room'], ['gym', 'gym'], ['pool', 'swimming_pool'], ['swim', 'swimming_pool'], ['desk', 'desk'], ['seat', 'desk'], ['meeting', 'meeting_room']] as const) {
    if (t.includes(k)) { type = v; break; }
  }
  const d = new Date();
  if (/day after|parso/.test(t)) d.setDate(d.getDate() + 2);
  else if (/tomorrow|\bkal\b/.test(t)) d.setDate(d.getDate() + 1);
  const wd = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].findIndex((w) => t.includes(w));
  if (wd >= 0) { const x = new Date(); x.setDate(x.getDate() + (((wd - x.getDay()) + 7) % 7 || 7)); d.setTime(x.getTime()); }
  const dateIso = isoOf(d);
  let start: string | null = null;
  if (/\bnow\b|abhi/.test(t)) { const n = new Date(); start = `${pad(n.getHours())}:${n.getMinutes() >= 30 ? '30' : '00'}`; }
  if (!start) {
    const m = t.match(/(?:at|@|by)?\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|baje)?/);
    if (m) { let h = +m[1]; const suf = m[3]; if (suf === 'pm' && h < 12) h += 12; if (!suf && h >= 1 && h <= 7) h += 12; if (h <= 23) start = `${pad(h)}:${m[2] && +m[2] >= 30 ? '30' : '00'}`; }
  }
  const ppl = t.match(/(\d+)\s*(people|persons?|log|members?|pax|seats?|attendees?)/);
  const attendees = ppl ? Math.max(1, +ppl[1]) : 1;
  const nm = text.match(/(?:name|naam|i am|i'm)\s*(?:is|hai)?[:\-]?\s*([A-Za-z]+(?:\s[A-Za-z]+)?)/i);
  return { type, dateIso, start, attendees, name: nm ? nm[1] : null };
}

// Horizontal carousel with soft scroll arrows.
function Carousel({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const by = (d: number) => { const el = ref.current; if (el) el.scrollBy({ left: d * el.clientWidth * 0.8, behavior: 'smooth' }); };
  const a = 'absolute top-1/2 -translate-y-1/2 z-10 h-11 w-11 rounded-full bg-white dark:bg-slate-700 shadow-lg ring-1 ring-black/5 grid place-items-center hover:scale-105 active:scale-95 transition';
  return (
    <div className="relative">
      <button onClick={() => by(-1)} aria-label="Scroll left" className={a + ' -left-2'}><ChevronLeft className="h-5 w-5 text-slate-600 dark:text-slate-200" /></button>
      <div ref={ref} className="flex gap-5 overflow-x-auto scroll-smooth px-12 py-1 snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{children}</div>
      <button onClick={() => by(1)} aria-label="Scroll right" className={a + ' -right-2'}><ChevronRight className="h-5 w-5 text-slate-600 dark:text-slate-200" /></button>
    </div>
  );
}

type CardIcon = typeof Building2;
function PickCard({ icon: Icon, title, desc, onClick, disabled, image }: { icon: CardIcon; title: string; desc?: string | null; onClick: () => void; disabled?: boolean; image?: string | null }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="group w-72 shrink-0 snap-start text-left rounded-[28px] bg-white dark:bg-slate-800 shadow-[0_8px_22px_-10px_rgba(10,31,28,.25)] hover:shadow-xl hover:-translate-y-1 transition-all overflow-hidden disabled:opacity-50">
      {image
        ? <div className="h-28 w-full overflow-hidden"><img src={image} alt="" className="h-full w-full object-cover" /></div>
        : <div className="h-28 w-full bg-gradient-to-br from-teal-600 to-emerald-500 grid place-items-center"><Icon className="h-12 w-12 text-white/90" /></div>}
      <div className="p-5">
        <h3 className="font-bold text-slate-900 dark:text-slate-100 text-xl leading-snug line-clamp-2" style={DISPLAY}>{title}</h3>
        {desc && <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">{desc}</p>}
        <div className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-teal-700 dark:text-teal-400">Continue<ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" /></div>
      </div>
    </button>
  );
}

export default function KioskPage() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(new Date());

  const [tenants, setTenants] = useState<KioskTenant[]>([]);
  const [tenant, setTenant] = useState<KioskTenant | null>(null);
  const [orgs, setOrgs] = useState<KioskOrg[]>([]);
  const [org, setOrg] = useState<KioskOrg | null>(null);
  const [sites, setSites] = useState<KioskSite[]>([]);
  const [site, setSite] = useState<KioskSite | null>(null);
  const [facilities, setFacilities] = useState<KioskFacilityCard[]>([]);
  const [facility, setFacility] = useState<KioskFacilityCard | null>(null);

  const [aiText, setAiText] = useState('');
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [aiStart, setAiStart] = useState<string | null>(null); // desired HH:MM

  const [identifier, setIdentifier] = useState('');
  const [primaryEmail, setPrimaryEmail] = useState('');
  const [primaryName, setPrimaryName] = useState<string | null>(null);

  const [date, setDate] = useState(todayIso());
  const [slots, setSlots] = useState<KioskSlot[]>([]);
  const [closed, setClosed] = useState(false);
  const [slot, setSlot] = useState<KioskSlot | null>(null);
  const [deskLayout, setDeskLayout] = useState<KioskFacilityDetail['layout_json']>(null);
  const [occupiedDesks, setOccupiedDesks] = useState<string[]>([]);
  const [selectedDesks, setSelectedDesks] = useState<string[]>([]);
  const [seatEmails, setSeatEmails] = useState<Record<string, string>>({});
  const [seatResolved, setSeatResolved] = useState<Record<string, Resolved>>({});

  const [doneRes, setDoneRes] = useState<KioskBookResult | null>(null);
  const [doneOk, setDoneOk] = useState(false);
  const [doneMsg, setDoneMsg] = useState('');

  // Fonts + clock.
  useEffect(() => {
    const id = 'kiosk-fonts';
    if (!document.getElementById(id)) {
      const l = document.createElement('link'); l.id = id; l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Figtree:wght@400;500;600;700;800&display=swap';
      document.head.appendChild(l);
    }
  }, []);
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 15_000); return () => window.clearInterval(t); }, []);
  useEffect(() => { kioskApi.tenants().then((r) => { setTenants((r.status && r.data?.tenants) || []); setPhase('home'); }).catch(() => setPhase('home')); }, []);

  const startOver = useCallback(() => {
    setTenant(null); setOrgs([]); setOrg(null); setSites([]); setSite(null); setFacilities([]); setFacility(null);
    setAiText(''); setAiNote(null); setAiStart(null);
    setIdentifier(''); setPrimaryEmail(''); setPrimaryName(null);
    setSlots([]); setSlot(null); setClosed(false);
    setDeskLayout(null); setOccupiedDesks([]); setSelectedDesks([]); setSeatEmails({}); setSeatResolved({});
    setDoneRes(null); setDate(todayIso()); setError(null); setPhase('home');
  }, []);
  useEffect(() => { if (phase !== 'done') return; const t = window.setTimeout(startOver, 90_000); return () => window.clearTimeout(t); }, [phase, startOver]);

  async function pickTenant(t: KioskTenant) {
    setTenant(t); setBusy(true); setError(null);
    try { const r = await kioskApi.organisations(t.id); if (!r.status || !r.data) { setError(r.msg || 'Could not load organisations'); return; } setOrgs(r.data.organisations); setPhase('org'); } finally { setBusy(false); }
  }
  async function pickOrg(o: KioskOrg) {
    if (!tenant) return; setOrg(o); setBusy(true); setError(null);
    try { const r = await kioskApi.sites(tenant.id, o.id); if (!r.status || !r.data) { setError(r.msg || 'Could not load sites'); return; } setSites(r.data.sites); setPhase('site'); } finally { setBusy(false); }
  }
  async function pickSite(s: KioskSite) {
    if (!tenant) return; setSite(s); setBusy(true); setError(null);
    try { const r = await kioskApi.facilities(tenant.id, s.id); if (!r.status || !r.data) { setError(r.msg || 'Could not load facilities'); return; } setFacilities(r.data.facilities); setPhase('choice'); } finally { setBusy(false); }
  }
  function pickFacility(f: KioskFacilityCard) { setFacility(f); setError(null); setPhase('identify'); }

  // AI: parse the request, pick a facility + desired date/time, then identify.
  function runAi() {
    if (aiText.trim().length < 3) { setError('Type what you need, e.g. "meeting room for 6 tomorrow at 3pm".'); return; }
    const p = parseRequest(aiText);
    let fac: KioskFacilityCard | undefined;
    const lower = aiText.toLowerCase();
    fac = facilities.find((f) => f.name && lower.includes(f.name.toLowerCase()));
    if (!fac && p.type) fac = facilities.find((f) => f.type === p.type && f.capacity >= p.attendees);
    if (!fac) fac = facilities.find((f) => f.capacity >= p.attendees) || facilities[0];
    if (!fac) { setError('No facility here fits that request.'); return; }
    const notes = [`Picked ${fac.name}`];
    if (p.name && !identifier) setIdentifier('');
    setFacility(fac); setDate(p.dateIso); setAiStart(p.start);
    if (p.start) notes.push(`at ${p.start}`); notes.push(`on ${prettyDate(p.dateIso)}`);
    setAiNote(notes.join(' · '));
    setError(null); setPhase('identify');
  }

  async function submitIdentify(e?: React.FormEvent) {
    e?.preventDefault();
    if (!tenant || !facility) return;
    if (!identifier.trim()) { setError('Enter your work email or employee ID.'); return; }
    setBusy(true); setError(null);
    try {
      const r = await kioskApi.identify(tenant.id, identifier.trim());
      if (!r.status || !r.data) { setError(r.msg || "We couldn't find you."); return; }
      setPrimaryEmail(identifier.trim()); setPrimaryName(r.data.user.name);
      setSlot(null); setSelectedDesks([]); setSeatEmails({}); setSeatResolved({}); setOccupiedDesks([]);
      const dayR = await kioskApi.day(tenant.id, facility.id, date);
      const list = (dayR.status && dayR.data?.slots) || []; setSlots(list); setClosed(!!dayR.data?.closed);
      if (facility.type === 'desk') { const det = await kioskApi.facilityDetail(tenant.id, facility.id); setDeskLayout(det.status ? (det.data?.facility.layout_json ?? null) : null); } else setDeskLayout(null);
      // AI: auto-select the desired slot if it's free.
      if (aiStart) { const want = list.find((s) => s.start === aiStart && !s.conflict); if (want) await applySlot(facility, want); }
      setPhase('book');
    } finally { setBusy(false); }
  }

  const chairCount = countChairs(deskLayout);
  const deskMode = !!facility && facility.type === 'desk' && chairCount > 0;

  async function reloadDay(d: string) {
    if (!tenant || !facility) return;
    setBusy(true); setError(null); setSlot(null); setSelectedDesks([]); setSeatEmails({}); setSeatResolved({}); setOccupiedDesks([]);
    try { const dayR = await kioskApi.day(tenant.id, facility.id, d); setSlots((dayR.status && dayR.data?.slots) || []); setClosed(!!dayR.data?.closed); } finally { setBusy(false); }
  }
  async function applySlot(fac: KioskFacilityCard, s: KioskSlot) {
    setSlot(s); setSelectedDesks([]); setSeatEmails({}); setSeatResolved({});
    if (!tenant || fac.type !== 'desk') return;
    const chk = await kioskApi.check(tenant.id, fac.id, `${date} ${s.start}:00`, `${date} ${s.end}:00`);
    setOccupiedDesks((chk.status && chk.data?.occupied_desks) || []);
  }
  async function pickBookSlot(s: KioskSlot) { if (!facility) return; setBusy(true); try { await applySlot(facility, s); } finally { setBusy(false); } }
  function toggleDesk(id: string) { if (occupiedDesks.includes(id)) return; setSelectedDesks((p) => (p.includes(id) ? p.filter((d) => d !== id) : [...p, id])); }
  async function validateSeatEmail(deskId: string, raw: string) {
    const email = raw.trim();
    if (!tenant || !email) { setSeatResolved((p) => { const c = { ...p }; delete c[deskId]; return c; }); return; }
    setSeatResolved((p) => ({ ...p, [deskId]: 'loading' }));
    const r = await kioskApi.identify(tenant.id, email);
    setSeatResolved((p) => ({ ...p, [deskId]: (r.status && r.data) ? { name: r.data.user.name, ok: true } : { name: null, ok: false } }));
  }

  const extraSeats = deskMode ? selectedDesks.slice(1) : [];
  const extrasOk = extraSeats.every((d) => { const r = seatResolved[d]; return r && r !== 'loading' && r.ok; });
  const canReview = !!slot && (!deskMode || (selectedDesks.length >= 1 && extrasOk));
  function assignments(): { desk_id: string | null; identifier: string }[] {
    if (deskMode && selectedDesks.length) return selectedDesks.map((d, i) => ({ desk_id: d, identifier: i === 0 ? primaryEmail : (seatEmails[d] || '') }));
    return [{ desk_id: null, identifier: primaryEmail }];
  }
  async function confirmBooking() {
    if (!tenant || !facility || !slot) return;
    setBusy(true); setError(null);
    try {
      const r = await kioskApi.book(tenant.id, { facility_id: facility.id, start_at: `${date} ${slot.start}:00`, end_at: `${date} ${slot.end}:00`, title: `${facility.name} (kiosk)`, assignments: assignments() });
      setDoneOk(!!(r.status && r.data?.all_ok)); setDoneMsg(r.msg || (r.status ? 'Booked' : 'Could not book')); setDoneRes(r.data || null); setPhase('done');
    } catch { setDoneOk(false); setDoneMsg('Network error — please try again.'); setDoneRes(null); setPhase('done'); } finally { setBusy(false); }
  }

  // ---- chrome ----
  const headerTitle = site?.name || tenant?.name || 'SpaceDesk';
  const headerSub = site?.address || org?.name || 'Facility booking kiosk';
  const clockStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const crumbs = [tenant?.name, org?.name, site?.name, facility?.name].filter(Boolean) as string[];

  const Shell = (p: { children: React.ReactNode; title?: string; eyebrow?: string; subtitle?: string; back?: () => void; hero?: boolean; wide?: boolean }) => (
    <div className="min-h-screen flex flex-col bg-[radial-gradient(700px_500px_at_50%_-5%,#ccfbf1,transparent_70%)] bg-slate-50 dark:bg-slate-900" style={{ fontFamily: '"Figtree", system-ui, sans-serif' }}>
      <header className="bg-[#0a1f1c] text-teal-50">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {p.back ? <button onClick={p.back} aria-label="Back" className="h-10 w-10 -ml-2 rounded-xl grid place-items-center hover:bg-white/10"><ArrowLeft className="h-5 w-5" /></button>
              : <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-500 grid place-items-center"><Building2 className="h-5 w-5 text-white" /></div>}
            <div className="min-w-0">
              <div className="font-bold truncate" style={DISPLAY}>{headerTitle}</div>
              <div className="text-[11px] text-teal-200/70 truncate">{headerSub}</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {phase !== 'home' && <button onClick={startOver} aria-label="Home" className="h-10 w-10 rounded-xl grid place-items-center hover:bg-white/10"><Home className="h-5 w-5" /></button>}
            <div className="flex items-center gap-1.5 text-teal-100"><Clock className="h-4 w-4" /><span className="text-sm font-semibold tabular-nums" style={DISPLAY}>{clockStr}</span></div>
          </div>
        </div>
      </header>
      <main className={'flex-1 flex items-center justify-center px-4 sm:px-6 py-8 ' + (p.hero ? '' : '')}>
        <div className={'w-full ' + (p.wide ? 'max-w-5xl' : 'max-w-3xl')}>
          {!p.hero && (
            <div className="bg-white dark:bg-slate-800 rounded-[32px] shadow-[0_8px_30px_-12px_rgba(10,31,28,.3)] ring-1 ring-slate-200/70 dark:ring-slate-700 p-6 sm:p-10">
              {p.eyebrow && <div className="text-xs font-extrabold tracking-[0.18em] uppercase text-teal-600/70 mb-2">{p.eyebrow}</div>}
              {p.title && <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-slate-100" style={DISPLAY}>{p.title}</h1>}
              {p.subtitle && <p className="text-slate-500 dark:text-slate-400 mt-2">{p.subtitle}</p>}
              {error && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2 mt-6">{error}</p>}
              <div className="mt-8">{p.children}</div>
            </div>
          )}
          {p.hero && p.children}
        </div>
      </main>
    </div>
  );

  const Spinner = <div className="flex justify-center py-16"><Loader2 className="h-9 w-9 animate-spin text-teal-600" /></div>;
  const Empty = (m: string) => <div className="text-center text-slate-500 dark:text-slate-400 py-12">{m}</div>;
  const Crumbs = crumbs.length ? <div className="flex flex-wrap gap-1.5 mb-5">{crumbs.map((c, i) => <span key={i} className="text-[11px] font-semibold bg-teal-50 dark:bg-teal-500/10 text-teal-700 dark:text-teal-300 rounded-full px-2.5 py-0.5">{c}</span>)}</div> : null;

  if (phase === 'loading') return <Shell title="Welcome" eyebrow="SpaceDesk">{Spinner}</Shell>;

  // HOME — welcome hero + big clock (SpaceDesk-style).
  if (phase === 'home') {
    const n = now;
    return (
      <Shell hero wide>
        <div className="relative overflow-hidden rounded-[34px] p-8 sm:p-10 text-white shadow-[0_24px_50px_-24px_rgba(6,48,43,.75)] bg-[radial-gradient(600px_380px_at_100%_0%,rgba(94,234,212,.4),transparent_60%),linear-gradient(140deg,#06302b,#0f6b60_65%,#18a58f)]">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 text-sm font-semibold bg-white/15 border border-white/20 rounded-full px-3.5 py-2"><MapPin className="h-4 w-4" />{tenants.length ? 'Welcome' : 'SpaceDesk'}</span>
            <span className="inline-flex items-center gap-2 text-sm font-semibold bg-white/10 rounded-full px-3.5 py-2"><Clock className="h-4 w-4" />{clockStr}</span>
          </div>
          <div className="mt-7 text-lg opacity-90">{greeting()}, welcome</div>
          <div className="text-5xl sm:text-6xl font-extrabold tracking-tight mt-1" style={DISPLAY}>Book a facility</div>
          <div className="mt-8 pt-6 border-t border-white/20 flex items-end justify-between gap-4">
            <div className="text-[84px] sm:text-[104px] leading-[.8] font-extrabold tabular-nums" style={DISPLAY}>{clockStr}</div>
            <div className="text-right">
              <div className="text-2xl font-bold" style={DISPLAY}>{n.toLocaleDateString('en-GB', { weekday: 'long' })}</div>
              <div className="opacity-85">{n.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
            </div>
          </div>
        </div>
        <button onClick={() => setPhase('tenant')}
          className="mt-6 w-full rounded-[26px] bg-gradient-to-r from-teal-600 to-emerald-600 text-white font-extrabold text-xl py-6 shadow-lg hover:opacity-95 active:scale-[0.99] transition flex items-center justify-center gap-3" style={DISPLAY}>
          <Calendar className="h-6 w-6" /> Start booking <ArrowRight className="h-6 w-6" />
        </button>
      </Shell>
    );
  }

  if (phase === 'tenant') {
    return (
      <Shell title="Where are you booking?" eyebrow="Organisation group" back={startOver} wide>
        {tenants.length === 0 ? Empty('No locations available right now.') : <Carousel>{tenants.map((t) => <PickCard key={t.id} icon={Building2} title={t.name} onClick={() => pickTenant(t)} disabled={busy} />)}</Carousel>}
      </Shell>
    );
  }
  if (phase === 'org') {
    return (<Shell title="Pick an organisation" eyebrow="Step 1 of 4" back={() => setPhase('tenant')} wide>{Crumbs}{busy ? Spinner : orgs.length === 0 ? Empty('No organisations here.') : <Carousel>{orgs.map((o) => <PickCard key={o.id} icon={Network} title={o.name} onClick={() => pickOrg(o)} />)}</Carousel>}</Shell>);
  }
  if (phase === 'site') {
    return (<Shell title="Pick a site" eyebrow="Step 2 of 4" back={() => setPhase('org')} wide>{Crumbs}{busy ? Spinner : sites.length === 0 ? Empty('No sites here.') : <Carousel>{sites.map((s) => <PickCard key={s.id} icon={MapPin} title={s.name} desc={s.address || undefined} onClick={() => pickSite(s)} />)}</Carousel>}</Shell>);
  }

  // CHOICE — AI vs Manual (SpaceDesk .opt cards).
  if (phase === 'choice') {
    return (
      <Shell title="How would you like to book?" eyebrow="Step 3 of 4" subtitle="Both ways make the same booking. Pick whichever is easier." back={() => setPhase('site')} wide>
        {Crumbs}
        <div className="grid gap-5 sm:grid-cols-2">
          <button onClick={() => { setAiNote(null); setPhase('ai'); }}
            className="group text-left rounded-[30px] p-7 text-white overflow-hidden shadow-xl hover:-translate-y-1 transition bg-[radial-gradient(500px_300px_at_100%_0%,rgba(144,133,233,.5),transparent_60%),linear-gradient(140deg,#06302b,#0f6b60_55%,#3b3a9e)]">
            <span className="h-20 w-20 rounded-[24px] grid place-items-center bg-[conic-gradient(from_200deg,#14b8a6,#4a3aa7,#2a78d6,#14b8a6)] shadow-lg"><Sparkles className="h-10 w-10 text-white" /></span>
            <div className="mt-5 text-3xl font-extrabold" style={DISPLAY}>Book with AI</div>
            <p className="mt-2 text-white/90">Type what you need in plain English or Hinglish — it picks a free facility and fills the form.</p>
            <div className="mt-4 bg-white/12 border border-white/20 rounded-[18px] rounded-bl-md px-4 py-3 text-sm">“6 log ka meeting room kal 3 baje, projector ke saath”</div>
            <span className="mt-5 inline-flex items-center gap-2 font-extrabold text-teal-200">Start with AI <ArrowRight className="h-5 w-5" /></span>
          </button>
          <button onClick={() => setPhase('facility')}
            className="group text-left rounded-[30px] p-7 bg-white dark:bg-slate-800 shadow-xl hover:-translate-y-1 transition">
            <span className="h-20 w-20 rounded-[24px] grid place-items-center bg-teal-50 dark:bg-teal-500/10 text-teal-700 dark:text-teal-300"><Hand className="h-10 w-10" /></span>
            <div className="mt-5 text-3xl font-extrabold text-slate-900 dark:text-slate-100" style={DISPLAY}>Manual booking</div>
            <p className="mt-2 text-slate-600 dark:text-slate-400">Browse the facilities at {site?.name} and choose the room, time and seat yourself.</p>
            <div className="mt-4 flex items-center gap-2 flex-wrap text-sm">
              {['Choose room', 'Pick time', 'Confirm'].map((s, i) => (
                <span key={s} className="inline-flex items-center gap-2 bg-slate-100 dark:bg-slate-700 rounded-xl px-3 py-2 font-bold text-slate-600 dark:text-slate-300"><i className="not-italic h-6 w-6 rounded-full bg-teal-600 text-white grid place-items-center text-xs">{i + 1}</i>{s}</span>
              ))}
            </div>
            <span className="mt-5 inline-flex items-center gap-2 font-extrabold text-teal-700 dark:text-teal-400">Start manual <ArrowRight className="h-5 w-5" /></span>
          </button>
        </div>
      </Shell>
    );
  }

  // AI — free text request.
  if (phase === 'ai') {
    const examples = ['Meeting room for 6 tomorrow at 3pm with a projector', 'Phone booth right now for 30 minutes', 'Kal 2 baje conference hall for 20 people', 'A desk for today morning'];
    return (
      <Shell title="Book with AI" eyebrow="Step 3 of 4" back={() => setPhase('choice')} wide>
        {Crumbs}
        <div className="flex gap-4 items-start mb-4">
          <span className="h-14 w-14 shrink-0 rounded-[18px] grid place-items-center bg-[conic-gradient(from_200deg,#14b8a6,#4a3aa7,#2a78d6,#14b8a6)]"><Sparkles className="h-7 w-7 text-white" /></span>
          <div className="bg-slate-50 dark:bg-slate-900 rounded-[22px] rounded-bl-md px-5 py-4 text-slate-700 dark:text-slate-200">Tell me the room or type, how many people, when and how long. I’ll pick a free facility at <b>{site?.name}</b> and pre-fill the booking — you just confirm.</div>
        </div>
        <textarea value={aiText} onChange={(e) => { setAiText(e.target.value); if (error) setError(null); }} autoFocus
          placeholder="e.g. Meeting room for 6 people tomorrow at 3 pm for an hour with a projector"
          className="w-full h-40 resize-none rounded-[24px] border-2 border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 p-5 text-lg focus:outline-none focus:border-teal-500" />
        <button onClick={runAi} className="mt-4 w-full rounded-[20px] bg-gradient-to-r from-teal-600 to-emerald-600 text-white font-extrabold text-lg py-5 hover:opacity-95 active:scale-[0.99] transition flex items-center justify-center gap-2" style={DISPLAY}><Sparkles className="h-5 w-5" />Fill booking</button>
        <div className="text-xs font-extrabold tracking-wider uppercase text-slate-400 mt-6 mb-2">Or tap an example</div>
        <div className="flex flex-col gap-2.5">
          {examples.map((x) => <button key={x} onClick={() => setAiText(x)} className="text-left rounded-[18px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3.5 text-slate-600 dark:text-slate-300 flex items-center gap-3 hover:border-teal-400"><Sparkles className="h-5 w-5 text-teal-600 shrink-0" />{x}</button>)}
        </div>
      </Shell>
    );
  }

  // MANUAL — facility picker.
  if (phase === 'facility') {
    return (
      <Shell title="Choose a facility" eyebrow="Step 3 of 4" subtitle={site?.name} back={() => setPhase('choice')} wide>
        {Crumbs}
        {busy ? Spinner : facilities.length === 0 ? Empty('No bookable facilities at this site.') : (
          <Carousel>{facilities.map((f) => <PickCard key={f.id} icon={Building2} image={f.image_url || undefined} title={f.name} desc={`${f.type.replace('_', ' ')} · ${f.capacity} seats${f.floor_name ? ` · ${f.floor_name}` : ''}`} onClick={() => pickFacility(f)} />)}</Carousel>
        )}
      </Shell>
    );
  }

  // IDENTIFY — email check.
  if (phase === 'identify') {
    return (
      <Shell title="Let’s start with you" eyebrow="Step 4 of 4" subtitle={facility?.name} back={() => setPhase(aiNote ? 'ai' : 'facility')}>
        {aiNote && <div className="mb-5 flex items-start gap-3 rounded-[18px] bg-teal-50 dark:bg-teal-500/10 border border-teal-100 dark:border-teal-500/30 px-4 py-3 text-sm"><Sparkles className="h-5 w-5 text-teal-600 shrink-0" /><span className="text-slate-700 dark:text-slate-300"><b>From your request:</b> {aiNote}. Adjust anything on the next screen.</span></div>}
        <form onSubmit={submitIdentify} className="max-w-md">
          <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1.5">Your work email or employee ID</label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
            <input autoFocus value={identifier} onChange={(e) => { setIdentifier(e.target.value); if (error) setError(null); }} placeholder="you@company.com"
              className="w-full rounded-[18px] border-2 border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 pl-11 pr-4 py-4 text-lg focus:outline-none focus:border-teal-500" />
          </div>
          <button type="submit" disabled={busy} className="mt-4 w-full rounded-[18px] bg-gradient-to-r from-teal-600 to-emerald-600 text-white font-extrabold text-base py-4 hover:opacity-95 active:scale-[0.99] transition disabled:opacity-50" style={DISPLAY}>{busy ? 'Checking…' : 'Continue'}</button>
        </form>
      </Shell>
    );
  }

  // BOOK — date/time + seat + per-seat emails.
  if (phase === 'book') {
    return (
      <Shell title={facility?.name || 'Book'} eyebrow="When & where" subtitle={`${tenant?.name} · ${site?.name}`} back={() => setPhase('identify')} wide>
        <div className="space-y-8">
          <section>
            <h3 className="font-bold text-lg text-slate-900 dark:text-slate-100 mb-3" style={DISPLAY}>1 · Pick a time</h3>
            <div className="flex items-center gap-2 mb-4"><span className="text-sm text-slate-600 dark:text-slate-300">Date</span><input type="date" value={date} min={todayIso()} onChange={(e) => { setDate(e.target.value); reloadDay(e.target.value); }} className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm" /></div>
            {busy && !slot ? Spinner : closed ? (
              <div className="flex items-start gap-3 rounded-[18px] bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 px-4 py-3"><Clock className="h-5 w-5 text-amber-600 shrink-0" /><div className="text-sm"><div className="font-bold text-amber-800 dark:text-amber-300">Closed on {prettyDate(date)}</div><div className="text-amber-700 dark:text-amber-400/80">Pick another date.</div></div></div>
            ) : slots.length === 0 ? Empty('No slots for this day.') : (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                {slots.map((s) => { const active = slot?.start === s.start; return (
                  <button key={s.start} disabled={s.conflict} onClick={() => pickBookSlot(s)}
                    className={'rounded-[16px] py-3 text-center text-sm font-bold transition shadow-sm font-mono ' + (s.conflict ? 'bg-slate-100 dark:bg-slate-800 text-slate-300 dark:text-slate-600 cursor-not-allowed' : active ? 'bg-teal-600 text-white' : 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 ring-1 ring-slate-200 dark:ring-slate-700 hover:ring-2 hover:ring-teal-500')}>
                    {s.start}<div className={'text-[11px] font-sans font-normal mt-0.5 ' + (active ? 'text-white/80' : 'text-slate-400')}>{s.conflict ? 'full' : `${s.seats_remaining} free`}</div>
                  </button>); })}
              </div>
            )}
          </section>

          {deskMode && slot && (
            <section>
              <h3 className="font-bold text-lg text-slate-900 dark:text-slate-100 mb-3" style={DISPLAY}>2 · Choose seat(s)</h3>
              {busy ? Spinner : <div className="rounded-[20px] border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-4 overflow-auto"><DeskPicker value={deskLayout} occupiedDeskIds={occupiedDesks} selectedDeskIds={selectedDesks} onToggle={toggleDesk} /></div>}
            </section>
          )}

          {deskMode && slot && extraSeats.length > 0 && (
            <section>
              <h3 className="font-bold text-lg text-slate-900 dark:text-slate-100 mb-1" style={DISPLAY}>3 · Who’s sitting where</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">Seat <b>{selectedDesks[0]}</b> is for you ({primaryName || primaryEmail}). Add the employee for each other seat.</p>
              <div className="space-y-3 max-w-xl">
                {extraSeats.map((d) => { const r = seatResolved[d]; return (
                  <div key={d} className="flex items-center gap-3">
                    <span className="w-20 shrink-0 text-sm font-bold text-slate-700 dark:text-slate-200">{d}</span>
                    <div className="relative flex-1">
                      <input type="email" value={seatEmails[d] || ''} placeholder="employee@company.com" onChange={(e) => setSeatEmails((p) => ({ ...p, [d]: e.target.value }))} onBlur={(e) => validateSeatEmail(d, e.target.value)} className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2.5 pr-9 focus:outline-none focus:ring-2 focus:ring-teal-500" />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2">{r === 'loading' ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : r && r.ok ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : r ? <XCircle className="h-4 w-4 text-red-500" /> : null}</span>
                    </div>
                    <span className="w-28 shrink-0 text-xs text-slate-500 dark:text-slate-400 truncate">{r && r !== 'loading' && r.ok ? r.name : r && r !== 'loading' ? 'not found' : ''}</span>
                  </div>); })}
              </div>
            </section>
          )}

          <div className="pt-2">
            <button disabled={!canReview} onClick={() => setPhase('confirm')} className="rounded-[18px] bg-gradient-to-r from-teal-600 to-emerald-600 text-white font-extrabold px-8 py-4 hover:opacity-95 active:scale-[0.99] transition disabled:opacity-40" style={DISPLAY}>Review booking</button>
            {deskMode && slot && selectedDesks.length === 0 && <p className="text-xs text-slate-500 mt-2">Tap a free seat to continue.</p>}
          </div>
        </div>
      </Shell>
    );
  }

  if (phase === 'confirm') {
    const rows = assignments();
    return (
      <Shell title="Confirm booking" eyebrow="Review" back={() => setPhase('book')}>
        <div className="max-w-md">
          <div className="rounded-[22px] border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="bg-gradient-to-r from-teal-600 to-emerald-600 text-white px-5 py-3"><div className="font-bold" style={DISPLAY}>{facility?.name}</div><div className="text-white/80 text-sm">{tenant?.name} · {org?.name} · {site?.name}</div></div>
            <div className="p-5 space-y-2">
              <div className="text-sm text-slate-700 dark:text-slate-300 flex items-center gap-2"><Clock className="h-4 w-4 text-teal-600" /> {prettyDate(date)} · {slot?.start}–{slot?.end}</div>
              <div className="pt-2 space-y-1">{rows.map((a, i) => (
                <div key={i} className="flex items-center justify-between text-sm"><span className="font-bold text-slate-800 dark:text-slate-100">{a.desk_id ? `Seat ${a.desk_id}` : 'Booking'}</span><span className="text-slate-500 dark:text-slate-400 truncate ml-3">{i === 0 ? (primaryName || a.identifier) : (() => { const r = a.desk_id ? seatResolved[a.desk_id] : undefined; return (r && r !== 'loading' && r.ok && r.name) ? r.name : a.identifier; })()}</span></div>
              ))}</div>
            </div>
          </div>
          <button onClick={confirmBooking} disabled={busy} className="mt-4 w-full rounded-[18px] bg-gradient-to-r from-teal-600 to-emerald-600 text-white font-extrabold text-base py-4 hover:opacity-95 active:scale-[0.99] transition disabled:opacity-50" style={DISPLAY}>{busy ? 'Booking…' : `Confirm ${rows.length > 1 ? rows.length + ' bookings' : 'booking'}`}</button>
        </div>
      </Shell>
    );
  }

  // DONE
  return (
    <Shell title={doneRes ? `Booked ${doneRes.booked} of ${doneRes.total}` : (doneOk ? 'Booking submitted' : 'Not booked')} eyebrow="Done">
      <div className="max-w-md mx-auto text-center">
        <div className={'mx-auto h-24 w-24 rounded-full grid place-items-center ' + (doneOk ? 'bg-teal-100 dark:bg-teal-500/15 text-teal-700 dark:text-teal-300' : 'bg-rose-100 text-rose-600')}>{doneOk ? <CheckCircle2 className="h-12 w-12" /> : <XCircle className="h-12 w-12" />}</div>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-4">{doneMsg}</p>
        {doneRes && doneRes.results.length > 0 && (
          <div className="mt-5 text-left rounded-[18px] border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
            {doneRes.results.map((r, i) => (<div key={i} className="flex items-center justify-between px-4 py-2.5 text-sm"><span className="text-slate-700 dark:text-slate-200 truncate">{r.desk_id ? `Seat ${r.desk_id}` : 'Booking'} · {r.identifier}</span>{r.ok ? <span className="text-teal-600 inline-flex items-center gap-1 shrink-0"><CheckCircle2 className="h-4 w-4" />{r.status === 'approved' ? 'confirmed' : 'submitted'}</span> : <span className="text-red-500 inline-flex items-center gap-1 shrink-0"><XCircle className="h-4 w-4" />failed</span>}</div>))}
          </div>
        )}
        {doneOk && <p className="text-sm text-slate-500 dark:text-slate-400 mt-4">A confirmation (with check-in code) has been emailed to each person.</p>}
        <button onClick={startOver} className="mt-8 w-full rounded-[18px] bg-gradient-to-r from-teal-600 to-emerald-600 text-white font-extrabold text-base py-4 hover:opacity-95 transition" style={DISPLAY}>{doneOk ? 'Book another' : 'Try again'}</button>
      </div>
    </Shell>
  );
}
