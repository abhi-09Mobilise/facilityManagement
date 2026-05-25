// F06 - Pantries list (admin).
// Mobile: rows stack as cards via .data-table styles. Desktop: regular table.

import { useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { Plus, Coffee } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { pantriesApi, type Pantry } from '@/api/pantries.api';

export default function PantriesListPage() {
  const nav = useNavigate();
  const [rows, setRows] = useState<Pantry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    pantriesApi.list().then((r) => { if (alive && r.status) setRows(r.data || []); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2"><Coffee className="h-5 w-5" /> Pantries</h1>
          <p className="page-subtitle">Cafés, canteens and pantries — one or more per site. Linked to facilities to power booking orders.</p>
        </div>
        <Button onClick={() => nav('/admin/pantries/new')}>
          <Plus className="h-4 w-4 mr-1" /> New pantry
        </Button>
      </div>

      {loading && <div className="empty-state">Loading…</div>}
      {!loading && rows.length === 0 && (
        <div className="empty-state">No pantries yet. Create one to start linking it from facilities.</div>
      )}
      {!loading && rows.length > 0 && (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr>
              <th>Name</th><th>Site</th><th>Menu items</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td data-label="Name"><b>{p.name}</b></td>
                  <td data-label="Site">{p.site_name || `Site #${p.site_id}`}</td>
                  <td data-label="Items">{p.menu_count ?? 0}</td>
                  <td data-label="Status">
                    {p.status ? <span className="chip-approved">Active</span> : <span className="chip-cancelled">Inactive</span>}
                  </td>
                  <td>
                    <Button variant="outline" size="sm" asChild>
                      <RouterLink to={`/admin/pantries/${p.id}`}>Edit</RouterLink>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
