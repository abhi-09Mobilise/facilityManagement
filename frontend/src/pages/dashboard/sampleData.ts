// SAMPLE DATA generator for the SpaceDesk-style dashboard.
//
// Why this file exists:
//   The dashboard screenshot the team wants to replicate shows widgets
//   whose backend data sources either (a) don't exist yet (feedback /
//   ratings, QR scan channel, maintenance state) or (b) exist but need
//   wiring (occupancy_daily, bookings aggregations).
//
//   Rather than hallucinate data in each widget — which is impossible to
//   audit later — ALL mock values are collected here. Every widget
//   imports from this one file. The "SAMPLE DATA" badge on the hero
//   makes it visually clear to users that the numbers are placeholder.
//
//   When a real backend endpoint lands, swap the `getXYZ()` function
//   below to call the API instead. Nothing in the widget code changes.

export const SAMPLE_DATA_BANNER = 'SAMPLE DATA';

// Master switch for the mock fallback used when the backend returns no
// data. Keep this `false` for testing and production so widgets show
// honest zeros / empty lists / "—" instead of made-up Rahul-and-Masala-chai
// numbers. Flip to `true` only during early UI work on an empty tenant
// where you need the dashboard to render with demo values.
const USE_SAMPLE_FALLBACK = false;

// ---------- Overview hero ----------
export interface HeroOverview {
  nowLabel: string;              // "Wednesday, 7 Oct 2026 · 11:40"
  siteFilter: string;            // "All sites"
  summary: string;               // "48 facilities across 6 buildings"
  rangeDays: 7 | 30 | 90;
  occupiedPercent: number;       // 58
  inUseNow: number;              // 28
  startingWithin30Min: number;   // 8
  availableToBook: number;       // 11
}

export function getHeroOverview(overlay?: Partial<HeroOverview>): HeroOverview {
  const now = new Date();
  const weekday = now.toLocaleDateString('en-GB', { weekday: 'long' });
  const dayMonth = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const hhmm = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const base: HeroOverview = USE_SAMPLE_FALLBACK ? {
    nowLabel: `${weekday}, ${dayMonth} · ${hhmm}`,
    siteFilter: 'All sites',
    summary: 'All sites · last 30 days · 48 facilities across 6 buildings',
    rangeDays: 30,
    occupiedPercent: 58,
    inUseNow: 28,
    startingWithin30Min: 8,
    availableToBook: 11,
  } : {
    // Empty-state baseline — overlay from the live hook populates the
    // real numbers; everything the backend doesn't fill stays zero.
    nowLabel: `${weekday}, ${dayMonth} · ${hhmm}`,
    siteFilter: 'All sites',
    summary: '',
    rangeDays: 30,
    occupiedPercent: 0,
    inUseNow: 0,
    startingWithin30Min: 0,
    availableToBook: 0,
  };
  return overlay ? { ...base, ...overlay } : base;
}

// ---------- KPI tiles ----------
export interface KpiTile {
  label: string;
  value: string;
  // When true the big value renders in a muted colour — used for tiles
  // whose metric isn't live yet.
  valueMuted?: boolean;
  secondary?: string;
  trend?: { seriesKey: string; direction: 'up' | 'down'; percent: number; color: string };
  spark: number[];
  // Optional denominator rendered as "value / max" (e.g. 0 / 283). Backed
  // by the real total-facilities count when the overlay sets it; omitted
  // when unknown.
  max?: number;
  // Per-site breakdown for the stacked bar inside the "Total facilities"
  // tile. Comes from the live facilities list grouped by site. When
  // omitted the stacked bar renders empty rather than fabricating labels.
  siteBreakdown?: { name: string; count: number; color: string }[];
}

