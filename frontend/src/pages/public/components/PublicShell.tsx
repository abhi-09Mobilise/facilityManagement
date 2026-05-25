// F03 - Lightweight shell around public-portal pages. NOT AppLayout
// (no sidebar, no auth chrome). Just a topbar + sign-in CTA.

import { type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import type { PublicFacilityCard } from '@/api/public.api';

export default function PublicShell({ children, tenantName }: { children: ReactNode; tenantName?: string }) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Building2 className="h-5 w-5 text-primary shrink-0" />
            <span className="font-semibold text-primary truncate">{tenantName || 'Facilities'}</span>
          </div>
          <RouterLink to="/login" className="text-sm font-medium text-primary hover:underline">
            Sign in →
          </RouterLink>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 text-xs text-muted-foreground">
          Powered by Facility Booking
        </div>
      </footer>
    </div>
  );
}

export function PublicFacilityCardView({ facility, slug }: { facility: PublicFacilityCard; slug: string }) {
  return (
    <RouterLink to={`/p/${slug}/facilities/${facility.id}`}
      className="panel panel-pad block hover:shadow-md transition-shadow">
      <div className="h-32 bg-muted rounded mb-3 flex items-center justify-center text-muted-foreground text-xs"
        style={{ backgroundImage: facility.image_url ? `url(${facility.image_url})` : undefined, backgroundSize: 'cover' }}>
        {!facility.image_url && (facility.type || '').replace('_', ' ')}
      </div>
      <div className="font-medium text-foreground truncate">{facility.name}</div>
      <div className="text-xs text-muted-foreground">
        {facility.site_name ? facility.site_name + ' · ' : ''}capacity {facility.capacity}
      </div>
    </RouterLink>
  );
}
