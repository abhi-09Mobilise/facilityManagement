// F06 - Pantry form + menu editor in one page.
// Mobile-first; menu rows stack on small screens.

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, X, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { pantriesApi, type Pantry, type PantryMenuItem } from '@/api/pantries.api';
import { sitesApi } from '@/api/sites.api';
import type { Site } from '@/types';

function newRow(): PantryMenuItem {
  // New items default to FREE - admin opts in to "paid" with the toggle.
  return { name: '', meal_time_id: null, is_paid: 0, price: 0, status: 1 };
}

export default function PantryFormPage() {
  const { id } = useParams();
  const editing = id && id !== 'new';
  const nav = useNavigate();

  const [pantry, setPantry] = useState<Partial<Pantry>>({ name: '', site_id: undefined, status: 1 });
  const [menu, setMenu] = useState<PantryMenuItem[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    sitesApi.list({ limit: 200 }).then((r) => setSites(r.data?.data || []));
  }, []);

  useEffect(() => {
    if (!editing) return;
    pantriesApi.getOne(Number(id)).then((r) => {
      if (!r.status || !r.data) return;
      setPantry({ id: r.data.id, name: r.data.name, site_id: r.data.site_id, status: r.data.status });
      setMenu(r.data.menu || []);
    });
  }, [editing, id]);

  function patchItem<K extends keyof PantryMenuItem>(idx: number, key: K, value: PantryMenuItem[K]) {
    setMenu((m) => m.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setInfo(null);
    if (!pantry.name) { setError('Name is required'); return; }
    if (!pantry.site_id) { setError('Site is required'); return; }
    setSaving(true);
    try {
      let pid = editing ? Number(id) : 0;
      if (!editing) {
        const r = await pantriesApi.create(pantry);
        if (!r.status || !r.data) { setError(r.msg || 'Save failed'); return; }
        pid = r.data.id;
      } else {
        const r = await pantriesApi.update(pid, pantry);
        if (!r.status) { setError(r.msg || 'Save failed'); return; }
      }
      const r2 = await pantriesApi.replaceMenu(pid, menu.filter((m) => m.name.trim()));
      if (!r2.status) { setError(r2.msg || 'Menu save failed'); return; }
      setInfo('Saved');
      if (!editing) nav(`/admin/pantries/${pid}`, { replace: true });
    } catch (err: unknown) {
      setError((err as { response?: { data?: { msg?: string } } })?.response?.data?.msg
        || (err as Error)?.message
        || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editing) return;
    if (!confirm('Delete this pantry? Its menu items will also be removed.')) return;
    const r = await pantriesApi.remove(Number(id));
    if (r.status) nav('/admin/pantries');
    else setError(r.msg || 'Delete failed');
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">{editing ? 'Edit pantry' : 'New pantry'}</h1>
          <p className="page-subtitle">Pantries sit on a site. Link them from a facility to let bookers order items.</p>
        </div>
        {editing && (
          <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={handleDelete}>
            <Trash2 className="h-4 w-4 mr-1" /> Delete
          </Button>
        )}
      </div>

      <form onSubmit={save} className="space-y-4">
        <div className="panel panel-pad">
          <div className="form-grid">
            <div className="form-row">
              <Label>Name</Label>
              <Input value={pantry.name || ''} onChange={(e) => setPantry({ ...pantry, name: e.target.value })} required />
            </div>
            <div className="form-row">
              <Label>Site</Label>
              <select className="h-9 w-full rounded border border-input bg-background px-2 text-sm"
                value={pantry.site_id || ''}
                onChange={(e) => setPantry({ ...pantry, site_id: Number(e.target.value) || undefined })}
                required>
                <option value="">— select —</option>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="form-row">
              <Label>Status</Label>
              <select className="h-9 w-full rounded border border-input bg-background px-2 text-sm"
                value={pantry.status ?? 1}
                onChange={(e) => setPantry({ ...pantry, status: Number(e.target.value) as 0 | 1 })}>
                <option value={1}>Active</option>
                <option value={0}>Inactive</option>
              </select>
            </div>
          </div>
        </div>

        <div className="panel panel-pad">
          <div className="panel-header">
            <h2 className="font-semibold text-base">Menu</h2>
            <Button type="button" size="sm" variant="outline" onClick={() => setMenu((m) => [...m, newRow()])}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add item
            </Button>
          </div>
          {menu.length === 0 && <div className="text-sm text-muted-foreground">No items yet.</div>}
          {menu.map((it, idx) => {
            const isPaid = it.is_paid === 1;
            return (
              <div key={idx} className="grid grid-cols-1 sm:grid-cols-[1fr_140px_120px_100px_auto] gap-2 sm:gap-3 items-end mb-2">
                <div>
                  <Label className="sm:sr-only">Item</Label>
                  <Input value={it.name} onChange={(e) => patchItem(idx, 'name', e.target.value)} placeholder="Sandwich, espresso…" />
                </div>
                {/* Paid/Free toggle - flips the price input on. Pinning
                    price back to 0 when toggling off keeps the data clean. */}
                <div>
                  <Label className="sm:sr-only">Paid?</Label>
                  <button
                    type="button"
                    onClick={() => {
                      const next: 0 | 1 = isPaid ? 0 : 1;
                      patchItem(idx, 'is_paid', next);
                      if (next === 0) patchItem(idx, 'price', 0);
                    }}
                    className={
                      'h-9 w-full rounded border text-sm transition-colors ' +
                      (isPaid
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background border-input text-muted-foreground hover:bg-muted')
                    }>
                    {isPaid ? 'Paid' : 'Free'}
                  </button>
                </div>
                <div>
                  <Label className="sm:sr-only">Price</Label>
                  <Input
                    type="number" min={0} step="0.01"
                    value={isPaid ? it.price : 0}
                    onChange={(e) => patchItem(idx, 'price', Number(e.target.value || 0))}
                    disabled={!isPaid}
                    placeholder={isPaid ? '0.00' : '—'} />
                </div>
                <div>
                  <Label className="sm:sr-only">Status</Label>
                  <select className="h-9 w-full rounded border border-input bg-background px-2 text-sm"
                    value={it.status ?? 1}
                    onChange={(e) => patchItem(idx, 'status', Number(e.target.value) as 0 | 1)}>
                    <option value={1}>Active</option>
                    <option value={0}>Inactive</option>
                  </select>
                </div>
                <Button type="button" size="sm" variant="ghost" className="text-destructive hover:text-destructive"
                  onClick={() => setMenu((m) => m.filter((_, i) => i !== idx))}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
        </div>

        {error && <div className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
        {info  && <div className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{info}</div>}

        <div className="form-actions">
          <Button type="button" variant="ghost" onClick={() => nav('/admin/pantries')}>Cancel</Button>
          <Button type="submit" disabled={saving}>
            <Save className="h-3.5 w-3.5 mr-1" /> {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </div>
  );
}
