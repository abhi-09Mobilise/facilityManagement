// F06 - Facility-pantry link picker (controlled).
//
// Controlled component: parent owns the selected pantry-id set. Pure UI.
// `siteId` filters which pantries we offer (only same-site pantries can be
// linked).

import { useEffect, useState } from 'react';
import { Coffee } from 'lucide-react';
import { pantriesApi, type Pantry } from '@/api/pantries.api';

export interface FacilityPantriesPickerProps {
  value: number[];                       // selected pantry ids
  onChange: (next: number[]) => void;
  siteId: number | undefined;
}

export default function FacilityPantriesPicker({ value, onChange, siteId }: FacilityPantriesPickerProps) {
  const [siteCandidates, setSiteCandidates] = useState<Pantry[]>([]);

  useEffect(() => {
    if (!siteId) { setSiteCandidates([]); return; }
    pantriesApi.list({ site_id: siteId }).then((r) => { if (r.status) setSiteCandidates(r.data || []); });
  }, [siteId]);

  function toggle(id: number) {
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  }

  return (
    <div className="panel panel-pad">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-3">
        <div>
          <h3 className="font-semibold text-base flex items-center gap-2"><Coffee className="h-4 w-4" /> Available pantries <span className="text-xs font-normal text-muted-foreground">(optional)</span></h3>
          <p className="text-xs text-muted-foreground">
            Pantries shown to bookers when they pick this facility. Only pantries on the same site appear here.
          </p>
        </div>
      </div>
      {!siteId ? (
        <div className="text-sm text-muted-foreground">Pick a site above to see available pantries.</div>
      ) : siteCandidates.length === 0 ? (
        <div className="text-sm text-muted-foreground">No active pantries on this site yet — create one in Masters → Pantries.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {siteCandidates.map((p) => (
            <label key={p.id} className="flex items-center gap-2 p-2 border rounded cursor-pointer hover:bg-muted/40">
              <input type="checkbox" className="h-4 w-4" checked={value.includes(p.id)} onChange={() => toggle(p.id)} />
              <span className="text-sm">{p.name}</span>
              {!p.status && <span className="chip-cancelled ml-auto">Inactive</span>}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