export function getKpiTiles(overlay?: Record<string, Partial<KpiTile>>): KpiTile[] {
  const sample: KpiTile[] = [
    { label: 'Total facilities',    value: '48',    secondary: '3 sites · 6 facility types', spark: [] },
    { label: 'Booked right now',    value: '28',    secondary: '58% occupied · 80 more today', spark: [10, 14, 16, 18, 20, 24, 22, 25, 27, 28] },
    { label: 'Bookings · 30 days',  value: '4,819', trend: { seriesKey: 'bookings', direction: 'up', percent: 12.6, color: '#16a34a' }, secondary: 'vs previous 30 days', spark: [120, 180, 90, 210, 160, 170, 220, 150, 190, 230, 180, 210] },
    { label: 'Average feedback',    value: '4.1',   secondary: '1,012 reviews', spark: [3.9, 4.0, 4.0, 3.9, 4.0, 4.1, 4.0, 4.2, 4.1, 4.1] },
    { label: 'Pantry orders',       value: '768',   secondary: '19 per 100 check-ins', spark: [20, 24, 18, 30, 28, 25, 32, 20, 26, 30, 22, 28] },
    { label: 'Biometric mismatches',value: '—', valueMuted: true, secondary: 'Last 30 days', spark: [] },
  ];
  // Honest empty state — labels + "—" so cards keep their layout but
  // show no fabricated numbers. The live overlay then fills in real
  // values per tile where the backend provided them.
  const empty: KpiTile[] = [
    { label: 'Total facilities',    value: '—', valueMuted: true, secondary: '', spark: [] },
    { label: 'Booked right now',    value: '—', valueMuted: true, secondary: '', spark: [] },
    { label: 'Bookings · 30 days',  value: '—', valueMuted: true, secondary: '', spark: [] },
    { label: 'Average feedback',    value: '—', valueMuted: true, secondary: '', spark: [] },
    { label: 'Pantry orders',       value: '—', valueMuted: true, secondary: '', spark: [] },
    { label: 'Biometric mismatches',value: '—', valueMuted: true, secondary: 'Last 30 days', spark: [] },
  ];
  const base = USE_SAMPLE_FALLBACK ? sample : empty;
  if (!overlay) return base;
  return base.map((tile) => (overlay[tile.label] ? { ...tile, ...overlay[tile.label] } : tile));
}

// ---------- Bookings over time ----------
export interface BookingsOverTimePoint {
  day: string;      // "8 Sept"
  bookings: number;
  checkins: number;
}

// Optional overlay REPLACES both the series and summary when provided.
// Partial overlays aren't supported — the live hook either returns a
// complete object or null.
export function getBookingsOverTime(
  overlay?: {
    series: BookingsOverTimePoint[];
    summary: { checkedIn: number; cancelled: number; noShows: number; busiest: { day: string; count: number } };
  } | null,
): {
  series: BookingsOverTimePoint[];
  summary: { checkedIn: number; cancelled: number; noShows: number; busiest: { day: string; count: number } };
} {
  if (overlay && overlay.series.length > 0) return overlay;
  if (!USE_SAMPLE_FALLBACK) {
    return {
      series: [],
      summary: { checkedIn: 0, cancelled: 0, noShows: 0, busiest: { day: '—', count: 0 } },
    };
  }
  // 28 daily points — 8 Sept through 5 Oct. Weekdays sit around 200–240,
  // weekends dip into the 25–50 range. Four full weekly cycles produce the
  // zigzag the hero chart shows between every third x-axis label.
  const labels = [
    ...Array.from({ length: 23 }, (_, i) => `${i + 8} Sept`),  // 8 Sept .. 30 Sept
    ...Array.from({ length: 5 },  (_, i) => `${i + 1} Oct`),    // 1 Oct  .. 5 Oct
  ];
  const bookings = [
    205, 220, 215, 218, 200,  // Mon–Fri (week 1)
    40,  30,                  // Sat–Sun
    210, 225, 220, 195, 205,  // Mon–Fri (week 2)
    45,  28,                  // Sat–Sun
    237, 220, 215, 210, 185,  // Mon–Fri (week 3) — 22 Sept is the busiest day
    48,  35,                  // Sat–Sun
    215, 220, 210, 215, 200,  // Mon–Fri (week 4)
    50,  32,                  // Sat–Sun
  ];
  const checkins = bookings.map((b) => Math.round(b * (b > 100 ? 0.85 : 0.75)));
  return {
    series: labels.map((day, i) => ({ day, bookings: bookings[i], checkins: checkins[i] })),
    summary: {
      checkedIn: 4042,
      cancelled: 327,
      noShows: 450,
      busiest: { day: '22 Sept', count: 237 },
    },
  };
}

// ---------- Booking channel donut ----------
export interface ChannelSlice {
  name: string;
  value: number;
  color: string;
}

