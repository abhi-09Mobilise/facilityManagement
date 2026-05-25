// F03 - Public facility detail page. Route: /p/:slug/facilities/:id
import { useEffect, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { publicApi, type FacilityDetailPayload } from '@/api/public.api';
import PublicShell from './components/PublicShell';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function PublicFacilityDetailPage() {
  const { slug = '', id = '' } = useParams();
  const [data, setData] = useState<FacilityDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    publicApi.facility(slug, Number(id))
      .then((r) => { if (r.status && r.data) setData(r.data); else setError(r.msg || 'Facility not found'); })
      .catch(() => setError('Facility not found'))
      .finally(() => setLoading(false));
  }, [slug, id]);

  if (loading) return <PublicShell><div className="page-shell flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div></PublicShell>;
  if (error || !data) return <PublicShell><div className="page-shell"><div className="empty-state">{error || 'Facility not found'}</div></div></PublicShell>;

  const f = data.facility;
  // Group hours by day for display.
  const byDay: Record<number, { open: string; close: string }[]> = {};
  data.operating_hours.forEach((h) => {
    (byDay[h.day_of_week] = byDay[h.day_of_week] || []).push({ open: h.open_time, close: h.close_time });
  });

  return (
    <PublicShell tenantName={data.tenant.name}>
      <div className="page-shell">
        <div className="text-xs text-muted-foreground mb-2">
          <RouterLink to={`/p/${data.tenant.slug}`} className="hover:underline">{data.tenant.name}</RouterLink>
          {' · '}
          <span className="text-foreground">{f.name}</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6">
          <div>
            <div className="h-48 sm:h-64 bg-muted rounded mb-4"
              style={{ backgroundImage: f.image_url ? `url(${f.image_url})` : undefined, backgroundSize: 'cover' }} />
            <h1 className="page-title">{f.name}</h1>
            {f.site_name && <p className="page-subtitle mb-3">{f.site_name}</p>}
            {f.description && <p className="text-sm leading-6 text-foreground/80">{f.description}</p>}
          </div>

          <div className="space-y-3">
            <div className="panel panel-pad">
              <div className="kpi-label">Capacity</div>
              <div className="kpi-value">{f.capacity}</div>
            </div>
            <div className="panel panel-pad">
              <div className="kpi-label mb-2">Operating hours</div>
              {Object.keys(byDay).length === 0 ? (
                <div className="text-sm text-muted-foreground">Hours not published.</div>
              ) : (
                <ul className="text-sm space-y-0.5">
                  {DOW.map((label, i) => {
                    const list = byDay[i];
                    if (!list) return null;
                    return (
                      <li key={i} className="flex justify-between">
                        <span className="text-muted-foreground">{label}</span>
                        <span>{list.map((r) => `${r.open}–${r.close}`).join(', ')}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <Button asChild className="w-full justify-center">
              <RouterLink to="/login">Sign in to book</RouterLink>
            </Button>
          </div>
        </div>
      </div>
    </PublicShell>
  );
}
