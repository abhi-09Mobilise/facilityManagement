// F02 - Check-out approval chain editor (controlled).
//
// Pure UI - state lives in the parent form. Mirrors the inline check-in
// editor in FacilityFormPage but for the post-booking stage.

import { Plus, X, ArrowUp, ArrowDown, ClipboardCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ApproverOption, FacilityApprovalChainStep } from '@/types';

function emptyRow(stepOrder: number): FacilityApprovalChainStep {
  return { step_order: stepOrder, approver_kind: 'dynamic_dept_manager', approver_user_id: null };
}

function approverLabel(u: ApproverOption): string {
  const name = [u.name, u.lname].filter(Boolean).join(' ') || u.username;
  return u.designation ? `${name} - ${u.designation}` : name;
}

export interface CheckoutChainEditorProps {
  value: FacilityApprovalChainStep[];
  onChange: (next: FacilityApprovalChainStep[]) => void;
  approvers: ApproverOption[];
}

export default function CheckoutChainEditor({ value, onChange, approvers }: CheckoutChainEditorProps) {
  function patch(idx: number, p: Partial<FacilityApprovalChainStep>) {
    onChange(value.map((r, i) => (i === idx ? { ...r, ...p } : r)));
  }
  function move(idx: number, delta: -1 | 1) {
    const t = idx + delta;
    if (t < 0 || t >= value.length) return;
    const c = value.slice();
    [c[idx], c[t]] = [c[t], c[idx]];
    onChange(c.map((r, i) => ({ ...r, step_order: i + 1 })));
  }
  function del(idx: number) {
    onChange(value.filter((_, i) => i !== idx).map((r, i) => ({ ...r, step_order: i + 1 })));
  }
  function add() {
    onChange([...value, emptyRow(value.length + 1)]);
  }

  return (
    <div className="panel panel-pad">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-3">
        <div>
          <h3 className="font-semibold text-base flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4" /> Check-out approval <span className="chip-checkout ml-1">checkout</span>
          </h3>
          <p className="text-xs text-muted-foreground">
            Approvers contacted <b>after</b> the booking ends (cleaning, returns, post-use sign-off).
            Empty = no checkout approval needed.
          </p>
        </div>
      </div>

      {value.length === 0 && (
        <div className="text-sm text-muted-foreground py-2">No check-out approvers configured.</div>
      )}

      {value.map((row, idx) => (
        <div key={idx} className="grid grid-cols-1 sm:grid-cols-[40px_180px_1fr_auto] gap-2 sm:gap-3 items-end mb-2 p-2 border rounded">
          <div className="text-center text-sm font-semibold text-primary">{idx + 1}</div>
          <select className="h-9 w-full rounded border border-input bg-background px-2 text-sm"
            value={row.approver_kind}
            onChange={(e) => patch(idx, { approver_kind: e.target.value as 'user' | 'dynamic_dept_manager', approver_user_id: null })}>
            <option value="dynamic_dept_manager">Booker's dept manager</option>
            <option value="user">Specific user</option>
          </select>
          {row.approver_kind === 'user' ? (
            <select className="h-9 w-full rounded border border-input bg-background px-2 text-sm"
              value={row.approver_user_id || ''}
              onChange={(e) => patch(idx, { approver_user_id: Number(e.target.value) || null })}>
              <option value="">— select approver —</option>
              {approvers.map((u) => <option key={u.id} value={u.id}>{approverLabel(u)}</option>)}
            </select>
          ) : (
            <span className="text-xs text-muted-foreground">Resolved at booking end from the booker's department</span>
          )}
          <div className="flex gap-1">
            <Button type="button" size="sm" variant="ghost" onClick={() => move(idx, -1)} disabled={idx === 0}>
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => move(idx, 1)} disabled={idx === value.length - 1}>
              <ArrowDown className="h-3.5 w-3.5" />
            </Button>
            <Button type="button" size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => del(idx)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}

      <Button type="button" size="sm" variant="outline" onClick={add}>
        <Plus className="h-3.5 w-3.5 mr-1" /> Add check-out approver
      </Button>
    </div>
  );
}
