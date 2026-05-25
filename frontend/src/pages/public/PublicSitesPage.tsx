// F03 - Public sites listing. Route: /p/:slug/sites
import { useEffect, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { Loader2, Building } from 'lucide-react';
import { publicApi, type SitesPayload } from '@/api/public.api';
import PublicShell from './components/PublicShell';

export default function PublicSitesPage() {
  const { slug = '' } = useParams();
  const [data, setData] = useState<SitesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    publicApi.sites(slug)
      .then((r) => { if (r.status && r.data) setData(r.data); else setError(r.msg || 'Page not found'); })
      .catch(() => setError('Page not found'))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) return <PublicShell><div className="page-shell flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div></PublicShell>;
  if (error || !data) return <PublicShell><div className="page-shell"><div className="empty-state">{error || 'Page not found'}</div></div></PublicShell>;

  return (
    <PublicShell tenantName={data.tenant.name}>
      <div className="page-shell">
        <div className="text-xs text-muted-foreground mb-2">
          <RouterLink to={`/p/${data.tenant.slug}`} className="hover:underline">{data.tenant.name}</RouterLink> · Sites
        </div>
        <h1 className="page-title mb-4">Sites</h1>
        {data.sites.length === 0 ? (
          <div className="empty-state">No public sites yet.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.sites.map((s) => (
              <RouterLink key={s.id} to={`/p/${data.tenant.slug}/sites/${s.id}/facilities`}
                className="panel panel-pad block hover:shadow-md transition-shadow">
                <div className="flex items-start gap-3">
                  <div className="bg-primary/10 text-primary rounded p-2"><Building className="h-5 w-5" /></div>
                  <div>
                    <div className="font-semibold">{s.name}</div>
                    {s.address && <div className="text-xs text-muted-foreground mt-0.5">{s.address}</div>}
                    <div className="text-xs text-muted-foreground mt-1">{s.facility_count} facilities</div>
                  </div>
                </div>
              </RouterLink>
            ))}
          </div>
        )}
      </div>
    </PublicShell>
  );
}
