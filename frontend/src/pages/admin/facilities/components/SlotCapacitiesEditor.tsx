// F01 - Slot capacity overrides editor (controlled).
//
// Pure UI: state lives in the parent form via `value` + `onChange`. The
// parent saves everything in one go (so this works during facility CREATE
// too - no facilityId needed). Mobile-first responsive.

import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { SlotOverride } from '@/api/slotCapacities.api';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function emptyRow(): SlotOverride {
  return { day_of_week: 1, start_time: '09:00', end_time: '12:00', min_attendees: 1, max_attendees: 1, status: 1 };
}

export function findSlotOverlap(rows: SlotOverride[]): string | null {
  const byDay: Record<number, SlotOverride[]> = {};
  rows.forEach((r) => { (byDay[r.day_of_week] = byDay[r.day_of_week] || []).push(r); });
  for (const dow of Object.keys(byDay)) {
    const list = [...byDay[+dow]].sort((a, b) => a.start_time.localeCompare(b.start_time));
    for (let i = 1; i < list.length; i++) {
      if (list[i].start_time < list[i - 1].end_time) {
        return `${DOW[+dow]} slots ${list[i - 1].start_time}–${list[i - 1].end_time} and ${list[i].start_time}–${list[i].end_time} overlap.`;
      }
    }
  }
  return null;
}

export interface SlotCapacitiesEditorProps {
  value: SlotOverride[];
  onChange: (next: SlotOverride[]) => void;
  defaultCapacity: number;
}

export default function SlotCapacitiesEditor({ value, onChange, defaultCapacity }: SlotCapacitiesEditorProps) {
  function update<K extends keyof SlotOverride>(idx: number, key: K, v: SlotOverride[K]) {
    onChange(value.map((r, i) => (i === idx ? { ...r, [key]: v } : r)));
  }

  return (
    <div className="panel panel-pad">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-3">
        <div>
          <h3 className="font-semibold text-base">Slot capacities <span className="text-xs font-normal text-muted-foreground">(optional)</span></h3>
          <p className="text-xs text-muted-foreground">
            Default capacity: <b>{defaultCapacity}</b>. Any range below replaces it for that window.
          </p>
        </div>
        <Button type="button" size="sm" variant="outline"
          onClick={() => onChange([...value, emptyRow()])}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add slot
        </Button>
      </div>

      {value.length === 0 && (
        <div className="text-sm text-muted-foreground py-2">
          No overrides — every slot allows up to {defaultCapacity} attendees.
        </div>
      )}

      {value.length > 0 && (
        <div className="space-y-2">
          {value.map((r, idx) => (
            <div key={idx}
              className="grid grid-cols-1 sm:grid-cols-[110px_110px_110px_90px_90px_auto] gap-2 sm:gap-3 items-end p-2 sm:p-0 border rounded sm:border-0 sm:rounded-none">
              <div>
                <Label className="sm:sr-only">Day</Label>
                <select className="h-9 w-full rounded border border-input bg-background px-2 text-sm"
                  value={r.day_of_week}
                  onChange={(e) => update(idx, 'day_of_week', Number(e.target.value))}>
                  {DOW.map((d, i) => <option key={i} value={i}>{d}</option>)}
                </select>
              </div>
              <div>
                <Label className="sm:sr-only">Start</Label>
                <Input type="time" value={r.start_time.slice(0, 5)}
                  onChange={(e) => update(idx, 'start_time', e.target.value)} />
              </div>
              <div>
                <Label className="sm:sr-only">End</Label>
                <Input type="time" value={r.end_time.slice(0, 5)}
                  onChange={(e) => update(idx, 'end_time', e.target.value)} />
              </div>
              <div>
                <Label className="sm:sr-only">Min</Label>
                <Input type="number" min={1} value={r.min_attendees}
                  onChange={(e) => update(idx, 'min_attendees', Math.max(1, Number(e.target.value || 1)))} />
              </div>
              <div>
                <Label className="sm:sr-only">Max</Label>
                <Input type="number" min={1} value={r.max_attendees}
                  onChange={(e) => update(idx, 'max_attendees', Math.max(1, Number(e.target.value || 1)))} />
              </div>
              <div className="flex sm:justify-end">
                <Button type="button" size="sm" variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => onChange(value.filter((_, i) => i !== idx))}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
          <div className="hidden sm:grid grid-cols-[110px_110px_110px_90px_90px_auto] gap-3 text-xs text-muted-foreground -mt-1 px-1">
            <span>Day</span><span>Start</span><span>End</span><span>Min</span><span>Max</span><span />
          </div>
        </div>
      )}
    </div>
  );
}
