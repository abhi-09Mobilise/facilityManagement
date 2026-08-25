// Roles & permissions — the prototype's vRoles() matrix, made editable.
//
// Scope model (matches the backend):
//   super_admin  -> edits GLOBAL defaults, or picks a tenant to override
//   tenant_admin -> edits only their own tenant's overrides
//
// Cell interaction: click cycles Yes -> Team only -> No. Cells whose value
// comes from a higher scope (global default / code default) are shown as
// "inherited"; once touched they become overrides, and "Reset" clears the
// override back to inherited. super_admin column is display-only (always ✓).

import { useEffect, useMemo, useState } from 'react';
import { Loader2, RotateCcw, ShieldCheck } from 'lucide-react';
import {
  permissionsApi, type MatrixRole, type PermCatalog, type PermMatrix, type PermValue, type PermChange,
} from '@/api/permissions.api';
import { tenantsApi } from '@/api/tenants.api';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';
import type { Tenant } from '@/types';

const ROLE_HEAD: Record<MatrixRole, string> = {
  tenant_admin: 'Tenant admin',
  org_admin: 'Org admin',
  approver: 'Approver',
  employee: 'Employee',
};
const ROLE_ORDER: MatrixRole[] = ['employee', 'approver', 'org_admin', 'tenant_admin'];
const NEXT: Record<PermValue, PermValue> = { yes: 'team', team: 'no', no: 'yes' };

function CellChip({ value, inherited, locked, onClick }: {
  value: PermValue; inherited: boolean; locked?: boolean; onClick?: () => void;
}) {
  const style = {
    yes:  'bg-teal-soft text-teal-ink',
    team: 'bg-amber-soft text-amber-ink',
    no:   'bg-[#EDF0F5] text-faint',
  }[value];
  const label = { yes: '✓ Yes', team: 'Team only', no: '—' }[value];
  return (
    <button
      type="button"
      disabled={locked}
      onClick={onClick}
      title={locked ? 'Locked' : `Click to change (${inherited ? 'inherited' : 'override'})`}
      className={cn(
        'mx-auto flex min-w-[76px] items-center justify-center rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition-transform',
        style,
        locked ? 'cursor-default opacity-90' : 'hover:scale-[1.04] cursor-pointer',
        !inherited && !locked && 'ring-2 ring-indigo/40'
      )}
    >
      {label}
    </button>
  );
}

