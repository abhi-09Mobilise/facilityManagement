// F03 - Public site facilities listing. Route: /p/:slug/sites/:siteId/facilities
import { useEffect, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { publicApi, type SiteFacilitiesPayload } from '@/api/public.api';
import PublicShell, { PublicFacilityCardView } from './components/PublicShell';

export default function PublicSiteFacilitiesPage() {
  const { slug = '', siteId = '' } = useParams();
  const [data, setData] = useState<SiteFacilitiesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    publicApi.siteFacilities(slug, Number(siteId))
      .then((r) => { if (r.status && r.data) setData(r.data); else setError(r.msg || 'Page not found'); })
      .catch(() => setError('Page not found'))
      .finally(() => setLoading(false));
  }, [slug, siteId]);

  if (loading) return <PublicShell><div className="page-shell flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div></PublicShell>;
  if (error || !data) return <PublicShell><div className="page-shell"><div className="empty-state">{error || 'Page not found'}</div></div></PublicShell>;

  return (
    <PublicShell tenantName={data.tenant.name}>
      <div className="page-shell">
        <div className="text-xs text-muted-foreground mb-2">
          <RouterLink to={`/p/${data.tenant.slug}`} className="hover:underline">{data.tenant.name}</RouterLink>
          {' · '}
          <RouterLink to={`/p/${data.tenant.slug}/sites`} className="hover:underline">Sites</RouterLink>
          {' · '}
          <span className="text-foreground">{data.site.name}</span>
        </div>
        <h1 className="page-title">{data.site.name}</h1>
        {data.site.address && <p className="page-subtitle mb-4">{data.site.address}</p>}
        {data.facilities.length === 0 ? (
          <div className="empty-state">No public facilities at this site yet.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.facilities.map((f) => (
              <PublicFacilityCardView key={f.id} facility={f} slug={data.tenant.slug} />
            ))}
          </div>
        )}
      </div>
    </PublicShell>
  );
}
