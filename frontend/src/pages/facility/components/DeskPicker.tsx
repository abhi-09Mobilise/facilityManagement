// F09 - Booker-side desk picker.
//
// Read-only renderer of facility.layout_json. Chairs are clickable; the
// already-occupied ones (from /bookings/check?...&occupied_desks) are greyed
// out and disabled. Selected chair is outlined in blue.
//
// We don't share a renderer with DeskLayoutEditor on purpose - the booker
// view doesn't need drag/rotate/resize, only static rendering plus a
// click-to-claim handler, so duplicating ~80 lines of SVG keeps the editor
// and picker independent.

import { useMemo } from 'react';
import type { FacilityLayout, FacilityLayoutV1, LayoutObject, LayoutObjectType } from '@/types';

export interface DeskPickerProps {
  // Raw layout from facility.layout_json. May be a JSON string, a parsed
  // object, the legacy v1 shape, or null/undefined if no layout was saved.
  value: string | FacilityLayout | FacilityLayoutV1 | null | undefined;
  // Chair ids (e.g. "C-03") already claimed for the selected time window.
  occupiedDeskIds: string[];
  // Chair ids the user has currently picked (multi-select).
  selectedDeskIds: string[];
  // User clicked an AVAILABLE chair. Toggles the id in/out of the selection.
  // Occupied chairs are filtered out before bubbling.
  onToggle: (deskId: string) => void;
}

type Preset = { fill: string; stroke: string };
const PRESETS: Record<LayoutObjectType, Preset> = {
  desk:          { fill: '#dcfce7', stroke: '#16a34a' },
  meeting_room:  { fill: '#dbeafe', stroke: '#2563eb' },
  chair:         { fill: '#fef3c7', stroke: '#a16207' }, // overridden by status
  table_round:   { fill: '#fff7ed', stroke: '#9a3412' },
  table_rect:    { fill: '#fff7ed', stroke: '#9a3412' },
  wall:          { fill: '#475569', stroke: '#1e293b' },
  door:          { fill: '#fde68a', stroke: '#b45309' },
  plant:         { fill: '#dcfce7', stroke: '#15803d' },
};

// Chair status -> colour. Picked = blue, occupied = grey/disabled,
// available = green so the booker can spot free chairs at a glance.
const CHAIR_AVAILABLE = { fill: '#bbf7d0', stroke: '#15803d', text: '#14532d' };
const CHAIR_OCCUPIED  = { fill: '#e2e8f0', stroke: '#94a3b8', text: '#64748b' };
const CHAIR_SELECTED  = { fill: '#bfdbfe', stroke: '#1d4ed8', text: '#1e3a8a' };

function parseLayout(raw: DeskPickerProps['value']): FacilityLayout | null {
  if (!raw) return null;
  let parsed: FacilityLayout | FacilityLayoutV1 | null = null;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { return null; }
  } else {
    parsed = raw;
  }
  if (!parsed) return null;
  // Only the v2 shape carries widthM/heightM/pxPerMeter. v1 isn't supported
  // by the booker picker yet (admin must re-save the layout to upgrade it).
  if ((parsed as FacilityLayout).version === 2) return parsed as FacilityLayout;
  return null;
}

// Walls behind tables, chairs on top - same z-order as the editor.
function zOrder(o: LayoutObject): number {
  if (o.type === 'wall')  return 0;
  if (o.type === 'plant') return 1;
  if (o.type === 'door')  return 2;
  if (o.type === 'table_round' || o.type === 'table_rect') return 3;
  if (o.type === 'chair') return 4;
  return 5;
}

