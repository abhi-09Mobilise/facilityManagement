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

export function getHeroOverview(): HeroOverview {
  const now = new Date();
  const weekday = now.toLocaleDateString('en-GB', { weekday: 'long' });
  const dayMonth = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const hhmm = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return {
    nowLabel: `${weekday}, ${dayMonth} · ${hhmm}`,
    siteFilter: 'All sites',
    summary: 'All sites · last 30 days · 48 facilities across 6 buildings',
    rangeDays: 30,
    occupiedPercent: 58,
    inUseNow: 28,
    startingWithin30Min: 8,
    availableToBook: 11,
  };
}

// ---------- KPI tiles ----------
export interface KpiTile {
  label: string;
  value: string;
  // When true the big value renders in a muted colour — used for tiles
  // whose metric isn't live yet (e.g. the Phase-2 biometric integration).
  valueMuted?: boolean;
  secondary?: string;
  trend?: { seriesKey: string; direction: 'up' | 'down'; percent: number; color: string };
  spark: number[];
}

export function getKpiTiles(): KpiTile[] {
  return [
    {
      label: 'Total facilities',
      value: '48',
      secondary: '3 sites · 6 facility types',
      spark: [],
    },
    {
      label: 'Booked right now',
      value: '28',
      secondary: '58% occupied · 80 more today',
      spark: [10, 14, 16, 18, 20, 24, 22, 25, 27, 28],
    },
    {
      label: 'Bookings · 30 days',
      value: '4,819',
      trend: { seriesKey: 'bookings', direction: 'up', percent: 12.6, color: '#16a34a' },
      secondary: 'vs previous 30 days',
      spark: [120, 180, 90, 210, 160, 170, 220, 150, 190, 230, 180, 210],
    },
    {
      label: 'Average feedback',
      value: '4.1',
      secondary: '1,012 reviews',
      spark: [3.9, 4.0, 4.0, 3.9, 4.0, 4.1, 4.0, 4.2, 4.1, 4.1],
    },
    {
      label: 'Pantry orders',
      value: '768',
      secondary: '19 per 100 check-ins',
      spark: [20, 24, 18, 30, 28, 25, 32, 20, 26, 30, 22, 28],
    },
    {
      // Phase-2 placeholder mirrored from LiveOverviewPage's Kpi row.
      // Keeps the muted dash + "connects with the biometric integration"
      // subtitle so the two surfaces read the same.
      label: 'Biometric mismatches',
      value: '—',
      valueMuted: true,
      secondary: 'connects with the biometric integration (Phase 2)',
      spark: [],
    },
  ];
}

// ---------- Bookings over time ----------
export interface BookingsOverTimePoint {
  day: string;      // "8 Sept"
  bookings: number;
  checkins: number;
}

export function getBookingsOverTime(): {
  series: BookingsOverTimePoint[];
  summary: { checkedIn: number; cancelled: number; noShows: number; busiest: { day: string; count: number } };
} {
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

export function getBookingChannel(): { slices: ChannelSlice[]; total: number } {
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

export function getLiveFacilityStatus(): LiveFacility[] {
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

export function getMostBooked(by: 'facility' | 'type'): MostBookedRow[] {
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

export function getPeakBookingTimes(): {
  cells: PeakCell[];
  busiestSlot: string;
  busiestHour: string;
  quietestWorking: string;
  maxPerSlot: number;
} {
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

export function getRecentActivity(): ActivityItem[] {
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

export function getFeedback(): {
  overall: number;
  distribution: { stars: 5 | 4 | 3 | 2 | 1; percent: number }[];
  reviews: number;
  needsAttention: FeedbackRow[];
  topRated: FeedbackRow[];
} {
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

export function getPantryOrders(): {
  created: number;
  delivered: number;
  inProgress: number;
  avgDeliveryMin: number;
  daily: { day: string; orders: number }[];
  topItems: PantryItem[];
} {
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