// Optional overlay REPLACES the mock donut when provided. Live hook
// passes it only when backend reports total > 0.
export function getBookingChannel(
  overlay?: { slices: ChannelSlice[]; total: number } | null,
): { slices: ChannelSlice[]; total: number } {
  if (overlay && overlay.total > 0) return overlay;
  if (!USE_SAMPLE_FALLBACK) {
    return {
      total: 0,
      slices: [
        { name: 'QR walk-in',   value: 0, color: '#8b5cf6' },
        { name: 'Mobile app',   value: 0, color: '#3b82f6' },
        { name: 'Web portal',   value: 0, color: '#10b981' },
        { name: 'Door tablet',  value: 0, color: '#f59e0b' },
      ],
    };
  }
  return {
    total: 4819,
    slices: [
      { name: 'QR walk-in',   value: 1163, color: '#8b5cf6' },
      { name: 'Mobile app',   value: 1854, color: '#3b82f6' },
      { name: 'Web portal',   value: 1200, color: '#10b981' },
      { name: 'Door tablet',  value: 602,  color: '#f59e0b' },
    ],
  };
}

// ---------- Live facility status ----------
export interface LiveFacility {
  id: string;
  name: string;
  type: string;
  site: string;
  state: 'in_use' | 'starting_soon' | 'available' | 'maintenance';
  note?: string;
}

// If `overlay` is a non-empty array it REPLACES the mock entries entirely
// — used by the live hook once real per-facility snapshots start flowing.
// Pass `null` or omit to keep the mock list.
export function getLiveFacilityStatus(overlay?: LiveFacility[] | null): LiveFacility[] {
  if (overlay && overlay.length > 0) return overlay;
  if (!USE_SAMPLE_FALLBACK) return [];
  return [
    { id: 'f1',  name: 'Palghat',    type: 'Conference Hall', site: 'Pune',           state: 'maintenance',   note: 'Under maintenance' },
    { id: 'f2',  name: 'Shivalik',   type: 'Conference Hall', site: 'Pune Tech Park', state: 'in_use',        note: 'In use · 10:00–11:00' },
    { id: 'f3',  name: 'Aravalli',   type: 'Conference Hall', site: 'Mumbai HQ',      state: 'in_use',        note: 'In use · 09:30–12:00' },
    { id: 'f4',  name: 'Nilgiri',    type: 'Meeting Room',    site: 'Mumbai HQ',      state: 'starting_soon', note: 'Starts in 18 min' },
    { id: 'f5',  name: 'Lothal',     type: 'Training Room',   site: 'Bengaluru',      state: 'available',     note: 'Free until 15:00' },
    { id: 'f6',  name: 'Yamuna',     type: 'Meeting Room',    site: 'Mumbai HQ',      state: 'available',     note: 'Free all day' },
    { id: 'f7',  name: 'Krishna',    type: 'Meeting Room',    site: 'Mumbai HQ',      state: 'in_use',        note: 'In use · 11:00–12:30' },
    { id: 'f8',  name: 'Chilika',    type: 'Hot Desk Zone',   site: 'Bengaluru',      state: 'starting_soon', note: 'Starts in 25 min' },
    { id: 'f9',  name: 'Dholavira',  type: 'Conference Hall', site: 'Bengaluru',      state: 'in_use',        note: 'In use · 10:30–13:00' },
    { id: 'f10', name: 'Kutch',      type: 'Meeting Room',    site: 'Pune Tech Park', state: 'available',     note: 'Free until 14:00' },
    { id: 'f11', name: 'Ellora',     type: 'Training Room',   site: 'Mumbai HQ',      state: 'in_use',        note: 'In use · 09:00–12:30' },
    { id: 'f12', name: 'Vindhya',    type: 'Meeting Room',    site: 'Pune Tech Park', state: 'starting_soon', note: 'Starts in 10 min' },
    { id: 'f13', name: 'Wayanad',    type: 'Hot Desk Zone',   site: 'Bengaluru',      state: 'available',     note: 'Free all day' },
    { id: 'f14', name: 'Orchha',     type: 'Phone Booth',     site: 'Bengaluru',      state: 'in_use',        note: 'In use · 11:15–11:45' },
    { id: 'f15', name: 'Dudhsagar',  type: 'Meeting Room',    site: 'Bengaluru',      state: 'available',     note: 'Free until 16:00' },
    { id: 'f16', name: 'Badami',     type: 'Hot Desk Zone',   site: 'Bengaluru',      state: 'in_use',        note: 'In use · 09:00–18:00' },
    { id: 'f17', name: 'Malabar',    type: 'Hot Desk Zone',   site: 'Mumbai HQ',      state: 'maintenance',   note: 'HVAC repair' },
    { id: 'f18', name: 'Satpura',    type: 'Meeting Room',    site: 'Pune',           state: 'starting_soon', note: 'Starts in 5 min' },
    { id: 'f19', name: 'Konkan',     type: 'Training Room',   site: 'Pune Tech Park', state: 'available',     note: 'Free until 13:00' },
    { id: 'f20', name: 'Himalaya',   type: 'Conference Hall', site: 'Mumbai HQ',      state: 'in_use',        note: 'In use · 10:00–12:00' },
  ];
}

