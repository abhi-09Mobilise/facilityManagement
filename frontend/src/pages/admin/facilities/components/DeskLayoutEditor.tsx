// F09 - Desk layout editor (v3).
//
// Two modes:
//   • image  - admin uploads a floor plan; we render it as the canvas
//              background, then admin drops chairs onto it.
//   • blank  - admin starts from a faint grid + uses the side furniture
//              palette to build a room from scratch.
//
// Capacity drives how many BOOKABLE chairs ('chair' type with `id: C-NN`)
// exist on the canvas. Everything else (table, wall, door, plant) is
// decorative.
//
// Perimeter walls: whenever widthM/heightM change we re-anchor the four
// edge walls to the room edges. Admin can still drag them inward or
// resize them to carve out an opening — the auto-reframe only repositions
// the anchored side, not the perpendicular length.
//
// Storage: layout JSON (v2 shape) lives on facilities.layout_json. The
// uploaded floor plan image is base64-encoded into the same JSON so we
// don't need a separate upload endpoint for the first cut.

import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  FacilityLayout, FacilityLayoutV1, FacilityType, LayoutObject, LayoutObjectType,
} from '@/types';
import { Button } from '@/components/ui/button';
import { facilitiesApi } from '@/api/facilities.api';
import { floorScanApi } from '@/api/floorScan.api';
import {
  Upload, Grid3x3, Trash2, RotateCw, MousePointer2,
  Square, Circle, Armchair, DoorOpen, TreePine, Sofa,
  Maximize2, X, LayoutDashboard, Wand2, Loader2, Undo2,
  ChevronUp, ChevronDown, HelpCircle,
} from 'lucide-react';

// Default canvas size: 12m × 8m at 60 px/m = 720 × 480 px.
const DEFAULT: FacilityLayout = {
  version: 2, mode: 'blank',
  widthM: 12, heightM: 8, pxPerMeter: 60, snapPx: 20,
  imageUrl: null, objects: [],
};

const WALL_THICK = 10;   // px thickness of perimeter walls
const CHAIR_W    = 36;   // px - chair seat width
const CHAIR_H    = 36;

// Per-type defaults for w/h/colour/icon when we add a new object.
type Preset = {
  w: number; h: number; fill: string; stroke: string; label: string; icon: typeof Square;
};
const PRESETS: Record<LayoutObjectType, Preset> = {
  desk:          { w: 72,  h: 54,  fill: '#dcfce7', stroke: '#16a34a', label: 'Desk',  icon: Square },
  meeting_room:  { w: 140, h: 100, fill: '#dbeafe', stroke: '#2563eb', label: 'MR',    icon: Square },
  chair:         { w: CHAIR_W, h: CHAIR_H, fill: '#fef3c7', stroke: '#a16207', label: '', icon: Armchair },
  table_round:   { w: 80,  h: 80,  fill: '#fff7ed', stroke: '#9a3412', label: '',      icon: Circle },
  table_rect:    { w: 120, h: 60,  fill: '#fff7ed', stroke: '#9a3412', label: '',      icon: Square },
  wall:          { w: 120, h: WALL_THICK, fill: '#475569', stroke: '#1e293b', label: '', icon: Square },
  door:          { w: 36,  h: 36,  fill: '#fde68a', stroke: '#b45309', label: 'Door',  icon: DoorOpen },
  plant:         { w: 40,  h: 40,  fill: '#dcfce7', stroke: '#15803d', label: '',      icon: TreePine },
};

// Migrate v1 grid-cell layouts to v2 pixel-coordinate layouts.
function migrateToV2(raw: FacilityLayout | FacilityLayoutV1 | null | undefined, capacity: number): FacilityLayout {
  if (!raw) return cloneDefault(capacity);
  if ((raw as FacilityLayout).version === 2) return raw as FacilityLayout;
  const v1 = raw as FacilityLayoutV1;
  const px = 60;
  const cell = v1.cellSize || px;
  // In v1 these were "desks" but we treat them as chairs from v3 onwards.
  const objects: LayoutObject[] = v1.desks.map((d, i) => ({
    id: 'C-' + String(i + 1).padStart(2, '0'),
    type: 'chair',
    x: d.x * cell + 6,
    y: d.y * cell + 6,
    w: CHAIR_W,
    h: CHAIR_H,
    label: 'C-' + String(i + 1).padStart(2, '0'),
    rot: 0,
  }));
  return {
    version: 2, mode: 'blank',
    widthM:  Math.max(8, Math.round((v1.cols * cell) / px)),
    heightM: Math.max(6, Math.round((v1.rows * cell) / px)),
    pxPerMeter: px, snapPx: 20, imageUrl: null,
    objects,
  };
}

function cloneDefault(_capacity: number): FacilityLayout {
  // Start with a blank canvas. Admin lays everything down by hand from
  // the palette so the editor doesn't "fight" them on every facility
  // (e.g. a floor plan already has the walls drawn in).
  return { ...DEFAULT, objects: [] };
}

// Make sure the layout has exactly `capacity` bookable chairs (C-NN).
// Re-IDs chairs after add/remove so the labels stay sequential.
function syncChairCount(layout: FacilityLayout, capacity: number): FacilityLayout {
  const chairs = layout.objects.filter((o) => o.type === 'chair');
  const others = layout.objects.filter((o) => o.type !== 'chair');
  const N = Math.max(0, capacity);
  let next = chairs.slice(0, N);
  // Position grid for newly added chairs (clear of the wall thickness)
  const inset = WALL_THICK + 14;
  const cellW = CHAIR_W + 24;
  const cellH = CHAIR_H + 24;
  const innerW = Math.max(1, Math.round(layout.widthM  * layout.pxPerMeter) - inset * 2);
  const cols = Math.max(1, Math.floor(innerW / cellW));
  while (next.length < N) {
    const idx = next.length;
    const id = 'C-' + String(idx + 1).padStart(2, '0');
    const x = inset + (idx % cols) * cellW;
    const y = inset + Math.floor(idx / cols) * cellH;
    next.push({ id, type: 'chair', x, y, w: CHAIR_W, h: CHAIR_H, label: id, rot: 0 });
  }
  // Re-id chairs to be tidy after trim
  next = next.map((c, i) => {
    const id = 'C-' + String(i + 1).padStart(2, '0');
    return { ...c, id, label: id };
  });
  return { ...layout, objects: [...next, ...others] };
}

// Ensure four perimeter walls (one per side) exist + sit against the
// current room edges. We only update the anchored axis of each wall so
// the admin's manual length/thickness tweaks are preserved.
function ensurePerimeterWalls(layout: FacilityLayout): FacilityLayout {
  const W = Math.round(layout.widthM  * layout.pxPerMeter);
  const H = Math.round(layout.heightM * layout.pxPerMeter);
  const sides: Array<'top' | 'bottom' | 'left' | 'right'> = ['top', 'bottom', 'left', 'right'];
  const objects = [...layout.objects];

  for (const side of sides) {
    let i = objects.findIndex((o) => o.perimeter && o.side === side);
    const existing = i >= 0 ? objects[i] : null;
    const thick = existing?.[side === 'top' || side === 'bottom' ? 'h' : 'w'] ?? WALL_THICK;
    let next: LayoutObject;
    if (side === 'top') {
      next = {
        id: existing?.id ?? 'wall-top',
        type: 'wall', perimeter: true, side: 'top',
        x: existing?.x ?? 0,
        y: 0,
        w: existing?.w ?? W,
        h: thick,
        rot: 0,
      };
    } else if (side === 'bottom') {
      next = {
        id: existing?.id ?? 'wall-bottom',
        type: 'wall', perimeter: true, side: 'bottom',
        x: existing?.x ?? 0,
        y: H - thick,
        w: existing?.w ?? W,
        h: thick,
        rot: 0,
      };
    } else if (side === 'left') {
      next = {
        id: existing?.id ?? 'wall-left',
        type: 'wall', perimeter: true, side: 'left',
        x: 0,
        y: existing?.y ?? 0,
        w: thick,
        h: existing?.h ?? H,
        rot: 0,
      };
    } else {
      next = {
        id: existing?.id ?? 'wall-right',
        type: 'wall', perimeter: true, side: 'right',
        x: W - thick,
        y: existing?.y ?? 0,
        w: thick,
        h: existing?.h ?? H,
        rot: 0,
      };
    }
    if (i >= 0) objects[i] = next; else objects.push(next);
  }
  return { ...layout, objects };
}

