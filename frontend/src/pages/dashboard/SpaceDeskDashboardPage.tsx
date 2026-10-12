// SpaceDesk — Facility Booking dashboard (wired to the "Live overview"
// sidebar entry at /overview).
//
// Renders only the hero, KPI tiles, and six analytics cards. The sidebar
// and header come from AppLayout — this page does NOT bring its own
// sidebar, so the shared dark-forest-green AppLayout chrome stays
// consistent across every route.
//
// All data currently comes from `sampleData.ts` (clearly labelled
// "SAMPLE DATA" in the hero badge). Each widget calls a `get*()` helper
// in sampleData.ts, so swapping those to real API calls later leaves the
// widget code untouched.

import { HeroOverview } from './widgets/HeroOverview';
import { KpiTiles } from './widgets/KpiTiles';
import { BookingsOverTime } from './widgets/BookingsOverTime';
import { BookingChannel } from './widgets/BookingChannel';
import { LiveFacilityStatus } from './widgets/LiveFacilityStatus';
import { MostBooked } from './widgets/MostBooked';
import { PeakBookingTimes } from './widgets/PeakBookingTimes';
import { RecentActivity } from './widgets/RecentActivity';
import { FeedbackPanel } from './widgets/FeedbackPanel';
import { PantryOrdersPanel } from './widgets/PantryOrdersPanel';

export default function SpaceDeskDashboardPage() {
  return (
    <div className="mx-auto max-w-[1500px] space-y-5 md:space-y-6">
      {/* 1. Hero */}
      <HeroOverview />

      {/* 2. KPI tiles */}
      <KpiTiles />

      {/* 3. Bookings over time (2/3) + Booking channel (1/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 md:gap-6">
        <div className="lg:col-span-2">
          <BookingsOverTime />
        </div>
        <div>
          <BookingChannel />
        </div>
      </div>

      {/* 4. Live facility status (2/3) + Most booked (1/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 md:gap-6">
        <div className="lg:col-span-2">
          <LiveFacilityStatus />
        </div>
        <div>
          <MostBooked />
        </div>
      </div>

      {/* 5. Peak booking times (2/3) + Recent activity (1/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 md:gap-6">
        <div className="lg:col-span-2">
          <PeakBookingTimes />
        </div>
        <div>
          <RecentActivity />
        </div>
      </div>

      {/* 6. Feedback across facilities (2/3) + Pantry orders (1/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 md:gap-6">
        <div className="lg:col-span-2">
          <FeedbackPanel />
        </div>
        <div>
          <PantryOrdersPanel />
        </div>
      </div>
    </div>
  );
}
