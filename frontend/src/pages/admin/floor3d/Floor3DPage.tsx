// 3D Floor Studio — a dedicated three.js canvas for building floor plans in 3D.
//
// This is a starter shell — the scene, camera, lights and orbit controls are
// wired end-to-end, plus a small palette so an admin can drop primitives
// (walls, desks, tables, chairs) onto the grid. Click a mesh to select it,
// Delete key to remove. Save/Load stubs dump the scene state to JSON — real
// persistence (Save to facility.layout_json_3d) is a follow-up.
//
// Why a whole page instead of a modal? A canvas benefits from full viewport
// real-estate + persistent camera state, and this editor is a specialised
// tool separate from the main facility form flow.

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import {
  Box,
  Button,
  ButtonGroup,
  Chip,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import ArmchairIcon from '@mui/icons-material/Chair';
import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import LayersClearIcon from '@mui/icons-material/LayersClear';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import TableRestaurantIcon from '@mui/icons-material/TableRestaurant';
import ViewInArIcon from '@mui/icons-material/ViewInAr';
import ViewSidebarIcon from '@mui/icons-material/ViewSidebar';
import PageHeader from '@/components/PageHeader';

// The "kind" of primitive an admin can drop. Each maps to a mesh factory below.
type Primitive = 'wall' | 'desk' | 'table' | 'chair' | 'cube';

interface PaletteItem {
  key: Primitive;
  label: string;
  icon: React.ReactNode;
  colour: number;
}

const PALETTE: PaletteItem[] = [
  { key: 'wall',  label: 'Wall',  icon: <ViewSidebarIcon />,     colour: 0x94a3b8 },
  { key: 'desk',  label: 'Desk',  icon: <TableRestaurantIcon />, colour: 0x8b5cf6 },
  { key: 'table', label: 'Table', icon: <ViewInArIcon />,        colour: 0xf59e0b },
  { key: 'chair', label: 'Chair', icon: <ArmchairIcon />,        colour: 0x10b981 },
  { key: 'cube',  label: 'Cube',  icon: <ViewInArIcon />,        colour: 0x3b82f6 },
];

// Turn a primitive kind into a fresh Mesh with sensible dimensions (in metres).
function makeMesh(kind: Primitive, colour: number): THREE.Mesh {
  let geom: THREE.BufferGeometry;
  switch (kind) {
    case 'wall':  geom = new THREE.BoxGeometry(3, 2.5, 0.15); break;    // 3m long, 2.5m tall, 15cm thick
    case 'desk':  geom = new THREE.BoxGeometry(1.4, 0.75, 0.7); break;  // desk-height, standard depth
    case 'table': geom = new THREE.CylinderGeometry(0.6, 0.6, 0.75, 24); break; // round table
    case 'chair': geom = new THREE.BoxGeometry(0.5, 0.9, 0.5); break;
    default:      geom = new THREE.BoxGeometry(1, 1, 1);
  }
  const mat = new THREE.MeshStandardMaterial({ color: colour, metalness: 0.15, roughness: 0.7 });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // Sit on the grid: raise by half-height so the base touches y=0.
  const box = new THREE.Box3().setFromObject(mesh);
  const size = box.getSize(new THREE.Vector3());
  mesh.position.y = size.y / 2;
  // Tag it so we can distinguish user objects from decorations (grid, lights).
  mesh.userData.primitive = kind;
  return mesh;
}

export default function Floor3DPage() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef     = useRef<THREE.Scene | null>(null);
  const cameraRef    = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef  = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef  = useRef<OrbitControls | null>(null);
  const transformRef = useRef<TransformControls | null>(null);
  const rafRef       = useRef<number | null>(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const mouseRef     = useRef(new THREE.Vector2());
  // We keep a live list of user-placed meshes so we can iterate + save them
  // without walking the whole scene graph.
  const objectsRef = useRef<THREE.Mesh[]>([]);
  const selectedRef = useRef<THREE.Mesh | null>(null);
  // Distinguishes a click-release-in-place (select) from a click-after-drag
  // (don't reselect). Set on mousedown, wiped if the pointer moves.
  const clickStartRef = useRef<{ x: number; y: number } | null>(null);

  const [count, setCount] = useState(0);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [transformMode, setTransformMode] = useState<'translate' | 'rotate' | 'scale'>('translate');

  // Mount three.js once. Every effect cleanup MUST release GPU resources or
  // Chrome will eventually kill the tab with "too many WebGL contexts".
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf8fafc); // soft slate-50 background
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / container.clientHeight,
      0.1, 1000
    );
    camera.position.set(10, 10, 10);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Ambient light lifts the shadowed sides so the whole scene stays readable;
    // the directional light provides shape + shadow.
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(12, 18, 8);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.left = -20; dir.shadow.camera.right = 20;
    dir.shadow.camera.top = 20;   dir.shadow.camera.bottom = -20;
    scene.add(dir);

    // Grid + ground plane. Ground is very slightly below the grid so shadows
    // land on it without z-fighting the grid lines.
    const grid = new THREE.GridHelper(40, 40, 0xcbd5e1, 0xe2e8f0);
    scene.add(grid);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.ShadowMaterial({ opacity: 0.25 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // OrbitControls: drag to rotate, right-click drag to pan, wheel to zoom.
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0, 0);
    controls.maxPolarAngle = Math.PI / 2 - 0.05; // keep camera above the floor
    controlsRef.current = controls;

    // TransformControls: attach-to-mesh gizmo for move / rotate / scale.
    // Not added to the scene until a mesh is selected, but the helper
    // (the visible arrows / rings) IS added so we can just call attach().
    const transform = new TransformControls(camera, renderer.domElement);
    transform.setSize(0.8);
    transform.setTranslationSnap(0.25);  // 25 cm grid — feels natural on a floor plan
    transform.setRotationSnap(THREE.MathUtils.degToRad(15));
    // While the user is dragging the gizmo we must disable orbit so the
    // two don't fight over the same mouse input.
    transform.addEventListener('dragging-changed', function (e) {
      controls.enabled = !e.value;
    });
    scene.add(transform.getHelper ? transform.getHelper() : (transform as unknown as THREE.Object3D));
    transformRef.current = transform;

    // Click-to-select — with a small hysteresis so an orbit-drag doesn't
    // count as a "click" and lose your selection. We record the pointer on
    // mousedown, then on mouseup only treat it as a click if the pointer
    // barely moved.
    function onPointerDown(e: PointerEvent) {
      // Ignore drags on the transform gizmo itself.
      if ((e.target as HTMLElement) !== renderer.domElement) return;
      clickStartRef.current = { x: e.clientX, y: e.clientY };
    }
    function onPointerUp(e: PointerEvent) {
      const start = clickStartRef.current;
      clickStartRef.current = null;
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (dx * dx + dy * dy > 25) return;   // moved >5px — treat as orbit
      selectAtPointer(e.clientX, e.clientY);
    }
    function selectAtPointer(cx: number, cy: number) {
      const rect = renderer.domElement.getBoundingClientRect();
      mouseRef.current.x = ((cx - rect.left) / rect.width) * 2 - 1;
      mouseRef.current.y = -((cy - rect.top) / rect.height) * 2 + 1;
      raycasterRef.current.setFromCamera(mouseRef.current, camera);
      const hits = raycasterRef.current.intersectObjects(objectsRef.current, false);
      // Reset all materials to their base emissive first.
      objectsRef.current.forEach((m) => {
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.emissive.setHex(0x000000);
      });
      if (hits.length > 0) {
        const picked = hits[0].object as THREE.Mesh;
        const mat = picked.material as THREE.MeshStandardMaterial;
        mat.emissive.setHex(0x1e40af); // blue-800 highlight
        selectedRef.current = picked;
        setSelectedLabel(String(picked.userData.primitive || 'object'));
        transform.attach(picked);
      } else {
        selectedRef.current = null;
        setSelectedLabel(null);
        transform.detach();
      }
    }
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    // Keyboard shortcuts:
    //   Delete / Backspace  → remove current selection
    //   G / T               → translate mode
    //   R                   → rotate mode
    //   S                   → scale mode
    //   Esc                 → deselect
    // Ignored while the user is typing in an input.
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!selectedRef.current) return;
        const m = selectedRef.current;
        transform.detach();
        scene.remove(m);
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
        objectsRef.current = objectsRef.current.filter((o) => o !== m);
        selectedRef.current = null;
        setSelectedLabel(null);
        setCount(objectsRef.current.length);
        return;
      }
      if (e.key === 'Escape') {
        transform.detach();
        objectsRef.current.forEach((m) => {
          const mat = m.material as THREE.MeshStandardMaterial;
          mat.emissive.setHex(0x000000);
        });
        selectedRef.current = null;
        setSelectedLabel(null);
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'g' || k === 't') { transform.setMode('translate'); setTransformMode('translate'); }
      else if (k === 'r')          { transform.setMode('rotate');    setTransformMode('rotate'); }
      else if (k === 's')          { transform.setMode('scale');     setTransformMode('scale'); }
    }
    window.addEventListener('keydown', onKeyDown);

    // Window resize: keep the canvas filling its container.
    function onResize() {
      if (!containerRef.current || !renderer || !camera) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    window.addEventListener('resize', onResize);

    // Render loop.
    function loop() {
      controls.update();
      renderer.render(scene, camera);
      rafRef.current = requestAnimationFrame(loop);
    }
    loop();

    // Cleanup on unmount — critical for WebGL.
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeyDown);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      transform.detach();
      transform.dispose();
      transformRef.current = null;
      controls.dispose();
      renderer.dispose();
      objectsRef.current.forEach((m) => {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      });
      objectsRef.current = [];
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }, []);

  // --- Toolbar actions --------------------------------------------------

  function addPrimitive(item: PaletteItem) {
    const scene = sceneRef.current;
    if (!scene) return;
    const mesh = makeMesh(item.key, item.colour);
    // Spawn near origin with a small jitter so newly-added items don't stack
    // exactly on the previous one.
    mesh.position.x = (Math.random() - 0.5) * 4;
    mesh.position.z = (Math.random() - 0.5) * 4;
    scene.add(mesh);
    objectsRef.current.push(mesh);
    setCount(objectsRef.current.length);
  }

  function clearAll() {
    const scene = sceneRef.current;
    if (!scene) return;
    // Detach the gizmo first, otherwise TransformControls holds a reference
    // to a mesh we're about to dispose.
    transformRef.current?.detach();
    for (const m of objectsRef.current) {
      scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    objectsRef.current = [];
    selectedRef.current = null;
    setSelectedLabel(null);
    setCount(0);
  }

  function setMode(mode: 'translate' | 'rotate' | 'scale') {
    if (!transformRef.current) return;
    transformRef.current.setMode(mode);
    setTransformMode(mode);
  }

  function resetCamera() {
    const cam = cameraRef.current;
    const ctl = controlsRef.current;
    if (!cam || !ctl) return;
    cam.position.set(10, 10, 10);
    ctl.target.set(0, 0, 0);
    ctl.update();
  }

  // Dump the scene to JSON — this is the persistence hook. For now we just
  // trigger a download of the file so an admin can save + import later.
  // Real save (POST to /api/facilities/:id/layout-3d) is a follow-up.
  function saveScene() {
    const payload = {
      version: 1,
      generatedAt: new Date().toISOString(),
      objects: objectsRef.current.map((m) => ({
        kind: m.userData.primitive,
        position: { x: m.position.x, y: m.position.y, z: m.position.z },
        rotation: { x: m.rotation.x, y: m.rotation.y, z: m.rotation.z },
        scale:    { x: m.scale.x,    y: m.scale.y,    z: m.scale.z },
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `floor-3d-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Box>
      <PageHeader
        title="3D Floor Studio"
        subtitle="Click to select • drag the gizmo to move (G/T), rotate (R) or scale (S) • Delete to remove • Esc to deselect"
      >
        <Chip label={`${count} object${count === 1 ? '' : 's'}`} size="small" />
        {selectedLabel && <Chip label={`Selected: ${selectedLabel}`} color="primary" size="small" />}
        {selectedLabel && <Chip label={`Mode: ${transformMode}`} size="small" variant="outlined" />}
      </PageHeader>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        {/* ---- Palette ---- */}
        <Paper variant="outlined" sx={{ p: 2, minWidth: 220 }}>
          <Typography variant="subtitle2" gutterBottom>Palette</Typography>
          <Stack spacing={1}>
            {PALETTE.map((item) => (
              <Button
                key={item.key}
                variant="outlined"
                size="small"
                startIcon={item.icon}
                onClick={() => addPrimitive(item)}
                sx={{ justifyContent: 'flex-start' }}
              >
                Add {item.label}
              </Button>
            ))}
          </Stack>

          <Typography variant="subtitle2" sx={{ mt: 3 }} gutterBottom>Transform</Typography>
          <ButtonGroup fullWidth size="small">
            <Button
              variant={transformMode === 'translate' ? 'contained' : 'outlined'}
              onClick={() => setMode('translate')}
            >Move</Button>
            <Button
              variant={transformMode === 'rotate' ? 'contained' : 'outlined'}
              onClick={() => setMode('rotate')}
            >Rotate</Button>
            <Button
              variant={transformMode === 'scale' ? 'contained' : 'outlined'}
              onClick={() => setMode('scale')}
            >Scale</Button>
          </ButtonGroup>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            Shortcuts: G/T · R · S
          </Typography>

          <Typography variant="subtitle2" sx={{ mt: 3 }} gutterBottom>Actions</Typography>
          <ButtonGroup orientation="vertical" fullWidth>
            <Button startIcon={<RestartAltIcon />} onClick={resetCamera}>Reset camera</Button>
            <Button startIcon={<LayersClearIcon />} onClick={clearAll} color="warning">Clear scene</Button>
            <Button startIcon={<DownloadIcon />} onClick={saveScene}>Export JSON</Button>
          </ButtonGroup>

          {selectedRef.current && (
            <Tooltip title="Delete (or press Delete key)">
              <IconButton
                color="error"
                size="small"
                sx={{ mt: 2 }}
                onClick={() => {
                  // Reuse the keydown path so cleanup is identical.
                  const evt = new KeyboardEvent('keydown', { key: 'Delete' });
                  window.dispatchEvent(evt);
                }}
              >
                <DeleteIcon />
              </IconButton>
            </Tooltip>
          )}

          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
            Tip: click an object to select it, drag the gizmo to move / rotate / scale, press Delete to remove.
          </Typography>
        </Paper>

        {/* ---- Canvas ---- */}
        <Paper
          variant="outlined"
          sx={{
            flex: 1,
            height: 'calc(100vh - 220px)',
            minHeight: 400,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
        </Paper>
      </Stack>
    </Box>
  );
}