export default function DeskPicker({ value, occupiedDeskIds, selectedDeskIds, onToggle }: DeskPickerProps) {
  const layout = useMemo(() => parseLayout(value), [value]);
  const occupiedSet = useMemo(() => new Set(occupiedDeskIds || []), [occupiedDeskIds]);
  const selectedSet = useMemo(() => new Set(selectedDeskIds || []), [selectedDeskIds]);

  if (!layout) {
    return (
      <div className="rounded border bg-muted/30 p-4 text-sm text-muted-foreground">
        No floor plan has been configured for this facility. Ask your admin to design one.
      </div>
    );
  }

  const W = Math.round(layout.widthM * layout.pxPerMeter);
  const H = Math.round(layout.heightM * layout.pxPerMeter);
  // VIP chairs are *invisible* to the booker - filter them out of the
  // render set and out of every count so the picker never even hints
  // that they exist.
  const visibleObjects = layout.objects.filter((o) => !(o.type === 'chair' && o.isVip));
  const sorted = visibleObjects.slice().sort((a, b) => zOrder(a) - zOrder(b));
  const bookableChairs = visibleObjects.filter((o) => o.type === 'chair');
  const availableCount = bookableChairs.filter((o) => !occupiedSet.has(o.id)).length;
  const chairTotal = bookableChairs.length;
  const roomTotal  = layout.objects.filter((o) => o.type === 'meeting_room').length;

  return (
    <div>
      {/* Status bar above the canvas. Switches wording for chair-driven
          (desk) vs room-driven (meeting room) layouts so the booker isn't
          told "0 chairs free" on a meeting-room floor plan. */}
      <div className="flex flex-wrap items-center gap-3 mb-2 text-xs">
        {chairTotal > 0 ? (
          <>
            <span className="font-medium">
              {availableCount} of {chairTotal} chair{chairTotal === 1 ? '' : 's'} free
            </span>
            <span className="inline-flex items-center gap-1">
              <i className="inline-block w-3 h-3 rounded" style={{ background: CHAIR_AVAILABLE.fill, border: '1px solid ' + CHAIR_AVAILABLE.stroke }} />
              available
            </span>
            <span className="inline-flex items-center gap-1">
              <i className="inline-block w-3 h-3 rounded" style={{ background: CHAIR_OCCUPIED.fill, border: '1px solid ' + CHAIR_OCCUPIED.stroke }} />
              taken
            </span>
            <span className="inline-flex items-center gap-1">
              <i className="inline-block w-3 h-3 rounded" style={{ background: CHAIR_SELECTED.fill, border: '1px solid ' + CHAIR_SELECTED.stroke }} />
              your pick{selectedDeskIds.length > 1 ? ` (${selectedDeskIds.length})` : ''}
            </span>
          </>
        ) : roomTotal > 0 ? (
          <span className="font-medium">
            {roomTotal} meeting room{roomTotal === 1 ? '' : 's'} on this floor
          </span>
        ) : (
          <span className="font-medium text-muted-foreground">Floor plan reference</span>
        )}
        {layout.mode === 'image' && layout.imageUrl && (
          <span className="ml-auto text-muted-foreground">Floor plan overlay enabled</span>
        )}
      </div>

      <div className="overflow-auto bg-muted/20 rounded-md border p-3 flex items-center justify-center">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ width: '100%', maxHeight: 460, userSelect: 'none', display: 'block' }}
          className="bg-card border rounded shadow-sm"
        >
          <defs>
            <pattern id="dp-wood" patternUnits="userSpaceOnUse" width="60" height="22" patternTransform="rotate(2)">
              <rect width="60" height="22" fill="#c08a5a" />
              <path d="M0 4 Q15 3 30 4 T60 4" stroke="#8b5a2b" strokeWidth="0.7" fill="none" opacity="0.5" />
              <path d="M0 9 Q20 11 40 9 T60 10" stroke="#6b3a0e" strokeWidth="1.3" fill="none" opacity="0.45" />
              <path d="M0 14 Q18 13 36 14 T60 13" stroke="#8b5a2b" strokeWidth="0.5" fill="none" opacity="0.5" />
              <path d="M0 18 Q22 19 44 18 T60 19" stroke="#5b2e0a" strokeWidth="0.9" fill="none" opacity="0.4" />
              <line x1="0" y1="6.5" x2="60" y2="6.5" stroke="#d9a877" strokeWidth="0.4" opacity="0.5" />
            </pattern>
            <linearGradient id="dp-wall" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%"   stopColor="#64748b" />
              <stop offset="100%" stopColor="#334155" />
            </linearGradient>
          </defs>

          {/* Background: uploaded floor plan, OR faint grid for blank layouts */}
          {layout.mode === 'image' && layout.imageUrl ? (
            <image href={layout.imageUrl} x={0} y={0} width={W} height={H} preserveAspectRatio="xMidYMid slice" />
          ) : (
            <>
              {Array.from({ length: Math.ceil(W / 40) + 1 }, (_, i) => (
                <line key={'v' + i} x1={i * 40} y1={0} x2={i * 40} y2={H} stroke="rgba(15,23,42,0.06)" strokeWidth={1} />
              ))}
              {Array.from({ length: Math.ceil(H / 40) + 1 }, (_, i) => (
                <line key={'h' + i} x1={0} y1={i * 40} x2={W} y2={i * 40} stroke="rgba(15,23,42,0.06)" strokeWidth={1} />
              ))}
            </>
          )}

          {sorted.map((o) => (
            <ObjectShape
              key={o.id}
              o={o}
              isOccupied={o.type === 'chair' && occupiedSet.has(o.id)}
              isSelected={o.type === 'chair' && selectedSet.has(o.id)}
              onChairClick={(id) => onToggle(id)}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}

function ObjectShape({ o, isOccupied, isSelected, onChairClick }: {
  o: LayoutObject;
  isOccupied: boolean;
  isSelected: boolean;
  onChairClick: (id: string) => void;
}) {
  const w = o.w ?? 40;
  const h = o.h ?? 40;
  const rot = o.rot || 0;
  const cx = o.x + w / 2;
  const cy = o.y + h / 2;
  const p = PRESETS[o.type];

  // ---- chair: clickable, status-coloured ----
  if (o.type === 'chair') {
    const palette = isSelected ? CHAIR_SELECTED : isOccupied ? CHAIR_OCCUPIED : CHAIR_AVAILABLE;
    const back = 4;
    return (
      <g
        transform={`rotate(${rot} ${cx} ${cy})`}
        style={{ cursor: isOccupied ? 'not-allowed' : 'pointer' }}
        onClick={() => { if (!isOccupied) onChairClick(o.id); }}
        aria-label={`Chair ${o.label || o.id}${isOccupied ? ' (taken)' : isSelected ? ' (your pick)' : ' (available)'}`}
      >
        <rect x={o.x} y={o.y} width={w} height={back}
          rx={2} ry={2} fill={palette.stroke} opacity={0.7} />
        <rect x={o.x + 1} y={o.y + back} width={w - 2} height={h - back - 1}
          rx={6} ry={6} fill={palette.fill} stroke={palette.stroke} strokeWidth={isSelected ? 2.5 : 1.5} />
        <text x={cx} y={cy + 4}
          textAnchor="middle"
          fontSize={10}
          fontWeight={600}
          fill={palette.text}
          pointerEvents="none">
          {o.label || o.id}
        </text>
      </g>
    );
  }

  // ---- decorative shapes (mirror admin renderer minus animations) ----
  if (o.type === 'table_round') {
    const r = Math.min(w, h) / 2;
    return (
      <g transform={`rotate(${rot} ${cx} ${cy})`}>
        <ellipse cx={cx + 2} cy={cy + 3} rx={r} ry={r * 0.95} fill="#0f172a" opacity={0.08} />
        <circle cx={cx} cy={cy} r={r} fill="url(#dp-wood)" stroke={p.stroke} strokeWidth={1.5} />
        <circle cx={cx} cy={cy} r={Math.max(2, r - 6)} fill="none" stroke={p.stroke} strokeOpacity={0.25} strokeWidth={1} />
      </g>
    );
  }
  if (o.type === 'table_rect') {
    return (
      <g transform={`rotate(${rot} ${cx} ${cy})`}>
        <rect x={o.x + 2} y={o.y + 3} width={w} height={h} rx={8} ry={8} fill="#0f172a" opacity={0.08} />
        <rect x={o.x} y={o.y} width={w} height={h} rx={8} ry={8} fill="url(#dp-wood)" stroke={p.stroke} strokeWidth={1.5} />
        <line x1={o.x + w / 2} y1={o.y + 6} x2={o.x + w / 2} y2={o.y + h - 6}
          stroke={p.stroke} strokeOpacity={0.18} strokeWidth={1} />
      </g>
    );
  }
  if (o.type === 'meeting_room') {
    // Soft blue rounded box with a centred "MR" badge - matches the admin
    // renderer so the booker sees the room exactly where it was placed.
    const labelText = (o.label && o.label.trim().length > 0) ? o.label : 'MR';
    const stroke = '#2563eb';
    return (
      <g transform={`rotate(${rot} ${cx} ${cy})`}>
        <rect x={o.x + 2} y={o.y + 3} width={w} height={h} rx={10} ry={10}
          fill="#0f172a" opacity={0.08} />
        <rect x={o.x} y={o.y} width={w} height={h}
          rx={10} ry={10} fill={p.fill} stroke={stroke} strokeWidth={1.5} />
        <text x={o.x + w / 2} y={o.y + h / 2 + 5}
          textAnchor="middle"
          fontSize={Math.max(11, Math.min(18, Math.min(w, h) / 5))}
          fontWeight={700} fill={stroke} pointerEvents="none">
          {labelText}
        </text>
      </g>
    );
  }
  if (o.type === 'wall') {
    const isPerim = !!o.perimeter;
    return (
      <rect x={o.x} y={o.y} width={w} height={h}
        rx={2} ry={2}
        fill={isPerim ? 'url(#dp-wall)' : p.fill}
        stroke={p.stroke} strokeWidth={1.5}
      />
    );
  }
  if (o.type === 'door') {
    const d = `M ${o.x} ${o.y + h} A ${w} ${h} 0 0 1 ${o.x + w} ${o.y}`;
    return (
      <g transform={`rotate(${rot} ${cx} ${cy})`}>
        <rect x={o.x} y={o.y} width={w} height={h} rx={3} ry={3} fill={p.fill} stroke={p.stroke} strokeWidth={1.5} opacity={0.35} />
        <path d={d} fill="none" stroke={p.stroke} strokeWidth={1.5} strokeDasharray="3 3" />
        <line x1={o.x} y1={o.y} x2={o.x} y2={o.y + h} stroke={p.stroke} strokeWidth={2.5} />
      </g>
    );
  }
  if (o.type === 'plant') {
    const r = Math.min(w, h) / 2;
    return (
      <g transform={`rotate(${rot} ${cx} ${cy})`}>
        <circle cx={cx}            cy={cy}            r={r * 0.55} fill="#22c55e" stroke="#15803d" strokeWidth={1} />
        <circle cx={cx - r * 0.35} cy={cy + r * 0.15} r={r * 0.4}  fill="#16a34a" stroke="#15803d" strokeWidth={1} />
        <circle cx={cx + r * 0.35} cy={cy + r * 0.1}  r={r * 0.4}  fill="#16a34a" stroke="#15803d" strokeWidth={1} />
      </g>
    );
  }
  return (
    <rect x={o.x} y={o.y} width={w} height={h} rx={6} ry={6}
      fill={p.fill} stroke={p.stroke} strokeWidth={1.5} />
  );
}
