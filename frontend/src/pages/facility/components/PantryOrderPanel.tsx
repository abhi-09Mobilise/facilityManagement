// F06 - Pantry order panel rendered on FacilityDetailPage during booking.
//
// Calls GET /facilities/:id/menu on mount. If no pantries are linked, the
// panel is hidden entirely (parent should check `hasContent`).
// Exposes its current selection upward via onChange so the parent's
// CreateBookingPayload can include `pantry_orders`.

import { useEffect, useMemo, useState } from 'react';
import { Coffee } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { facilityPantriesApi, type FacilityMenuPantry } from '@/api/pantries.api';

export interface PantryOrder { menu_item_id: number; quantity: number; }

interface Props {
  facilityId: number;
  onChange: (orders: PantryOrder[]) => void;
  onLoaded?: (hasContent: boolean) => void;
}

export default function PantryOrderPanel({ facilityId, onChange, onLoaded }: Props) {
  const [pantries, setPantries] = useState<FacilityMenuPantry[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [qty, setQty] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!facilityId) return;
    let alive = true;
    setLoading(true);
    facilityPantriesApi.menu(facilityId).then((r) => {
      if (!alive) return;
      const list = r.status ? (r.data || []) : [];
      setPantries(list);
      if (list.length > 0) setActiveId(list[0].id);
      onLoaded?.(list.length > 0);
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [facilityId, onLoaded]);

  const active = useMemo(() => pantries.find((p) => p.id === activeId) || null, [pantries, activeId]);
  const total  = useMemo(() => {
    if (!active) return 0;
    return active.items.reduce((sum, it) => sum + (qty[it.id] || 0) * Number(it.price), 0);
  }, [active, qty]);

  useEffect(() => {
    const orders: PantryOrder[] = Object.entries(qty)
      .filter(([, q]) => q > 0)
      .map(([id, q]) => ({ menu_item_id: Number(id), quantity: q }));
    onChange(orders);
  }, [qty, onChange]);

  if (loading)         return null;
  if (pantries.length === 0) return null;

  return (
    <div className="panel panel-pad">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
        <div>
          <h3 className="font-semibold text-base flex items-center gap-2">
            <Coffee className="h-4 w-4" /> Order from pantry <span className="text-xs font-normal text-muted-foreground">(optional)</span>
          </h3>
          <p className="text-xs text-muted-foreground">Showing pantries available at this facility's site.</p>
        </div>
        <select className="h-9 rounded border border-input bg-background px-2 text-sm w-full sm:w-auto"
          value={activeId ?? ''}
          onChange={(e) => setActiveId(Number(e.target.value))}>
          {pantries.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {!active || active.items.length === 0 ? (
        <div className="text-sm text-muted-foreground">This pantry has no items right now.</div>
      ) : (
        <>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead><tr>
                <th></th><th>Item</th><th>Price</th><th>Qty</th>
              </tr></thead>
              <tbody>
                {active.items.map((it) => (
                  <tr key={it.id}>
                    <td data-label=""><input type="checkbox"
                      checked={(qty[it.id] || 0) > 0}
                      onChange={(e) => setQty((q) => ({ ...q, [it.id]: e.target.checked ? Math.max(1, q[it.id] || 1) : 0 }))}
                      className="h-4 w-4" /></td>
                    <td data-label="Item">{it.name}</td>
                    <td data-label="Price">{Number(it.price).toFixed(2)}</td>
                    <td data-label="Qty">
                      <Input type="number" min={0} value={qty[it.id] || 0}
                        onChange={(e) => setQty((q) => ({ ...q, [it.id]: Math.max(0, Number(e.target.value || 0)) }))}
                        className="w-20" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-right mt-2 text-sm"><b>Total: {total.toFixed(2)}</b></div>
        </>
      )}
    </div>
  );
}