// ---------- Most booked ----------
export interface MostBookedRow {
  key: string;
  bookings: number;
}

// Optional overlay keyed by the current mode. Non-empty array for the
// requested mode replaces the mock list for that mode only.
export function getMostBooked(
  by: 'facility' | 'type',
  overlay?: { facility?: MostBookedRow[]; type?: MostBookedRow[] } | null,
): MostBookedRow[] {
  const live = overlay?.[by];
  if (live && live.length > 0) return live;
  if (!USE_SAMPLE_FALLBACK) return [];
  if (by === 'facility') {
    return [
      { key: 'Dholavira', bookings: 198 },
      { key: 'Krishna',   bookings: 182 },
      { key: 'Kutch',     bookings: 174 },
      { key: 'Ellora',    bookings: 161 },
      { key: 'Yamuna',    bookings: 153 },
      { key: 'Vindhya',   bookings: 148 },
      { key: 'Chilika',   bookings: 142 },
      { key: 'Wayanad',   bookings: 135 },
    ];
  }
  return [
    { key: 'Conference Hall',  bookings: 1820 },
    { key: 'Meeting Room',     bookings: 1540 },
    { key: 'Hot Desk Zone',    bookings: 810 },
    { key: 'Training Room',    bookings: 420 },
    { key: 'Phone Booth',      bookings: 180 },
    { key: 'Gym',              bookings: 49 },
  ];
}

// ---------- Peak booking times (heatmap) ----------
export interface PeakCell {
  weekday: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
  hour: number;      // 8..20
  count: number;
}

// Optional overlay REPLACES the full heatmap when provided. The live
// hook either returns a complete object (from dashboardsApi.peakTimes)
// or null so partial overlays aren't a concern here.
export function getPeakBookingTimes(
  overlay?: {
    cells: PeakCell[];
    busiestSlot: string;
    busiestHour: string;
    quietestWorking: string;
    maxPerSlot: number;
  } | null,
): {
  cells: PeakCell[];
  busiestSlot: string;
  busiestHour: string;
  quietestWorking: string;
  maxPerSlot: number;
} {
  if (overlay && overlay.cells.length > 0) return overlay;
  if (!USE_SAMPLE_FALLBACK) {
    return { cells: [], busiestSlot: '—', busiestHour: '—', quietestWorking: '—', maxPerSlot: 0 };
  }
  const days: PeakCell['weekday'][] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const hours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  const cells: PeakCell[] = [];
  // Pattern: weekday mornings (9-12) and afternoons (14-16) are hot;
  // weekends are mostly quiet. Values roughly match the screenshot.
  for (const d of days) {
    const isWeekend = d === 'Sat' || d === 'Sun';
    for (const h of hours) {
      let base = 0;
      if (!isWeekend) {
        if (h >= 9 && h <= 11)  base = 90 + (h === 10 ? 25 : 0);
        else if (h === 12)       base = 55;
        else if (h >= 13 && h <= 16) base = 70 + (h === 14 || h === 15 ? 15 : 0);
        else if (h === 17)       base = 55;
        else if (h === 18)       base = 25;
        else                     base = 15;
      } else {
        base = h >= 10 && h <= 14 ? 25 : 10;
        if (d === 'Sun') base = Math.round(base * 0.5);
      }
      // Mild daily variation.
      const varPct = 1 + ((d.charCodeAt(0) + h) % 7 - 3) * 0.03;
      cells.push({ weekday: d, hour: h, count: Math.round(base * varPct) });
    }
  }
  return {
    cells,
    busiestSlot: 'Tue, 10:00–11:00',
    busiestHour: '10:00 · Tue',
    quietestWorking: '18:00–19:00',
    maxPerSlot: 123,
  };
}