function snap(v: number, step: number): number {
  if (!step || step <= 0) return Math.round(v);
  return Math.round(v / step) * step;
}

export interface DeskLayoutEditorProps {
  value: FacilityLayout | FacilityLayoutV1 | null;
  onChange: (next: FacilityLayout) => void;
  capacity: number;
  // F09 - id of the facility being edited (when editing an existing one).
  // Used by the chair-delete guard to ask the backend whether there are
  // active future bookings holding the chair before letting admin delete
  // it. Pass null/undefined on a brand-new (unsaved) facility - the guard
  // is skipped because no bookings can possibly exist yet.
  facilityId?: number | null;
  // F09 - background fallback from the selected floor master. When a
  // saved layout has no imageUrl of its own, the editor opens in image
  // mode against this picture. Admin can still upload their own override.
  floorImageUrl?: string | null;
  // 'desk' -> chairs are capacity-driven, palette has tables + walls etc.
  // 'meeting_room' -> palette has meeting-room boxes, no capacity sync.
  // Anything else falls back to 'desk' behaviour for compat with older
  // call-sites.
  facilityType?: FacilityType;
}

type DragMode =
  | { kind: 'move'; id: string; dx: number; dy: number }
  | { kind: 'resize'; id: string; handle: ResizeHandle; ox: number; oy: number; ow: number; oh: number };

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export default function DeskLayoutEditor({
  value, onChange, capacity, floorImageUrl, facilityType = 'desk',
  facilityId = null,
}: DeskLayoutEditorProps) {
  // Meeting-room layouts use a different palette and don't auto-spawn
  // chairs from `capacity` (rooms aren't seat-driven). Treat any unknown
  // type as 'desk' for backwards compatibility.
  const isMeetingRoom = facilityType === 'meeting_room';

  const seed = useMemo(() => {
    // No more auto-perimeter-walls and no more capacity-driven chairs -
    // the canvas opens empty save for whatever the admin previously saved
    // (or the floor plan background, see below).
    let next = migrateToV2(value as FacilityLayout, capacity);
    // When the floor master provides a default image and the saved layout
    // hasn't picked its own background, seed mode='image' with that URL
    // so the admin sees the floor plan as soon as the editor opens.
    if (floorImageUrl && !next.imageUrl) {
      next = { ...next, mode: 'image', imageUrl: floorImageUrl };
    }
    return next;
  }, [value, capacity, floorImageUrl]);
  const [layout, setLayout] = useState<FacilityLayout>(seed);
  useEffect(() => { setLayout(seed); }, [seed]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragMode | null>(null);

  // OpenCV auto-detect state. We fire detection automatically after a
  // floor-plan upload (user's pick over "manual button"). The overlay
  // covers the canvas while it runs; on success a one-line summary stays
  // visible until the next scan or until the admin clicks Dismiss.
  // Failures are silent — falls back to manual placement, never blocks.
  const [scanning, setScanning] = useState(false);
  const [scanSummary, setScanSummary] = useState<string | null>(null);
  // True when the last scan added any objects -> enables the Undo button.
  const [scanHasResults, setScanHasResults] = useState(false);

  // Toolbar collapse — hidden state gives the canvas an extra ~50 px of
  // vertical room which is the difference between "tight fit" and "easy
  // to work in" on smaller laptop screens. Persisted in localStorage so
  // the admin's preference sticks across sessions.
  const [toolbarOpen, setToolbarOpen] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem('deskLayoutToolbarOpen');
      return v === null ? true : v === '1';
    } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem('deskLayoutToolbarOpen', toolbarOpen ? '1' : '0'); } catch { /* private mode */ }
  }, [toolbarOpen]);

  // Keyboard-shortcuts hint popover. Toggled by the '?' button in the
  // modal header. Closes on Esc (handled by the modal's existing onEsc).
  const [showShortcuts, setShowShortcuts] = useState(false);
  // Default size for the NEXT chair / wall drop. The admin tweaks the
  // metre inputs in the palette; every subsequent palette click drops a
  // new chair / wall at that size, so a row of identical seats can be
  // laid down without resizing each one. Tables stay manual.
  const [defaultSizes, setDefaultSizes] = useState<{
    chair: { w: number; h: number };
    wall:  { w: number; h: number };
  }>({
    chair: { w: PRESETS.chair.w, h: PRESETS.chair.h },
    wall:  { w: PRESETS.wall.w,  h: PRESETS.wall.h  },
  });
  // Full-screen modal toggle. The trigger button on the form opens this; the
  // canvas + toolbar + palette all live inside.
  const [editorOpen, setEditorOpen] = useState<boolean>(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Esc closes the modal; also lock background scroll while it's open so
  // the page doesn't jump when the user wheels inside the canvas.
  useEffect(() => {
    if (!editorOpen) return;
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') setEditorOpen(false); }
    document.addEventListener('keydown', onEsc);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onEsc);
      document.body.style.overflow = prevOverflow;
    };
  }, [editorOpen]);

  const W = Math.round(layout.widthM  * layout.pxPerMeter);
  const H = Math.round(layout.heightM * layout.pxPerMeter);

  function commit(next: FacilityLayout) {
    setLayout(next);
    onChange(next);
  }

  // Just resize the canvas - the perimeter wall auto-reframe is intentionally
  // gone now that admins want to start with a blank slate (or a floor plan)
  // and drop walls only where they actually need them.
  function setFloorSize(widthM: number, heightM: number) {
    commit({ ...layout, widthM, heightM });
  }

  function setField<K extends keyof FacilityLayout>(k: K, v: FacilityLayout[K]) {
    commit({ ...layout, [k]: v });
  }

  function addObject(type: LayoutObjectType) {
    const preset = PRESETS[type];
    // Chair + wall come out at the user-tunable default; everything else
    // (tables, meeting rooms, doors, plants) keeps the preset size so the
    // table-shape inputs stay manual-only as requested.
    const sizeW = type === 'chair' ? defaultSizes.chair.w
               : type === 'wall'  ? defaultSizes.wall.w
               : preset.w;
    const sizeH = type === 'chair' ? defaultSizes.chair.h
               : type === 'wall'  ? defaultSizes.wall.h
               : preset.h;
    // Chairs get a sequential bookable id (C-01, C-02, …) so the booker-
    // side picker can show "Chair X is taken/free". Everything else gets
    // a random obj-XXXX id since the booker doesn't need to address it.
    let id: string;
    let label: string | undefined;
    if (type === 'chair') {
      // First-available slot: scan existing C-NN ids, pick the smallest
      // positive integer that isn't taken. Deleting C-02 from
      // {C-01, C-02, C-03} and then adding a new chair gives C-02 back
      // (instead of producing a duplicate C-03).
      const used = new Set<number>();
      for (const o of layout.objects) {
        if (o.type !== 'chair') continue;
        const m = /^C-(\d+)$/.exec(o.id || '');
        if (m) used.add(parseInt(m[1], 10));
      }
      let n = 1;
      while (used.has(n)) n++;
      id = 'C-' + String(n).padStart(2, '0');
      label = id;
    } else {
      id = 'obj-' + Math.random().toString(36).slice(2, 8);
      label = preset.label || undefined;
    }
    const obj: LayoutObject = {
      id, type,
      x: snap(W / 2 - sizeW / 2, layout.snapPx),
      y: snap(H / 2 - sizeH / 2, layout.snapPx),
      w: sizeW, h: sizeH, rot: 0,
      label,
    };
    commit({ ...layout, objects: [...layout.objects, obj] });
    setSelectedId(id);
  }

  function deleteObject(id: string) {
    const obj = layout.objects.find((o) => o.id === id);
    if (!obj) return;
    // Legacy auto-walls can't be deleted - the auto-reframe was the only
    // thing pinning them in place and removing one breaks the room edge.
    if (obj.perimeter) return;
    // Chairs need the delete-guard: ask the backend whether there are
    // active future bookings holding this chair id. If yes, warn before
    // proceeding (delete is still allowed, but the admin should know
    // those bookings will be orphaned / re-mapped if a new chair takes
    // the freed C-NN slot).
    if (obj.type === 'chair' && facilityId) {
      facilitiesApi.chairBookings(facilityId, obj.id).then((res) => {
        const cnt = res.data?.count || 0;
        if (cnt > 0) {
          const ok = window.confirm(
            `Chair ${obj.id} has ${cnt} upcoming booking${cnt === 1 ? '' : 's'}.\n` +
            `If you delete it now and add a new chair later, that new chair will reuse ${obj.id} ` +
            `and the existing bookings will silently point at it.\n\nDelete anyway?`
          );
          if (!ok) return;
        }
        commit({ ...layout, objects: layout.objects.filter((o) => o.id !== id) });
        setSelectedId(null);
      }).catch(() => {
        // Backend probe failed (network blip, brand-new facility, etc.) -
        // fall through to a plain delete so we don't block the editor.
        commit({ ...layout, objects: layout.objects.filter((o) => o.id !== id) });
        setSelectedId(null);
      });
      return;
    }
    commit({ ...layout, objects: layout.objects.filter((o) => o.id !== id) });
    setSelectedId(null);
  }

  function rotateObject(id: string, degrees: number) {
    commit({
      ...layout,
      objects: layout.objects.map((o) =>
        o.id === id ? { ...o, rot: ((o.rot || 0) + degrees + 360) % 360 } : o
      ),
    });
  }

  function moveObject(id: string, x: number, y: number) {
    const obj = layout.objects.find((o) => o.id === id);
    if (!obj) return;
    const ow = obj.w || 60;
    const oh = obj.h || 60;
    // Perimeter walls only slide along their long axis.
    let nx: number, ny: number;
    if (obj.perimeter && (obj.side === 'top' || obj.side === 'bottom')) {
      nx = Math.max(0, Math.min(W - ow, snap(x, layout.snapPx)));
      ny = obj.y;
    } else if (obj.perimeter && (obj.side === 'left' || obj.side === 'right')) {
      nx = obj.x;
      ny = Math.max(0, Math.min(H - oh, snap(y, layout.snapPx)));
    } else {
      nx = Math.max(0, Math.min(W - ow, snap(x, layout.snapPx)));
      ny = Math.max(0, Math.min(H - oh, snap(y, layout.snapPx)));
    }
    commit({
      ...layout,
      objects: layout.objects.map((o) => (o.id === id ? { ...o, x: nx, y: ny } : o)),
    });
  }

  function resizeObject(id: string, handle: ResizeHandle, x: number, y: number, ox: number, oy: number, ow: number, oh: number) {
    const obj = layout.objects.find((o) => o.id === id);
    if (!obj) return;
    let nx = ox, ny = oy, nw = ow, nh = oh;
    const minSz = 8;
    if (handle.includes('e')) nw = Math.max(minSz, snap(x - ox, layout.snapPx));
    if (handle.includes('s')) nh = Math.max(minSz, snap(y - oy, layout.snapPx));
    if (handle.includes('w')) {
      const right = ox + ow;
      nx = Math.min(right - minSz, snap(x, layout.snapPx));
      nw = right - nx;
    }
    if (handle.includes('n')) {
      const bot = oy + oh;
      ny = Math.min(bot - minSz, snap(y, layout.snapPx));
      nh = bot - ny;
    }
    // Clamp to canvas bounds
    nx = Math.max(0, nx); ny = Math.max(0, ny);
    nw = Math.min(W - nx, nw); nh = Math.min(H - ny, nh);
    commit({
      ...layout,
      objects: layout.objects.map((o) => o.id === id ? { ...o, x: nx, y: ny, w: nw, h: nh } : o),
    });
  }

  function svgPoint(clientX: number, clientY: number): { x: number; y: number } | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const sx = ((clientX - rect.left) / rect.width)  * W;
    const sy = ((clientY - rect.top)  / rect.height) * H;
    return { x: sx, y: sy };
  }

  useEffect(() => {
    if (!drag) return;
    function onMove(e: MouseEvent) {
      const p = svgPoint(e.clientX, e.clientY);
      if (!p) return;
      if (drag!.kind === 'move') {
        moveObject(drag!.id, p.x - drag!.dx, p.y - drag!.dy);
      } else {
        const d = drag!;
        resizeObject(d.id, d.handle, p.x, p.y, d.ox, d.oy, d.ow, d.oh);
      }
    }
    function onUp() { setDrag(null); }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, layout]);

  // Keyboard shortcuts when an object is selected.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!selectedId) return;
      const obj = layout.objects.find((o) => o.id === selectedId);
      if (!obj) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const step = e.shiftKey ? 16 : 4;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault(); deleteObject(selectedId);
      } else if (e.key === 'r' || e.key === 'R') {
        // R = clockwise 15° (Shift+R = anticlockwise 15°, kept for backwards
        // compat with existing muscle memory).
        e.preventDefault();
        rotateObject(selectedId, e.shiftKey ? -15 : 15);
      } else if (e.key === 'e' || e.key === 'E') {
        // E = anticlockwise 15° (Shift+E = anticlockwise 45° for big jumps).
        // Mirrors the Q/E rotation convention from 3D editors / games.
        e.preventDefault();
        rotateObject(selectedId, e.shiftKey ? -45 : -15);
      } else if (e.key === 'ArrowLeft')  { e.preventDefault(); moveObject(selectedId, obj.x - step, obj.y); }
      else if (e.key === 'ArrowRight')   { e.preventDefault(); moveObject(selectedId, obj.x + step, obj.y); }
      else if (e.key === 'ArrowUp')      { e.preventDefault(); moveObject(selectedId, obj.x, obj.y - step); }
      else if (e.key === 'ArrowDown')    { e.preventDefault(); moveObject(selectedId, obj.x, obj.y + step); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, layout]);

  // Image upload -> base64 data URL embedded into the layout.
  // After upload, fire OpenCV detection in the background. Detection is
  // best-effort; if it fails (service down, no detections, etc.) we silently
  // fall back to manual placement so the admin never gets a scary error wall.
  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1.5 * 1024 * 1024) {
      alert('Floor plan is bigger than 1.5 MB — please compress it first.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const next = { ...layout, mode: 'image' as const, imageUrl: dataUrl };
      commit(next);
      // Run auto-detect against the fresh image. We pass `next` (not
      // `layout`) so the scan merge sees the just-committed canvas state.
      runScan(dataUrl, next);
    };
    reader.readAsDataURL(file);
  }

  // Build LayoutObject entries from a ScanResult, merging additively into
  // the supplied baseline layout. Scanned items are tagged _fromScan:true
  // so the "Undo last scan" button can strip just them without disturbing
  // manually-placed objects.
  async function runScan(imageDataUrl: string, baseline: FacilityLayout) {
    setScanning(true);
    setScanSummary(null);
    try {
      const res = await floorScanApi.scan(imageDataUrl);
      const data = res.data;
      if (!data || (!data.chairs.length && !data.tables_round.length && !data.tables_rect.length)) {
        // Service returned 0 detections — still success, but nothing to merge.
        setScanSummary('Auto-detect found nothing usable in this plan — drop chairs / tables manually.');
        setScanHasResults(false);
        return;
      }

      // Canvas is rendered at (widthM * pxPerMeter, heightM * pxPerMeter).
      // The detector returned coords in original-image pixels. Scale.
      const canvasW = baseline.widthM * baseline.pxPerMeter;
      const canvasH = baseline.heightM * baseline.pxPerMeter;
      const sx = canvasW / Math.max(1, data.image_width);
      const sy = canvasH / Math.max(1, data.image_height);

      // First-available chair-id allocator, identical to addObject('chair').
      const usedNums = new Set<number>();
      for (const o of baseline.objects) {
        if (o.type !== 'chair') continue;
        const m = /^C-(\d+)$/.exec(o.id || '');
        if (m) usedNums.add(parseInt(m[1], 10));
      }
      function nextChairId(): string {
        let n = 1; while (usedNums.has(n)) n++;
        usedNums.add(n);
        return 'C-' + String(n).padStart(2, '0');
      }
      function randId(prefix: string) { return prefix + '-' + Math.random().toString(36).slice(2, 8); }

      const added: LayoutObject[] = [];

      for (const c of data.chairs) {
        const id = nextChairId();
        added.push({
          id, type: 'chair',
          x: Math.round(c.x * sx),
          y: Math.round(c.y * sy),
          w: Math.max(20, Math.round(c.w * sx)),
          h: Math.max(20, Math.round(c.h * sy)),
          rot: 0, label: id, _fromScan: true,
        });
      }
      for (const t of data.tables_round) {
        const diameterPx = Math.max(30, Math.round(2 * t.r * Math.min(sx, sy)));
        added.push({
          id: randId('obj'),
          type: 'table_round',
          x: Math.round(t.cx * sx - diameterPx / 2),
          y: Math.round(t.cy * sy - diameterPx / 2),
          w: diameterPx, h: diameterPx, rot: 0,
          _fromScan: true,
        });
      }
      for (const t of data.tables_rect) {
        added.push({
          id: randId('obj'),
          type: 'table_rect',
          x: Math.round(t.x * sx),
          y: Math.round(t.y * sy),
          w: Math.max(30, Math.round(t.w * sx)),
          h: Math.max(20, Math.round(t.h * sy)),
          rot: 0, _fromScan: true,
        });
      }

      commit({ ...baseline, objects: [...baseline.objects, ...added] });
      const bits: string[] = [];
      if (data.chairs.length)        bits.push(`${data.chairs.length} chair${data.chairs.length === 1 ? '' : 's'}`);
      if (data.tables_round.length)  bits.push(`${data.tables_round.length} round table${data.tables_round.length === 1 ? '' : 's'}`);
      if (data.tables_rect.length)   bits.push(`${data.tables_rect.length} rectangular table${data.tables_rect.length === 1 ? '' : 's'}`);
      setScanSummary('Auto-detect added ' + bits.join(' + ') + '. Review and adjust before saving.');
      setScanHasResults(true);
    } catch (err) {
      // Service down / 4xx-5xx / network — log to console and stay quiet
      // in the UI so the admin can still place chairs manually.
      console.warn('[floor-scan] failed:', err);
      setScanSummary(
        'Couldn\'t auto-detect this time (scan service unreachable). You can still place chairs / tables manually.'
      );
      setScanHasResults(false);
    } finally {
      setScanning(false);
    }
  }

  // Strip every object tagged _fromScan:true. Used by the Undo button so
  // the admin can wipe a noisy detection pass without losing manual edits.
  function undoLastScan() {
    commit({
      ...layout,
      objects: layout.objects.filter((o) => !o._fromScan),
    });
    setScanHasResults(false);
    setScanSummary(null);
  }

  // Re-run detection against the current imageUrl. Useful after the admin
  // tweaks canvas size (which changes the px-per-metre scaling) or wants
  // a second pass with different luck.
  function rerunScan() {
    if (!layout.imageUrl) return;
    // First clear previous scan output so we don't double-stack chairs.
    const stripped = { ...layout, objects: layout.objects.filter((o) => !o._fromScan) };
    setLayout(stripped); // local-only; runScan will commit the merged result
    runScan(layout.imageUrl, stripped);
  }

  // ---- palette items ----
  // Slimmed to just the essentials: walls + chair + tables. The chair count
  // on the canvas IS the facility's capacity (computed on save), so the
  // chair palette item is the one drag-and-drop the admin really needs.
  const PALETTE: LayoutObjectType[] = ['chair', 'table_round', 'table_rect', 'wall'];
  const selected = layout.objects.find((o) => o.id === selectedId) || null;

  // ----- summary card shown on the form -----
  const chairCount = layout.objects.filter((o) => o.type === 'chair').length;
  const roomCount  = layout.objects.filter((o) => o.type === 'meeting_room').length;
  const furnitureCount = layout.objects.filter((o) =>
    o.type !== 'chair' && o.type !== 'wall' && o.type !== 'meeting_room'
  ).length;

  return (
    <>
      {/* ===== Trigger card (always visible on the facility form) ===== */}
      <div className="panel panel-pad">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold text-base flex items-center gap-2">
              <LayoutDashboard className="h-4 w-4 text-primary" /> Floor plan
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {layout.widthM}m × {layout.heightM}m · <b>{chairCount}</b> chair{chairCount === 1 ? '' : 's'} placed (= facility capacity)
              {furnitureCount > 0 ? ` · ${furnitureCount} furniture item${furnitureCount === 1 ? '' : 's'}` : ''}
              {layout.imageUrl ? ' · floor plan loaded' : ''}
            </p>
          </div>
          <Button type="button" onClick={() => setEditorOpen(true)}>
            <Maximize2 className="h-4 w-4 mr-1.5" />
            {chairCount > 0 || furnitureCount > 0 || layout.imageUrl ? 'Edit floor plan' : 'Design floor plan'}
          </Button>
        </div>
      </div>

      {/* ===== Full-screen modal editor ===== */}
      {editorOpen && (
        <div
          className="fixed inset-0 z-50 flex items-stretch justify-stretch bg-foreground/50 p-4 sm:p-6 md:p-8"
          // Click on the dim overlay (NOT inside the modal panel) closes.
          onClick={(e) => { if (e.target === e.currentTarget) setEditorOpen(false); }}
          role="dialog"
          aria-modal="true"
          aria-label="Design floor plan"
        >
          <div className="bg-card rounded-lg shadow-2xl border w-full h-full flex flex-col overflow-hidden">
            {/* Modal header — compact. Dropped the subtitle paragraph
                (everything explanatory lives on the trigger card outside
                the modal). Tighter padding + a chevron to collapse the
                toolbar give the canvas ~80-140 px of extra height. */}
            <div className="flex items-center justify-between gap-2 border-b px-4 py-1.5 shrink-0">
              <h2 className="font-semibold text-sm flex items-center gap-2 min-w-0">
                <LayoutDashboard className="h-4 w-4 text-primary shrink-0" />
                <span className="truncate">Design floor plan</span>
                {/* Quick chip with the live chair count so the admin can
                    see "how many seats so far" without scanning the
                    canvas — common ask during layout-from-scratch flows. */}
                <span className="ml-2 text-xs font-normal text-muted-foreground hidden sm:inline">
                  {chairCount} chair{chairCount === 1 ? '' : 's'}
                </span>
              </h2>
              <div className="flex items-center gap-1 shrink-0 relative">
                <button
                  type="button"
                  onClick={() => setShowShortcuts((v) => !v)}
                  aria-label="Keyboard shortcuts"
                  title="Keyboard shortcuts"
                  className={
                    'text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted ' +
                    (showShortcuts ? 'bg-muted text-foreground' : '')
                  }>
                  <HelpCircle className="h-4 w-4" />
                </button>
                {showShortcuts && (
                  <div
                    className="absolute right-0 top-9 z-30 w-72 rounded-md border bg-popover text-popover-foreground shadow-lg p-3 text-xs"
                    onMouseLeave={() => setShowShortcuts(false)}>
                    <div className="font-semibold text-foreground mb-2 flex items-center justify-between">
                      Keyboard shortcuts
                      <button type="button" onClick={() => setShowShortcuts(false)}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label="Close shortcuts">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="text-muted-foreground text-[11px] mb-2">
                      Select an object on the canvas first, then:
                    </div>
                    <ul className="space-y-1.5">
                      <li className="flex items-center justify-between gap-2">
                        <span>Move (4 px)</span>
                        <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-mono">← ↑ → ↓</kbd>
                      </li>
                      <li className="flex items-center justify-between gap-2">
                        <span>Move (16 px)</span>
                        <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-mono">Shift + arrows</kbd>
                      </li>
                      <li className="flex items-center justify-between gap-2">
                        <span>Rotate clockwise 15°</span>
                        <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-mono">R</kbd>
                      </li>
                      <li className="flex items-center justify-between gap-2">
                        <span>Rotate anticlockwise 15°</span>
                        <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-mono">E</kbd>
                      </li>
                      <li className="flex items-center justify-between gap-2">
                        <span>Rotate anticlockwise 45°</span>
                        <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-mono">Shift + E</kbd>
                      </li>
                      <li className="flex items-center justify-between gap-2">
                        <span>Delete</span>
                        <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-mono">Del / Backspace</kbd>
                      </li>
                      <li className="flex items-center justify-between gap-2">
                        <span>Close editor</span>
                        <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-mono">Esc</kbd>
                      </li>
                    </ul>
                    <div className="mt-2 pt-2 border-t text-[10px] text-muted-foreground">
                      Tip: drag handles on a selected object to resize. Shortcuts ignore typing in inputs.
                    </div>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setToolbarOpen((v) => !v)}
                  aria-label={toolbarOpen ? 'Hide toolbar' : 'Show toolbar'}
                  title={toolbarOpen ? 'Hide toolbar (more canvas space)' : 'Show toolbar'}
                  className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted">
                  {toolbarOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                <Button type="button" size="sm" variant="default"
                  onClick={() => setEditorOpen(false)}>
                  Done
                </Button>
                <button
                  type="button"
                  onClick={() => setEditorOpen(false)}
                  aria-label="Close"
                  className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Toolbar — collapsible via the chevron above. Tighter
                padding + smaller inputs vs the original. */}
            {toolbarOpen && (
            <div className="border-b px-4 py-1.5 shrink-0 flex flex-wrap items-center gap-1.5 text-xs">
              {/* Mode toggle — kept text but no padding bloat. */}
              <div className="inline-flex rounded-md border overflow-hidden text-xs">
                <button type="button"
                  onClick={() => setField('mode', 'blank')}
                  className={layout.mode === 'blank' ? 'px-2 py-1 bg-primary text-primary-foreground' : 'px-2 py-1 bg-background hover:bg-muted'}>
                  Blank
                </button>
                <button type="button"
                  onClick={() => setField('mode', 'image')}
                  className={layout.mode === 'image' ? 'px-2 py-1 bg-primary text-primary-foreground' : 'px-2 py-1 bg-background hover:bg-muted'}>
                  Floor plan
                </button>
              </div>
              {/* W / H / Scale — inline label + input on one line so the
                  three controls only consume one row's worth of height. */}
              <label className="flex items-center gap-1">
                <span className="text-muted-foreground">W</span>
                <input type="number" min={2} max={40} value={layout.widthM}
                  onChange={(e) => setFloorSize(Math.max(2, Math.min(40, Number(e.target.value || 8))), layout.heightM)}
                  className="h-7 w-14 rounded border border-input bg-background px-1.5 text-xs" />
                <span className="text-muted-foreground">m</span>
              </label>
              <label className="flex items-center gap-1">
                <span className="text-muted-foreground">H</span>
                <input type="number" min={2} max={40} value={layout.heightM}
                  onChange={(e) => setFloorSize(layout.widthM, Math.max(2, Math.min(40, Number(e.target.value || 6))))}
                  className="h-7 w-14 rounded border border-input bg-background px-1.5 text-xs" />
                <span className="text-muted-foreground">m</span>
              </label>
              <label className="flex items-center gap-1">
                <span className="text-muted-foreground">Scale</span>
                <input type="number" min={20} max={120} value={layout.pxPerMeter}
                  onChange={(e) => commit({ ...layout, pxPerMeter: Math.max(20, Math.min(120, Number(e.target.value || 60))) })}
                  className="h-7 w-14 rounded border border-input bg-background px-1.5 text-xs" />
                <span className="text-muted-foreground">px/m</span>
              </label>
              <Button type="button" size="sm" variant={layout.snapPx ? 'default' : 'outline'}
                onClick={() => setField('snapPx', layout.snapPx ? 0 : 20)}
                className="h-7 px-2 text-xs">
                <Grid3x3 className="h-3 w-3 mr-1" /> Snap
              </Button>
              {layout.mode === 'image' && (
                <>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
                  <Button type="button" size="sm" variant="outline"
                    onClick={() => fileRef.current?.click()}
                    className="h-7 px-2 text-xs">
                    <Upload className="h-3 w-3 mr-1" /> {layout.imageUrl ? 'Replace' : 'Upload plan'}
                  </Button>
                  {layout.imageUrl && (
                    <>
                      <Button type="button" size="sm" variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => commit({ ...layout, imageUrl: null })}>Remove</Button>
                      <Button type="button" size="sm" variant="outline"
                        onClick={rerunScan} disabled={scanning}
                        className="h-7 px-2 text-xs"
                        title="Run furniture auto-detect again">
                        {scanning
                          ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          : <Wand2 className="h-3 w-3 mr-1" />}
                        Detect
                      </Button>
                      {scanHasResults && (
                        <Button type="button" size="sm" variant="ghost"
                          onClick={undoLastScan}
                          className="h-7 px-2 text-xs"
                          title="Remove the objects added by the last auto-detect">
                          <Undo2 className="h-3 w-3 mr-1" /> Undo scan
                        </Button>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
            )}

            {/* ===== Body: palette on the left, canvas on the right =====
                Flex (not grid) so the canvas takes the full remaining width
                regardless of whether the palette is rendered. With grid the
                canvas was being placed in column 1 (220 px) in image mode,
                which made it look tiny.
            */}
            <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-2 p-2 overflow-hidden">
              {/* Palette - fixed-width sidebar. Visible in BOTH modes:
                  admins want to drop chairs / tables / rooms onto an
                  uploaded floor plan just as much as onto a blank grid. */}
              <div className="border rounded-md p-3 bg-muted/30 overflow-y-auto md:w-[220px] md:shrink-0">
                  <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Furniture</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {PALETTE.map((t) => {
                      const Icon = PRESETS[t].icon;
                      return (
                        <button type="button" key={t}
                          onClick={() => addObject(t)}
                          className="flex flex-col items-center gap-1 p-2 rounded border bg-background hover:bg-muted text-[11px]">
                          <Icon className="h-4 w-4 text-foreground" />
                          <span className="capitalize">{t.replace('_', ' ')}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Default sizes for repeat drops. Metres so the input
                      lines up with the rest of the canvas units. Tables
                      are intentionally left out - too varied to share a
                      default. */}
                  <div className="mt-3 pt-2 border-t space-y-2 text-[11px]">
                    <div className="font-semibold text-muted-foreground uppercase tracking-wide">Default size</div>
                    {(['chair', 'wall'] as const).map((kind) => {
                      const ds = defaultSizes[kind];
                      const wM = (ds.w / layout.pxPerMeter).toFixed(2);
                      const hM = (ds.h / layout.pxPerMeter).toFixed(2);
                      return (
                        <div key={kind}>
                          <div className="capitalize text-foreground mb-0.5">{kind}</div>
                          <div className="flex items-center gap-1">
                            <input
                              type="number" min={0.1} max={10} step={0.1}
                              value={wM}
                              onChange={(e) => {
                                const m = Math.max(0.1, Math.min(10, Number(e.target.value || 0)));
                                setDefaultSizes((s) => ({ ...s, [kind]: { ...s[kind], w: m * layout.pxPerMeter } }));
                              }}
                              className="h-7 w-full rounded border border-input bg-background px-1 text-[11px]" />
                            <span className="text-muted-foreground">×</span>
                            <input
                              type="number" min={0.1} max={10} step={0.1}
                              value={hM}
                              onChange={(e) => {
                                const m = Math.max(0.1, Math.min(10, Number(e.target.value || 0)));
                                setDefaultSizes((s) => ({ ...s, [kind]: { ...s[kind], h: m * layout.pxPerMeter } }));
                              }}
                              className="h-7 w-full rounded border border-input bg-background px-1 text-[11px]" />
                            <span className="text-muted-foreground">m</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* <div className="mt-3 text-[11px] text-muted-foreground leading-snug">
                    <div className="flex items-center gap-1 mb-1"><MousePointer2 className="h-3 w-3" /> Drag to move</div>
                    <div className="flex items-center gap-1 mb-1"><RotateCw className="h-3 w-3" /> <kbd className="px-1 bg-card border rounded">R</kbd> rotate 15°</div>
                    <div className="flex items-center gap-1 mb-1"><Square className="h-3 w-3" /> handles to resize</div>
                    <div className="flex items-center gap-1"><Trash2 className="h-3 w-3" /> <kbd className="px-1 bg-card border rounded">Del</kbd> remove</div>
                  </div> */}
                  {selected && (
                    <div className="mt-3 pt-2 border-t text-[11px] space-y-1">
                      <div className="font-semibold text-muted-foreground uppercase tracking-wide">Selected</div>
                      <div className="text-foreground">{selected.label || selected.id}</div>
                      <div className="text-muted-foreground">
                        {(selected.w || 0).toFixed(0)} × {(selected.h || 0).toFixed(0)} px
                        <br />
                        {((selected.w || 0) / layout.pxPerMeter).toFixed(1)} × {((selected.h || 0) / layout.pxPerMeter).toFixed(1)} m
                      </div>
                      {selected.perimeter && (
                        <div className="text-amber-700">Perimeter wall — auto-reframed on size change.</div>
                      )}
                      {/* VIP toggle - chairs only. Hides the chair from
                          the booker-side picker so it stays reserved. */}
                      {selected.type === 'chair' && (
                        <button
                          type="button"
                          onClick={() => {
                            const next = !selected.isVip;
                            commit({
                              ...layout,
                              objects: layout.objects.map((o) =>
                                o.id === selected.id ? { ...o, isVip: next } : o
                              ),
                            });
                          }}
                          className={
                            'mt-2 w-full inline-flex items-center justify-center gap-1 rounded border text-[11px] py-1 transition-colors ' +
                            (selected.isVip
                              ? 'bg-amber-100 border-amber-400 text-amber-900 hover:bg-amber-200'
                              : 'bg-background border-input text-muted-foreground hover:bg-muted')
                          }
                        >
                          {selected.isVip ? '★ VIP (hidden from bookers)' : 'Mark as VIP'}
                        </button>
                      )}
                    </div>
                  )}
                </div>

              {/* Canvas - centred inside a scrollable, checker-tinted panel.
                  The SVG keeps its native W×H coordinate system via viewBox
                  but is rendered at width:100% so it fills the available
                  space - giving the admin the biggest canvas possible. */}
              {/*
                Canvas wrapper. Two width-related rules apply:
                  - `flex` is dropped so the SVG owns the full row width
                    instead of being centred (which left padding on each
                    side once aspect-ratio meet kicked in).
                  - The wrapper scrolls vertically when the canvas grows
                    taller than the modal body, so we never have to shrink
                    width to keep the whole thing visible.
              */}
              <div className="flex-1 min-w-0 overflow-auto bg-muted/20 rounded-md border p-2 min-h-0 relative">
                {/* Auto-detect summary banner. Visible after a scan
                    finishes — success ("added 12 chairs"), nothing-found,
                    or error ("service down, place manually"). Click X to
                    dismiss; doesn't block the canvas. */}
                {scanSummary && !scanning && (
                  <div className="absolute top-4 left-4 right-4 z-10 flex items-start gap-2 rounded-md border bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow-sm">
                    <Wand2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span className="flex-1">{scanSummary}</span>
                    <button type="button" className="text-amber-700 hover:text-amber-900"
                      onClick={() => setScanSummary(null)}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                {/* Loading overlay while OpenCV runs. Lays over the canvas
                    so the admin can see what they uploaded but can't
                    accidentally drop chairs while detection is in flight. */}
                {scanning && (
                  <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-md bg-background/80 backdrop-blur-sm">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    <div className="text-sm font-medium">Detecting furniture in your plan…</div>
                    <div className="text-xs text-muted-foreground">Usually 1–5 seconds</div>
                  </div>
                )}
                <svg
                  ref={svgRef}
                  viewBox={`0 0 ${W} ${H}`}
                  preserveAspectRatio="xMidYMid meet"
                  // width: 100% makes the SVG element span the wrapper.
                  // height: auto keeps the viewBox ratio so geometry is
                  // never distorted (the floor *image* is what gets
                  // stretched, see <image> below).
                  style={{ width: '100%', height: 'auto', userSelect: 'none', display: 'block' }}
                  className="bg-card border rounded shadow-sm"
                  onClick={(e) => { if (e.target === svgRef.current) setSelectedId(null); }}
                >
              <defs>
                <pattern id="wood-grain" patternUnits="userSpaceOnUse" width="60" height="22" patternTransform="rotate(2)">
                  {/* Warm tan plank base */}
                  <rect width="60" height="22" fill="#c08a5a" />
                  {/* Long grain streaks at varying widths + opacities. */}
                  <path d="M0 4 Q15 3 30 4 T60 4" stroke="#8b5a2b" strokeWidth="0.7" fill="none" opacity="0.5" />
                  <path d="M0 9 Q20 11 40 9 T60 10" stroke="#6b3a0e" strokeWidth="1.3" fill="none" opacity="0.45" />
                  <path d="M0 14 Q18 13 36 14 T60 13" stroke="#8b5a2b" strokeWidth="0.5" fill="none" opacity="0.5" />
                  <path d="M0 18 Q22 19 44 18 T60 19" stroke="#5b2e0a" strokeWidth="0.9" fill="none" opacity="0.4" />
                  {/* Subtle highlight for the lighter wood band */}
                  <line x1="0" y1="6.5" x2="60" y2="6.5" stroke="#d9a877" strokeWidth="0.4" opacity="0.5" />
                </pattern>
                <linearGradient id="seat-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#fde68a" />
                  <stop offset="100%" stopColor="#fcd34d" />
                </linearGradient>
                <linearGradient id="wall-grad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%"   stopColor="#64748b" />
                  <stop offset="100%" stopColor="#334155" />
                </linearGradient>
              </defs>

              {/* background: image or grid.
                  Floor image stretches to fully fill the canvas (W×H),
                  even if its native aspect ratio differs - admin asked
                  for "stretch the image if needed" rather than letterbox
                  bars or cropped corners. */}
              {layout.mode === 'image' && layout.imageUrl && (
                <image href={layout.imageUrl} x={0} y={0} width={W} height={H} preserveAspectRatio="none" />
              )}
              {layout.mode === 'blank' && (
                <>
                  {Array.from({ length: Math.ceil(W / 40) + 1 }, (_, i) => (
                    <line key={'v' + i} x1={i * 40} y1={0} x2={i * 40} y2={H} stroke="rgba(15,23,42,0.06)" strokeWidth={1} />
                  ))}
                  {Array.from({ length: Math.ceil(H / 40) + 1 }, (_, i) => (
                    <line key={'h' + i} x1={0} y1={i * 40} x2={W} y2={i * 40} stroke="rgba(15,23,42,0.06)" strokeWidth={1} />
                  ))}
                </>
              )}

              {/* objects - walls first so chairs/tables stack above them */}
              {layout.objects
                .slice()
                .sort((a, b) => zOrder(a) - zOrder(b))
                .map((o) => (
                  <ObjectTile
                    key={o.id}
                    o={o}
                    selected={o.id === selectedId}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setSelectedId(o.id);
                      const p = svgPoint(e.clientX, e.clientY);
                      if (!p) return;
                      setDrag({ kind: 'move', id: o.id, dx: p.x - o.x, dy: p.y - o.y });
                    }}
                    onHandleDown={(handle, e) => {
                      e.stopPropagation();
                      setSelectedId(o.id);
                      setDrag({
                        kind: 'resize',
                        id: o.id,
                        handle,
                        ox: o.x, oy: o.y,
                        ow: o.w || 60, oh: o.h || 60,
                      });
                    }}
                  />
              ))}

              {/* scale ruler (bottom-left, sits above bottom wall) */}
              <g>
                <rect x={8} y={H - 22 - WALL_THICK} width={layout.pxPerMeter} height={4} fill="#0f172a" opacity={0.8} />
                <text x={8 + layout.pxPerMeter + 6} y={H - 16 - WALL_THICK} fontSize={10} fill="#0f172a" opacity={0.7}>1 m</text>
              </g>
            </svg>

                {layout.mode === 'image' && !layout.imageUrl && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-xs text-muted-foreground">
                    Upload a floor plan above, then drop chairs onto it.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Walls render behind tables/chairs.
function zOrder(o: LayoutObject): number {
  if (o.type === 'wall')  return 0;
  if (o.type === 'plant') return 1;
  if (o.type === 'door')  return 2;
  if (o.type === 'table_round' || o.type === 'table_rect') return 3;
  if (o.type === 'chair') return 4;
  return 5;
}

function ObjectTile({ o, selected, onMouseDown, onHandleDown }: {
  o: LayoutObject;
  selected: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onHandleDown: (h: ResizeHandle, e: React.MouseEvent) => void;
}) {
  const p = PRESETS[o.type];
  const w  = o.w ?? p.w;
  const h  = o.h ?? p.h;
  const rot = o.rot || 0;
  const cx = o.x + w / 2;
  const cy = o.y + h / 2;

  return (
    <g
      transform={`rotate(${rot} ${cx} ${cy})`}
      style={{ cursor: 'grab' }}
      onMouseDown={onMouseDown}
    >
      {renderShape(o, w, h, selected)}

      {/* Resize handles - shown on any selected object. Chairs are now
          resizable too (previously locked) so admin can size individual
          seats to match a real-world layout. */}
      {selected && renderHandles(o.x, o.y, w, h, onHandleDown)}
    </g>
  );
}

function renderShape(o: LayoutObject, w: number, h: number, selected: boolean) {
  const p = PRESETS[o.type];
  const stroke = selected ? '#2563eb' : p.stroke;
  const sw     = selected ? 2.5 : 1.5;

  switch (o.type) {
    case 'chair': {
      // Seat + tall backrest on one side - reads as a chair from afar.
      // VIP chairs swap to a purple palette with a centred gold star so
      // admin can spot reserved seats at a glance (these are hidden from
      // the booker entirely).
      const seat        = o.isVip ? '#e9d5ff'              : 'url(#seat-grad)';
      const chairStroke = o.isVip ? '#7e22ce'              : stroke;
      const backFill    = o.isVip ? '#7e22ce'              : p.stroke;
      const labelFill   = o.isVip ? '#4c1d95'              : '#7c2d12';
      const back = 4;
      // Centre the gold star inside the seat. Size scales with chair so
      // it stays readable on small/large chairs.
      const starCx = o.x + w / 2;
      const starCy = o.y + back + (h - back) / 2 - 2;
      const starSize = Math.max(11, Math.min(22, Math.min(w, h) - 16));
      return (
        <>
          {/* backrest */}
          <rect x={o.x} y={o.y} width={w} height={back}
            rx={2} ry={2} fill={backFill} opacity={0.8} />
          {/* seat */}
          <rect x={o.x + 1} y={o.y + back} width={w - 2} height={h - back - 1}
            rx={6} ry={6} fill={seat} stroke={chairStroke} strokeWidth={o.isVip ? 2 : sw} />
          {/* For VIP: gold star centre. For regular: chair id label centre. */}
          {o.isVip ? (
            <text
              x={starCx} y={starCy + starSize / 3}
              textAnchor="middle"
              fontSize={starSize}
              fill="#facc15"
              stroke="#a16207"
              strokeWidth={0.6}
              fontWeight={800}
              pointerEvents="none">★</text>
          ) : (
            <text x={o.x + w / 2} y={o.y + h / 2 + 4}
              textAnchor="middle"
              fontSize={10}
              fontWeight={600}
              fill={labelFill}
              pointerEvents="none">
              {o.label || o.id}
            </text>
          )}
        </>
      );
    }
    case 'table_round': {
      const r = Math.min(w, h) / 2;
      const cx = o.x + w / 2;
      const cy = o.y + h / 2;
      return (
        <>
          <ellipse cx={cx + 2} cy={cy + 3} rx={r} ry={r * 0.95} fill="#0f172a" opacity={0.08} />
          <circle cx={cx} cy={cy} r={r} fill="url(#wood-grain)" stroke={stroke} strokeWidth={sw} />
          <circle cx={cx} cy={cy} r={Math.max(2, r - 6)} fill="none" stroke={p.stroke} strokeOpacity={0.25} strokeWidth={1} />
        </>
      );
    }
    case 'table_rect': {
      return (
        <>
          <rect x={o.x + 2} y={o.y + 3} width={w} height={h} rx={8} ry={8} fill="#0f172a" opacity={0.08} />
          <rect x={o.x} y={o.y} width={w} height={h}
            rx={8} ry={8} fill="url(#wood-grain)" stroke={stroke} strokeWidth={sw} />
          <line x1={o.x + w / 2} y1={o.y + 6} x2={o.x + w / 2} y2={o.y + h - 6}
            stroke={p.stroke} strokeOpacity={0.18} strokeWidth={1} />
        </>
      );
    }
    case 'wall': {
      const isPerim = !!o.perimeter;
      return (
        <rect x={o.x} y={o.y} width={w} height={h}
          rx={2} ry={2}
          fill={isPerim ? 'url(#wall-grad)' : p.fill}
          stroke={stroke} strokeWidth={sw}
        />
      );
    }
    case 'door': {
      const d = `M ${o.x} ${o.y + h} A ${w} ${h} 0 0 1 ${o.x + w} ${o.y}`;
      return (
        <>
          <rect x={o.x} y={o.y} width={w} height={h}
            rx={3} ry={3}
            fill={p.fill} stroke={stroke} strokeWidth={sw} opacity={0.35} />
          <path d={d} fill="none" stroke={p.stroke} strokeWidth={1.5} strokeDasharray="3 3" />
          <line x1={o.x} y1={o.y} x2={o.x} y2={o.y + h} stroke={p.stroke} strokeWidth={2.5} />
        </>
      );
    }
    case 'plant': {
      const cx = o.x + w / 2;
      const cy = o.y + h / 2;
      const r = Math.min(w, h) / 2;
      return (
        <>
          <rect x={cx - r * 0.55} y={cy + r * 0.35} width={r * 1.1} height={r * 0.55}
            rx={2} ry={2} fill="#9a3412" stroke={stroke} strokeWidth={sw} />
          <circle cx={cx}            cy={cy}            r={r * 0.55} fill="#22c55e" stroke="#15803d" strokeWidth={1} />
          <circle cx={cx - r * 0.35} cy={cy + r * 0.15} r={r * 0.4}  fill="#16a34a" stroke="#15803d" strokeWidth={1} />
          <circle cx={cx + r * 0.35} cy={cy + r * 0.1}  r={r * 0.4}  fill="#16a34a" stroke="#15803d" strokeWidth={1} />
        </>
      );
    }
    default: {
      return (
        <rect x={o.x} y={o.y} width={w} height={h}
          rx={6} ry={6}
          fill={p.fill} stroke={stroke} strokeWidth={sw} />
      );
    }
  }
}

function renderHandles(x: number, y: number, w: number, h: number, onDown: (h: ResizeHandle, e: React.MouseEvent) => void) {
  // Slimmer + more transparent handles: 5 px squares at 60% opacity so they
  // sit lightly on top of the object instead of dominating the silhouette.
  // We keep a wider invisible hit-target (visualSize * 2.4) under each so
  // the handles stay easy to grab even though they look tiny.
  const s = 5;
  const half = s / 2;
  const hitS = 12;            // invisible click area
  const hitHalf = hitS / 2;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const handles: Array<{ k: ResizeHandle; hx: number; hy: number; cursor: string }> = [
    { k: 'nw', hx: x,         hy: y,         cursor: 'nwse-resize' },
    { k: 'n',  hx: cx,        hy: y,         cursor: 'ns-resize'   },
    { k: 'ne', hx: x + w,     hy: y,         cursor: 'nesw-resize' },
    { k: 'e',  hx: x + w,     hy: cy,        cursor: 'ew-resize'   },
    { k: 'se', hx: x + w,     hy: y + h,     cursor: 'nwse-resize' },
    { k: 's',  hx: cx,        hy: y + h,     cursor: 'ns-resize'   },
    { k: 'sw', hx: x,         hy: y + h,     cursor: 'nesw-resize' },
    { k: 'w',  hx: x,         hy: cy,        cursor: 'ew-resize'   },
  ];
  return (
    <g opacity={0.6}>
      <rect x={x - 3} y={y - 3} width={w + 6} height={h + 6}
        fill="none" stroke="#2563eb" strokeOpacity={0.5}
        strokeDasharray="4 3" strokeWidth={1} pointerEvents="none" />
      {handles.map((h) => (
        <g key={h.k}>
          {/* Visible (small + translucent) handle dot. */}
          <rect
            x={h.hx - half} y={h.hy - half} width={s} height={s}
            rx={1} ry={1}
            fill="#ffffff" stroke="#2563eb" strokeWidth={1}
            pointerEvents="none" />
          {/* Invisible bigger hit-target on top, captures the mouse. */}
          <rect
            x={h.hx - hitHalf} y={h.hy - hitHalf} width={hitS} height={hitS}
            fill="transparent"
            style={{ cursor: h.cursor }}
            onMouseDown={(e) => onDown(h.k, e)} />
        </g>
      ))}
    </g>
  );
}

// void Sofa;
//  o.x + r;
//       const cyy = o.y + r;
//       return (
//         <circle cx={cx} cy={cyy} r={r}
//           fill="url(#wood-grain)" stroke={stroke} strokeWidth={sw} />
//       );
//     }
//     case 'table_rect': {
//       return (
//         <rect x={o.x} y={o.y} width={w} height={h}
//           rx={4} ry={4}
//           fill="url(#wood-grain)" stroke={stroke} strokeWidth={sw} />
//       );
//     }
//     case 'wall': {
//       return (
//         <rect x={o.x} y={o.y} width={w} height={h}
//           rx={1.5} ry={1.5}
//           fill={p.fill} stroke={stroke} strokeWidth={sw} />
//       );
//     }
//     case 'door': {
//       const d = `M ${o.x} ${o.y + h} A ${w} ${h} 0 0 1 ${o.x + w} ${o.y}`;
//       return (
//         <>
//           <rect x={o.x} y={o.y} width={w} height={h}
//             rx={3} ry={3}
//             fill={p.fill} stroke={stroke} strokeWidth={sw} opacity={0.35} />
//           <path d={d} fill="none" stroke={p.stroke} strokeWidth={1.5} strokeDasharray="3 3" />
//           <line x1={o.x} y1={o.y} x2={o.x} y2={o.y + h} stroke={p.stroke} strokeWidth={2.5} />
//         </>
//       );
//     }
//     case 'plant': {
//       const ccx = o.x + w / 2;
//       const ccy = o.y + h / 2;
//       const rad = Math.min(w, h) / 2 - 2;
//       return (
//         <>
//           <circle cx={ccx} cy={ccy + rad * 0.25} r={rad * 0.7} fill={p.fill} stroke={stroke} strokeWidth={sw} />
//           <ellipse cx={ccx - rad * 0.4} cy={ccy - rad * 0.3} rx={rad * 0.45} ry={rad * 0.25}
//             fill="#86efac" stroke={p.stroke} strokeWidth={1} transform={`rotate(-30 ${ccx - rad * 0.4} ${ccy - rad * 0.3})`} />
//           <ellipse cx={ccx + rad * 0.4} cy={ccy - rad * 0.3} rx={rad * 0.45} ry={rad * 0.25}
//             fill="#86efac" stroke={p.stroke} strokeWidth={1} transform={`rotate(30 ${ccx + rad * 0.4} ${ccy - rad * 0.3})`} />
//         </>
//       );
//     }
//     case 'meeting_room': {
//       return (
//         <>
//           <rect x={o.x} y={o.y} width={w} height={h}
//             rx={4} ry={4}
//             fill={p.fill} stroke={stroke} strokeWidth={sw} />
//           {o.label && (
//             <text x={o.x + w / 2} y={o.y + h / 2}
//               textAnchor="middle" dominantBaseline="middle"
//               fontSize={Math.max(10, Math.min(w, h) / 4)}
//               fontWeight="600" fill={p.stroke}>
//               {o.label}
//             </text>
//           )}
//         </>
//       );
//     }
//     default: {
//       return (
//         <rect x={o.x} y={o.y} width={w} height={h}
//           rx={3} ry={3}
//           fill={p.fill} stroke={stroke} strokeWidth={sw} />
//       );
//     }
//   }
// }

// function renderHandles(x: number, y: number, w: number, h: number, onDown: (h: ResizeHandle, e: React.MouseEvent) => void) {
//   // Slimmer + more transparent handles: 5 px squares at 60% group opacity
//   // so they sit lightly on top of the object. A wider invisible hit-target
//   // keeps them easy to grab even though they look tiny.
//   const s = 5;
//   const half = s / 2;
//   const hitS = 12;
//   const hitHalf = hitS / 2;
//   const cx = x + w / 2;
//   const cy = y + h / 2;
//   const handles: Array<{ k: ResizeHandle; hx: number; hy: number; cursor: string }> = [
//     { k: 'nw', hx: x,         hy: y,         cursor: 'nwse-resize' },
//     { k: 'n',  hx: cx,        hy: y,         cursor: 'ns-resize'   },
//     { k: 'ne', hx: x + w,     hy: y,         cursor: 'nesw-resize' },
//     { k: 'e',  hx: x + w,     hy: cy,        cursor: 'ew-resize'   },
//     { k: 'se', hx: x + w,     hy: y + h,     cursor: 'nwse-resize' },
//     { k: 's',  hx: cx,        hy: y + h,     cursor: 'ns-resize'   },
//     { k: 'sw', hx: x,         hy: y + h,     cursor: 'nesw-resize' },
//     { k: 'w',  hx: x,         hy: cy,        cursor: 'ew-resize'   },
//   ];
//   return (
//     <g opacity={0.6}>
//       <rect x={x - 3} y={y - 3} width={w + 6} height={h + 6}
//         fill="none" stroke="#2563eb" strokeOpacity={0.5}
//         strokeDasharray="4 3" strokeWidth={1} pointerEvents="none" />
//       {handles.map((h) => (
//         <g key={h.k}>
//           <rect
//             x={h.hx - half} y={h.hy - half} width={s} height={s}
//             rx={1} ry={1}
//             fill="#ffffff" stroke="#2563eb" strokeWidth={1}
//             pointerEvents="none" />
//           <rect
//             x={h.hx - hitHalf} y={h.hy - hitHalf} width={hitS} height={hitS}
//             fill="transparent"
//             style={{ cursor: h.cursor }}
//             onMouseDown={(e) => onDown(h.k, e)} />
//         </g>
//       ))}
//     </g>
//   );
// }

// void Sofa;
// top, captures the mouse. */}
//           <rect
//             x={h.hx - hitHalf} y={h.hy - hitHalf} width={hitS} height={hitS}
//             fill="transparent"
//             style={{ cursor: h.cursor }}
//             onMouseDown={(e) => onDown(h.k, e)} />
//         </g>
//       ))}
//     </g>
//   );
// }

// void Sofa;