export default function RolePermissionsPage() {
  const { user } = useAuth();
  const isSuper = user?.role === 'super_admin';

  const [catalog, setCatalog] = useState<PermCatalog | null>(null);
  const [matrix, setMatrix] = useState<PermMatrix | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [scopeTenant, setScopeTenant] = useState<number | ''>(''); // '' = global (super only)
  const [draft, setDraft] = useState<Record<string, PermValue | null>>({}); // `${role}:${key}` -> value|null(reset)
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const effectiveTenant = isSuper ? (scopeTenant || null) : (user?.tenant_id ?? null);

  useEffect(() => {
    permissionsApi.catalog().then((r) => setCatalog(r.data ?? null)).catch(() => setCatalog(null));
    if (isSuper) {
      tenantsApi.list({ limit: 500 }).then((r) => setTenants((r.data?.data || []) as Tenant[])).catch(() => {});
    }
  }, [isSuper]);

  function load() {
    setMatrix(null); setDraft({}); setMsg(null);
    permissionsApi.matrix(effectiveTenant).then((r) => setMatrix(r.data ?? null))
      .catch(() => setMsg({ tone: 'err', text: 'Could not load the permission matrix.' }));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [effectiveTenant]);

  const dirty = Object.keys(draft).length > 0;

  const cellValue = (role: MatrixRole, key: string): PermValue => {
    const dk = `${role}:${key}`;
    if (dk in draft) {
      const v = draft[dk];
      if (v !== null) return v;
      // reset -> what it would inherit (global/default resolution minus this scope's override)
      return effectiveTenant
        ? (matrix?.defaults[role][key] ?? 'no') // approximation shown pre-save; server resolves exactly
        : (matrix?.defaults[role][key] ?? 'no');
    }
    return matrix?.resolved[role][key] ?? 'no';
  };

  const isOverridden = (role: MatrixRole, key: string): boolean => {
    const dk = `${role}:${key}`;
    if (dk in draft) return draft[dk] !== null;
    return matrix?.overrides?.[role]?.[key] !== undefined;
  };

  function clickCell(role: MatrixRole, key: string) {
    if (role === 'employee' && key === 'roles.manage') return; // guardrail mirrors backend
    const cur = cellValue(role, key);
    setDraft((d) => ({ ...d, [`${role}:${key}`]: NEXT[cur] }));
  }

  function resetCell(role: MatrixRole, key: string) {
    setDraft((d) => ({ ...d, [`${role}:${key}`]: null }));
  }

  async function save() {
    if (!dirty) return;
    setSaving(true); setMsg(null);
    const changes: PermChange[] = Object.entries(draft).map(([dk, allowed]) => {
      const [role, permission_key] = [dk.slice(0, dk.indexOf(':')), dk.slice(dk.indexOf(':') + 1)];
      return { role: role as MatrixRole, permission_key, allowed };
    });
    try {
      await permissionsApi.save(changes, effectiveTenant);
      setMsg({ tone: 'ok', text: `Saved ${changes.length} change${changes.length > 1 ? 's' : ''}. Applies on next page load for affected users.` });
      setDraft({});
      load();
    } catch (e: unknown) {
      const m = (e as { response?: { data?: { msg?: string } } })?.response?.data?.msg || 'Save failed';
      setMsg({ tone: 'err', text: m });
    } finally {
      setSaving(false);
    }
  }

  if (!catalog || !matrix) {
    return <div className="grid place-items-center py-24"><Loader2 className="h-6 w-6 animate-spin text-mutedx" /></div>;
  }

  return (
    <div>
      {/* header row */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div>
          <h1 className="font-display text-[22px] font-semibold tracking-tight">Roles &amp; permissions</h1>
          <p className="mt-0.5 text-[12.5px] text-mutedx">
            {isSuper
              ? 'Editing global defaults, or pick a tenant to set overrides that apply only there.'
              : 'Overrides for your tenant. Cells without an override inherit the global defaults.'}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {isSuper && (
            <select
              aria-label="Scope"
              className="h-9 rounded-[9px] border border-line-2 bg-card px-2.5 text-[12.5px] font-medium min-w-[190px] focus:outline-none focus:ring-2 focus:ring-indigo/30 focus:border-indigo"
              value={scopeTenant}
              onChange={(e) => setScopeTenant(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">Global defaults (all tenants)</option>
              {tenants.map((t) => <option key={t.id} value={t.id}>Override · {t.name}</option>)}
            </select>
          )}
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="rounded-[9px] bg-indigo px-4 py-2 text-[13px] font-semibold text-white hover:bg-indigo-ink disabled:opacity-50"
          >
            {saving ? 'Saving…' : dirty ? `Save ${Object.keys(draft).length} change${Object.keys(draft).length > 1 ? 's' : ''}` : 'No changes'}
          </button>
        </div>
      </div>

      {msg && (
        <div className={cn('mb-3 rounded-[10px] px-3.5 py-2.5 text-[12.5px]',
          msg.tone === 'ok' ? 'bg-teal-soft text-teal-ink' : 'bg-coral-soft text-coral-ink')}>
          {msg.text}
        </div>
      )}

      {/* matrix card */}
      <div className="rounded-xl border border-line bg-card shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-[12.5px]">
            <thead>
              <tr className="border-b border-line">
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[.08em] text-mutedx">Permission</th>
                {ROLE_ORDER.map((r) => (
                  <th key={r} className="px-2 py-2.5 text-center text-[11px] font-semibold uppercase tracking-[.08em] text-mutedx">{ROLE_HEAD[r]}</th>
                ))}
                <th className="px-2 py-2.5 text-center text-[11px] font-semibold uppercase tracking-[.08em] text-mutedx">
                  <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" />Super admin</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(catalog.groups).map(([group, perms]) => (
                <GroupRows
                  key={group}
                  group={group}
                  perms={perms}
                  cellValue={cellValue}
                  isOverridden={isOverridden}
                  clickCell={clickCell}
                  resetCell={resetCell}
                />
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-line px-4 py-2.5 text-[11px] text-faint">
          Click a cell to cycle ✓ Yes → Team only → —. A blue ring marks an override for this scope; hover a cell and use ⟲ to
          return it to inherited. "Team only" limits the action to direct reports resolved from the department hierarchy. Super
          admin always has every permission and cannot be edited. Changes are enforced by the API and refresh a user's
          navigation on their next page load.
        </div>
      </div>
    </div>
  );
}

function GroupRows({ group, perms, cellValue, isOverridden, clickCell, resetCell }: {
  group: string;
  perms: Array<{ key: string; label: string }>;
  cellValue: (r: MatrixRole, k: string) => PermValue;
  isOverridden: (r: MatrixRole, k: string) => boolean;
  clickCell: (r: MatrixRole, k: string) => void;
  resetCell: (r: MatrixRole, k: string) => void;
}) {
  return (
    <>
      <tr className="border-b border-line bg-[#FAFBFD]">
        <td colSpan={6} className="px-4 py-1.5 text-[10.5px] font-semibold uppercase tracking-[.1em] text-faint">{group}</td>
      </tr>
      {perms.map((p) => (
        <tr key={p.key} className="group border-b border-line last:border-0 hover:bg-[#FAFBFD]">
          <td className="px-4 py-2">
            {p.label}
            <span className="ml-2 hidden rounded bg-[#EEF1F6] px-1.5 font-mono text-[10.5px] text-faint lg:inline">{p.key}</span>
          </td>
          {ROLE_ORDER.map((r) => {
            const locked = r === 'employee' && p.key === 'roles.manage';
            const overridden = isOverridden(r, p.key);
            return (
              <td key={r} className="px-2 py-2 text-center">
                <div className="relative inline-flex items-center">
                  <CellChip
                    value={cellValue(r, p.key)}
                    inherited={!overridden}
                    locked={locked}
                    onClick={() => clickCell(r, p.key)}
                  />
                  {overridden && !locked && (
                    <button
                      type="button"
                      title="Reset to inherited"
                      onClick={() => resetCell(r, p.key)}
                      className="absolute -right-5 hidden text-faint hover:text-inktext group-hover:block"
                    >
                      <RotateCcw className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </td>
            );
          })}
          <td className="px-2 py-2 text-center">
            <span className="mx-auto flex min-w-[76px] items-center justify-center rounded-full bg-violet-soft px-2.5 py-1 text-[11.5px] font-semibold text-[#5B27B8]">✓ Always</span>
          </td>
        </tr>
      ))}
    </>
  );
}