// ---------- Recent activity ----------
export interface ActivityItem {
  id: string;
  icon: 'checkin' | 'rating' | 'pantry' | 'booking';
  title: string;
  description: string;
  ago: string;
}

// If `overlay` is a non-empty array it REPLACES the mock items entirely —
// used by the live hook once real booking rows start flowing in. Pass
// `null` or omit to keep the mock feed.
export function getRecentActivity(overlay?: ActivityItem[] | null): ActivityItem[] {
  if (overlay && overlay.length > 0) return overlay;
  if (!USE_SAMPLE_FALLBACK) return [];
  return [
    { id: 'a1', icon: 'booking', title: '**Rahul M.** booked **Badami**',        description: 'Web portal · 17:00 for 60 min · Bengaluru Campus', ago: '55m ago' },
    { id: 'a2', icon: 'pantry',  title: 'Pantry order for **Orchha**',           description: '4 × Cookies · by Rohit G. · Bengaluru Campus',     ago: '50m ago' },
    { id: 'a3', icon: 'rating',  title: '**Priya S.** rated **Orchha** 5★',      description: '"Quiet" · Bengaluru Campus',                       ago: '45m ago' },
    { id: 'a4', icon: 'checkin', title: '**Aditya B.** checked in to **Lothal**',description: 'QR scan · on time · Bengaluru Campus',             ago: '43m ago' },
    { id: 'a5', icon: 'booking', title: '**Meera T.** booked **Yamuna**',        description: 'Mobile app · 14:00 for 30 min · Mumbai HQ',       ago: '38m ago' },
    { id: 'a6', icon: 'pantry',  title: 'Pantry order for **Nilgiri**',          description: '2 × Masala chai · by Vikram S.',                   ago: '32m ago' },
    { id: 'a7', icon: 'checkin', title: '**Divya K.** checked in to **Krishna**',description: 'QR scan · 2 min late · Mumbai HQ',                 ago: '28m ago' },
  ];
}

// ---------- Feedback across facilities ----------
export interface FeedbackRow {
  initials: string;
  name: string;
  type: string;
  site: string;
  rating: number;
  reviews: number;
  mostMentioned: string;
}

