// SpaceDesk — Facility Booking dashboard (wired to the "Live overview"
// sidebar entry at /overview).
//
// Renders only the hero, KPI tiles, and six analytics cards. The sidebar
// and header come from AppLayout — this page does NOT bring its own
// sidebar, so the shared dark-forest-green AppLayout chrome stays
// consistent across every route.
//
// Phase 1 + 1.5 — several widgets receive a `liveOverlay` prop that
// contains fields derived from existing backend endpoints
// (dashboardsApi.tenantAdmin + bookingsApi.list + dashboardsApi.gantt +
// sitesApi.list + facilitiesApi.list). Widgets without live coverage
// continue to render from sampleData.ts until Phase 2 adds the missing
// endpoints (booking channel, feedback, pantry orders, peak heatmap).

import { useState } from 'react';
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
import { useLiveDashboardData } from './useLiveDashboardData';

type RangeDays = 7 | 30 | 90;

export default function SpaceDeskDashboardPage() {
  const [siteId, setSiteId] = useState<number | null>(null);
  const [rangeDays, setRangeDays] = useState<RangeDays>(30);

  const {
    heroOverlay, kpiOverlay, activityOverlay,
    facilityStatusOverlay, mostBookedOverlay, bookingsOverTimeOverlay, peakTimesOverlay,
    pantryOrdersOverlay, bookingChannelOverlay, feedbackOverlay,
    sites,
  } = useLiveDashboardData({ siteId, rangeDays });

  const heroHasLiveFields = Object.keys(heroOverlay).length > 0;

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 md:space-y-6">
      {/* 1. Hero */}
      <HeroOverview
        liveOverlay={heroOverlay}
        isLive={heroHasLiveFields}
        sites={sites}
        selectedSiteId={siteId}
        onSiteChange={setSiteId}
        rangeDays={rangeDays}
        onRangeChange={setRangeDays}
      />

      {/* 2. KPI tiles */}
      <KpiTiles liveOverlay={kpiOverlay} />

      {/* 3. Bookings over time (2/3) + Booking channel (1/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 md:gap-6">
        <div className="lg:col-span-2">
          <BookingsOverTime liveOverlay={bookingsOverTimeOverlay} />
        </div>
        <div>
          <BookingChannel liveOverlay={bookingChannelOverlay} />
        </div>
      </div>

      {/* 4. Live facility status (2/3) + Most booked (1/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 md:gap-6">
        <div className="lg:col-span-2">
          <LiveFacilityStatus liveOverlay={facilityStatusOverlay} />
        </div>
        <div>
          <MostBooked liveOverlay={mostBookedOverlay} />
        </div>
      </div>

      {/* 5. Peak booking times (2/3) + Recent activity (1/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 md:gap-6">
        <div className="lg:col-span-2">
          <PeakBookingTimes liveOverlay={peakTimesOverlay} />
        </div>
        <div>
          <RecentActivity liveOverlay={activityOverlay} />
        </div>
      </div>

      {/* 6. Feedback across facilities (2/3) + Pantry orders (1/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 md:gap-6">
        <div className="lg:col-span-2">
          <FeedbackPanel liveOverlay={feedbackOverlay} />
        </div>
        <div>
          <PantryOrdersPanel liveOverlay={pantryOrdersOverlay} />
        </div>
      </div>
    </div>
  );
}
