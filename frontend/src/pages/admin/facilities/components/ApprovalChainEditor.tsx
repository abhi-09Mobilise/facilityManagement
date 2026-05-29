// Shared chain editor for check-in / check-out notification / facility
// notification. Pure UI - state lives in the parent form.
//
// Each step row has three pickers in order:
//   1. Type          - dynamic dept manager (resolved per booking) or specific user
//   2. Department    - filters the approver picker (only used when type='user')
//   3. Approver      - chosen user from that department
//
// The dept value is a UI filter only; the saved record stores
// `approver_user_id` and we re-derive the dept on next load from the
// chosen user's own department_id (passed through ApproverOption).

import { useState } from 'react';
import { Plus, X, ArrowUp, ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ApproverOption, Department, FacilityApprovalChainStep } from '@/types';

function emptyRow(stepOrder: number): FacilityApprovalChainStep {
  return { step_order: stepOrder, approver_kind: 'dynamic_dept_manager', approver_user_id: null };
}

function approverLabel(u: ApproverOption): string {
  const name = [u.name, u.lname].filter(Boolean).join(' ') || u.username;
  return u.designation ? `${name} - ${u.designation}` : name;
}

export interface ApprovalChainEditorProps {
  title: string;
  subtitle?: string;
  addLabel?: string;
  // Optional chip rendered next to the title (e.g. "checkout" / "notify").
  chipClassName?: string;
  chipLabel?: string;
  value: FacilityApprovalChainStep[];
  onChange: (next: FacilityApprovalChainStep[]) => void;
  approvers: ApproverOption[];
  departments: Department[];
  // Empty-state message when there are no rows yet.
  emptyMessage?: string;
}

export default function ApprovalChainEditor({
  title, subtitle, addLabel, chipClassName, chipLabel,
  value, onChange, approvers, departments, emptyMessage,
}: ApprovalChainEditorProps) {
  // Per-row department selection (UI-only filter; not persisted).
  const [deptByIdx, setDeptByIdx] = useState<Record<number, number | ''>>({});

  function effectiveDept(idx: number, row: FacilityApprovalChainStep): number | '' {
    if (deptByIdx[idx] !== undefined) return deptByIdx[idx];
    if (row.approver_user_id) {
      const a = approvers.find((x) => x.id === row.approver_user_id);
      if (a?.department_id) return a.department_id;
    }
    return '';
  }

  function setDeptForRow(idx: number, deptId: number | '') {
    setDeptByIdx((s) => ({ ...s, [idx]: deptId }));
    const row = value[idx];
    if (row?.approver_user_id) {
      const a = approvers.find((x) => x.id === row.approver_user_id);
      if (!a || a.department_id !== deptId) patch(idx, { approver_user_id: null });
    }
  }

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
    setDeptByIdx((s) => {
      const next = { ...s };
      delete next[idx];
      return next;
    });
  }
  function add() {
    onChange([...value, emptyRow(value.length + 1)]);
  }

  return (
    <div className="panel panel-pad">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-3">
        <div>
          <h3 className="font-semibold text-base flex items-center gap-2">
            {title}
            {chipLabel && (
              <span className={chipClassName ?? 'chip'}>{chipLabel}</span>
            )}
          </h3>
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
      </div>

      {value.length === 0 && (
        <div className="text-sm text-muted-foreground py-2">
          {emptyMessage || 'No steps configured.'}
        </div>
      )}

      {value.map((row, idx) => {
        const dept = effectiveDept(idx, row);
        const filteredApprovers = dept === ''
          ? approvers
          : approvers.filter((a) => a.department_id === dept);
        return (
          <div key={idx} className="grid grid-cols-1 sm:grid-cols-[40px_180px_1fr_auto] gap-2 sm:gap-3 items-end mb-2 p-2 border rounded">
            <div className="text-center text-sm font-semibold text-primary">{idx + 1}</div>
            <select
              className="h-9 w-full rounded border border-input bg-background px-2 text-sm"
              value={row.approver_kind}
              onChange={(e) => {
                patch(idx, { approver_kind: e.target.value as 'user' | 'dynamic_dept_manager', approver_user_id: null });
                setDeptByIdx((s) => ({ ...s, [idx]: '' }));
              }}>
              <option value="dynamic_dept_manager">Booker's dept manager</option>
              <option value="user">Specific user</option>
            </select>
            {row.approver_kind === 'user' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <select
                  className="h-9 w-full rounded border border-input bg-background px-2 text-sm"
                  value={dept}
                  onChange={(e) => setDeptForRow(idx, e.target.value ? Number(e.target.value) : '')}>
                  <option value="">— department —</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <select
                  className="h-9 w-full rounded border border-input bg-background px-2 text-sm"
                  value={row.approver_user_id || ''}
                  onChange={(e) => patch(idx, { approver_user_id: Number(e.target.value) || null })}
                  disabled={dept === ''}>
                  <option value="">{dept === '' ? '— pick a department first —' : '— select approver —'}</option>
                  {filteredApprovers.map((u) => <option key={u.id} value={u.id}>{approverLabel(u)}</option>)}
                </select>
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">Resolved at booking time from the booker's department</span>
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
        );
      })}

      <Button type="button" size="sm" variant="outline" onClick={add}>
        <Plus className="h-3.5 w-3.5 mr-1" /> {addLabel || 'Add step'}
      </Button>
    </div>
  );
}