// Optional overlay REPLACES the full mock payload when provided. The live
// hook only passes it when reviews > 0 so partial overlays aren't a
// concern — either we have real ratings and show them, or we fall back
// to the demo set.
export function getFeedback(
  overlay?: {
    overall: number;
    reviews: number;
    distribution: { stars: 5 | 4 | 3 | 2 | 1; percent: number }[];
    needsAttention: FeedbackRow[];
    topRated: FeedbackRow[];
  } | null,
): {
  overall: number;
  distribution: { stars: 5 | 4 | 3 | 2 | 1; percent: number }[];
  reviews: number;
  needsAttention: FeedbackRow[];
  topRated: FeedbackRow[];
} {
  if (overlay && overlay.reviews > 0) return overlay;
  if (!USE_SAMPLE_FALLBACK) {
    return {
      overall: 0,
      reviews: 0,
      distribution: [
        { stars: 5, percent: 0 }, { stars: 4, percent: 0 }, { stars: 3, percent: 0 },
        { stars: 2, percent: 0 }, { stars: 1, percent: 0 },
      ],
      needsAttention: [],
      topRated: [],
    };
  }
  const needs: FeedbackRow[] = [
    { initials: 'Sh', name: 'Shivalik', type: 'Conference Hall', site: 'Pune Tech Park', rating: 3.4, reviews: 23, mostMentioned: 'Wi-Fi drops' },
    { initials: 'Ar', name: 'Aravalli', type: 'Conference Hall', site: 'Mumbai HQ',       rating: 3.4, reviews: 12, mostMentioned: 'Wi-Fi drops' },
    { initials: 'Ni', name: 'Nilgiri',  type: 'Meeting Room',    site: 'Mumbai HQ',       rating: 3.4, reviews: 26, mostMentioned: 'Cleanliness' },
    { initials: 'Lo', name: 'Lothal',   type: 'Training Room',   site: 'Bengaluru Campus',rating: 3.4, reviews: 12, mostMentioned: 'Booking overlap' },
    { initials: 'Ma', name: 'Malabar',  type: 'Hot Desk Zone',   site: 'Mumbai HQ',       rating: 3.4, reviews: 14, mostMentioned: 'Booking overlap' },
    { initials: 'Vi', name: 'Vindhya',  type: 'Meeting Room',    site: 'Pune Tech Park',  rating: 3.5, reviews: 18, mostMentioned: 'AC too cold' },
  ];
  const top: FeedbackRow[] = [
    { initials: 'Or', name: 'Orchha',   type: 'Phone Booth',     site: 'Bengaluru Campus',rating: 4.8, reviews: 42, mostMentioned: 'Quiet' },
    { initials: 'Du', name: 'Dudhsagar',type: 'Meeting Room',    site: 'Bengaluru Campus',rating: 4.7, reviews: 36, mostMentioned: 'Great Wi-Fi' },
    { initials: 'Ba', name: 'Badami',   type: 'Hot Desk Zone',   site: 'Bengaluru Campus',rating: 4.6, reviews: 55, mostMentioned: 'Comfortable' },
    { initials: 'Kr', name: 'Krishna',  type: 'Meeting Room',    site: 'Mumbai HQ',       rating: 4.5, reviews: 28, mostMentioned: 'Spacious' },
    { initials: 'Ya', name: 'Yamuna',   type: 'Meeting Room',    site: 'Mumbai HQ',       rating: 4.5, reviews: 19, mostMentioned: 'Natural light' },
  ];
  return {
    overall: 4.1,
    reviews: 1012,
    distribution: [
      { stars: 5, percent: 49 },
      { stars: 4, percent: 28 },
      { stars: 3, percent: 11 },
      { stars: 2, percent: 7 },
      { stars: 1, percent: 5 },
    ],
    needsAttention: needs,
    topRated: top,
  };
}

// ---------- Pantry orders ----------
export interface PantryItem {
  name: string;
  orders: number;
  color: string;
}

// Live overlay: when the hook returns a non-null payload from
// dashboardsApi.pantryOrders(), it replaces the mock summary + daily +
// topItems. `delivered` / `inProgress` / `avgDeliveryMin` are nullable
// because the pantry module doesn't track delivery lifecycle yet — the
// widget renders those as a muted "—" when null.
export interface PantryOrdersData {
  created: number;
  delivered: number | null;
  inProgress: number | null;
  avgDeliveryMin: number | null;
  daily: { day: string; orders: number }[];
  topItems: PantryItem[];
}

export function getPantryOrders(overlay?: PantryOrdersData | null): PantryOrdersData {
  if (overlay && overlay.created > 0) return overlay;
  if (!USE_SAMPLE_FALLBACK) {
    return { created: 0, delivered: null, inProgress: null, avgDeliveryMin: null, daily: [], topItems: [] };
  }
  const dayLabels = ['8 Sept','16 Sept','24 Sept','2 Oct'];
  const bars: { day: string; orders: number }[] = [];
  const sampleOrders = [26, 30, 10, 32, 18, 24, 20, 36, 32, 34, 22, 10, 28, 24, 36, 32, 34, 28, 20, 10, 30, 36, 32, 24, 28, 32, 36, 28];
  for (let i = 0; i < sampleOrders.length; i++) {
    bars.push({
      day: dayLabels[Math.min(dayLabels.length - 1, Math.floor(i / 7))],
      orders: sampleOrders[i],
    });
  }
  return {
    created: 768,
    delivered: 714,
    inProgress: 7,
    avgDeliveryMin: 7,
    daily: bars,
    topItems: [
      { name: 'Masala chai',       orders: 439, color: '#f97316' },
      { name: 'Filter coffee',     orders: 322, color: '#f97316' },
      { name: 'Water bottle',      orders: 238, color: '#f97316' },
      { name: 'Veggie sandwich',   orders: 161, color: '#f97316' },
    ],
  };
}
