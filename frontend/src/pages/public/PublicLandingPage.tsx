// F03 - Tenant public landing.
// Route: /p/:slug

import { useEffect, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { Loader2, ArrowRight } from 'lucide-react';
import { publicApi, type LandingPayload } from '@/api/public.api';
import PublicShell, { PublicFacilityCardView } from './components/PublicShell';

export default function PublicLandingPage() {
  const { slug = '' } = useParams();
  const [data, setData] = useState<LandingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    publicApi.landing(slug)
      .then((r) => { if (r.status && r.data) setData(r.data); else setError(r.msg || 'Page not found'); })
      .catch(() => setError('Page not found'))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) return <PublicShell><div className="page-shell flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div></PublicShell>;
  if (error || !data) return <PublicShell><div className="page-shell"><div className="empty-state">{error || 'Page not found'}</div></div></PublicShell>;

  return (
    <PublicShell tenantName={data.tenant.name}>
      <section className="portal-hero">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl sm:text-4xl font-extrabold">{data.tenant.name} · Facilities</h1>
          <p className="opacity-80 mt-2 max-w-xl text-sm sm:text-base">
            {data.facility_count} facilities across {data.site_count} site{data.site_count === 1 ? '' : 's'}.
            Browse below — sign in to book.
          </p>
        </div>
      </section>

      <div className="page-shell">
        <div className="page-header">
          <h2 className="page-title">Featured facilities</h2>
          <RouterLink to={`/p/${data.tenant.slug}/sites`} className="text-sm font-semibold text-primary hover:underline inline-flex items-center gap-1">
            See all sites <ArrowRight className="h-3.5 w-3.5" />
          </RouterLink>
        </div>
        {data.featured.length === 0 ? (
          <div className="empty-state">No public facilities yet.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.featured.map((f) => (
              <PublicFacilityCardView key={f.id} facility={f} slug={data.tenant.slug} />
            ))}
          </div>
        )}
      </div>
    </PublicShell>
  );
}
