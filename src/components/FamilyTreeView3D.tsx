import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { Html, Line, OrbitControls, RoundedBox } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { computeLayout, NODE_HEIGHT, NODE_WIDTH } from '../layout/computeLayout';
import type { Person, PositionedPerson } from '../types';
import './FamilyTreeView3D.css';

interface Props {
  people: Person[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  focusedPersonName?: string | null;
  focusedCount?: number;
  onClearFocus?: () => void;
  onMovePerson?: (id: string, offsetX: number, offsetY: number) => void;
}

const DRAG_THRESHOLD_PX = 4;

// World-unit scale applied to the same pixel coordinates the 2D view uses, so
// left-right sibling order matches exactly between both views.
const SCALE = 0.02;
// How far each generation recedes into the screen — turns the layered 2D rows
// into a staircase you can only fully read by orbiting the camera, which is
// the whole point of a 3D view instead of just tilting the flat one.
const DEPTH_STEP = 3.2;
const CARD_W = NODE_WIDTH * SCALE;
const CARD_H = NODE_HEIGHT * SCALE * 0.82;
const CARD_D = 0.22;

const FAMILY_COLORS = ['#4f6df5', '#d1487b', '#0f9d6e', '#c9701f', '#8a5cf5', '#0e9ab0', '#b8862a', '#c2453d'];

interface Palette {
  panel: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  male: string;
  female: string;
  other: string;
}

const LIGHT: Palette = { panel: '#ffffff', text: '#1f2430', muted: '#6b7280', border: '#e2e4e9', accent: '#4f6df5', male: '#6f9bd1', female: '#d17ba0', other: '#9b8fd1' };
const DARK: Palette = { panel: '#1c1f27', text: '#eceef2', muted: '#9aa1ae', border: '#2c3038', accent: '#4f6df5', male: '#6f9bd1', female: '#d17ba0', other: '#9b8fd1' };

function usePalette(): Palette {
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return dark ? DARK : LIGHT;
}

function personLabel(p: Person): string {
  const dates = [p.birthYear, p.deathYear].filter(Boolean);
  if (dates.length === 0) return '';
  if (p.deathYear) return `${p.birthYear ?? '?'} – ${p.deathYear}`;
  return `né(e) ${p.birthYear}`;
}

interface Placed {
  p: PositionedPerson;
  cx: number;
  topY: number;
  bottomY: number;
  z: number;
}

function place(p: PositionedPerson): Placed {
  const cx = (p.x + NODE_WIDTH / 2) * SCALE;
  const topY = -p.y * SCALE;
  const bottomY = -(p.y + NODE_HEIGHT) * SCALE;
  const z = p.generation * DEPTH_STEP;
  return { p, cx, topY, bottomY, z };
}

// Renders a person's base position nudged by a live drag delta (in the same
// pixel units as offsetX/offsetY), so the card and everything touching it
// stay visually attached to the cursor while dragging — same idea as the 2D
// view's renderPos, just producing a 3D Placed instead of a 2D point.
function placeWithDelta(p: PositionedPerson, dxPixels: number, dyPixels: number): Placed {
  return place({ ...p, x: p.x + dxPixels, y: p.y + dyPixels });
}

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

function computeBounds(placed: Placed[]): Bounds {
  if (placed.length === 0) return { minX: 0, maxX: 1, minY: -1, maxY: 0, minZ: 0, maxZ: 1 };
  return {
    minX: Math.min(...placed.map((p) => p.cx - CARD_W / 2)),
    maxX: Math.max(...placed.map((p) => p.cx + CARD_W / 2)),
    minY: Math.min(...placed.map((p) => p.bottomY)),
    maxY: Math.max(...placed.map((p) => p.topY)),
    minZ: Math.min(...placed.map((p) => p.z)),
    maxZ: Math.max(...placed.map((p) => p.z)),
  };
}

function PersonCard({
  placed,
  selected,
  dragging,
  palette,
  onDragStart,
}: {
  placed: Placed;
  selected: boolean;
  dragging: boolean;
  palette: Palette;
  onDragStart: (e: ThreeEvent<PointerEvent>, placed: Placed) => void;
}) {
  const { p, cx, topY, bottomY, z } = placed;
  const centerY = (topY + bottomY) / 2;
  const rimColor = p.sex === 'M' ? palette.male : p.sex === 'F' ? palette.female : palette.other;
  const panelColor = selected ? palette.accent : palette.panel;
  const [hovered, setHovered] = useState(false);

  return (
    <group position={[cx, centerY, z]}>
      <RoundedBox
        args={[CARD_W, CARD_H, CARD_D]}
        radius={0.05}
        smoothness={2}
        onPointerDown={(e) => {
          e.stopPropagation();
          onDragStart(e, placed);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = 'auto';
        }}
      >
        <meshStandardMaterial
          color={panelColor}
          emissive={rimColor}
          emissiveIntensity={hovered || selected || dragging ? 0.4 : 0.18}
          roughness={0.6}
          metalness={0.05}
          opacity={p.deathYear ? 0.75 : 1}
          transparent={!!p.deathYear}
        />
      </RoundedBox>
      <Html position={[0, 0, CARD_D / 2 + 0.02]} center distanceFactor={7} style={{ pointerEvents: 'none' }} occlude={false}>
        <div className="node-label-3d" style={{ color: palette.text }}>
          <div className="name">
            {p.firstName} {p.lastName}
          </div>
          {p.birthName && (
            <div className="birthname" style={{ color: palette.muted }}>
              {`né(e) ${p.birthName}`}
            </div>
          )}
          <div className="dates" style={{ color: palette.muted }}>
            {personLabel(p)}
          </div>
        </div>
      </Html>
    </group>
  );
}

interface DragState {
  id: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startOffsetX: number;
  startOffsetY: number;
  planeZ: number;
}

function Scene({
  layout,
  selectedId,
  onSelect,
  onMovePerson,
  palette,
  bounds,
  controlsRef,
}: {
  layout: ReturnType<typeof computeLayout>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMovePerson?: (id: string, offsetX: number, offsetY: number) => void;
  palette: Palette;
  bounds: Bounds;
  controlsRef: RefObject<OrbitControlsImpl | null>;
}) {
  const { camera, gl } = useThree();
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dragDelta, setDragDelta] = useState<{ id: string; dxPixels: number; dyPixels: number } | null>(null);
  const dragDeltaRef = useRef<{ dxPixels: number; dyPixels: number } | null>(null);
  const movedRef = useRef(false);

  // A person's own card is far too small a target to keep the cursor over
  // while dragging fast, so movement is tracked with window-level listeners
  // (like the 2D view's pointer capture) and converted back to world space
  // by raycasting onto an invisible plane fixed at the dragged card's depth —
  // that plane is what keeps the drag confined to the card's own generation
  // "floor" (only x/y move, exactly like the 2D view's offsetX/offsetY)
  // instead of sliding freely in and out of the screen.
  useEffect(() => {
    if (!dragState) return;
    const canvas = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -dragState.planeZ);
    const ndc = new THREE.Vector2();
    const hit = new THREE.Vector3();

    const raycastToPlane = (clientX: number, clientY: number): THREE.Vector3 | null => {
      const rect = canvas.getBoundingClientRect();
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      return raycaster.ray.intersectPlane(plane, hit) ? hit.clone() : null;
    };

    const startPoint = raycastToPlane(dragState.startClientX, dragState.startClientY);

    const handleMove = (ev: PointerEvent) => {
      if (ev.pointerId !== dragState.pointerId || !startPoint) return;
      const screenDx = ev.clientX - dragState.startClientX;
      const screenDy = ev.clientY - dragState.startClientY;
      if (!movedRef.current) {
        if (Math.hypot(screenDx, screenDy) < DRAG_THRESHOLD_PX) return;
        movedRef.current = true;
      }
      const current = raycastToPlane(ev.clientX, ev.clientY);
      if (!current) return;
      const delta = { dxPixels: (current.x - startPoint.x) / SCALE, dyPixels: -(current.y - startPoint.y) / SCALE };
      dragDeltaRef.current = delta;
      setDragDelta({ id: dragState.id, ...delta });
    };

    const handleUp = (ev: PointerEvent) => {
      if (ev.pointerId !== dragState.pointerId) return;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      if (controlsRef.current) controlsRef.current.enabled = true;

      if (movedRef.current) {
        const delta = dragDeltaRef.current ?? { dxPixels: 0, dyPixels: 0 };
        onMovePerson?.(dragState.id, dragState.startOffsetX + delta.dxPixels, dragState.startOffsetY + delta.dyPixels);
      } else {
        onSelect(dragState.id);
      }
      movedRef.current = false;
      dragDeltaRef.current = null;
      setDragDelta(null);
      setDragState(null);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragState, camera, gl]);

  const handleDragStart = (e: ThreeEvent<PointerEvent>, placed: Placed) => {
    if (controlsRef.current) controlsRef.current.enabled = false;
    movedRef.current = false;
    setDragState({
      id: placed.p.id,
      pointerId: e.nativeEvent.pointerId,
      startClientX: e.nativeEvent.clientX,
      startClientY: e.nativeEvent.clientY,
      startOffsetX: placed.p.offsetX ?? 0,
      startOffsetY: placed.p.offsetY ?? 0,
      planeZ: placed.z,
    });
  };

  const placedById = useMemo(() => {
    const m = new Map<string, Placed>();
    for (const p of layout.people) {
      m.set(p.id, dragDelta && dragDelta.id === p.id ? placeWithDelta(p, dragDelta.dxPixels, dragDelta.dyPixels) : place(p));
    }
    return m;
  }, [layout, dragDelta]);

  const floorY = bounds.minY - 0.4;
  const floorSize = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) + 6;

  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[6, 10, 8]} intensity={0.9} />
      <directionalLight position={[-6, 5, -4]} intensity={0.25} />
      <gridHelper
        args={[floorSize, Math.round(floorSize), palette.border, palette.border]}
        position={[(bounds.minX + bounds.maxX) / 2, floorY, (bounds.minZ + bounds.maxZ) / 2]}
      />

      {layout.partnerLinks.map(([a, b]) => {
        const pa = placedById.get(a.id);
        const pb = placedById.get(b.id);
        if (!pa || !pb) return null;
        const left = pa.cx <= pb.cx ? pa : pb;
        const right = pa.cx <= pb.cx ? pb : pa;
        const y = (left.topY + left.bottomY) / 2;
        return (
          <Line
            key={`partner-${a.id}-${b.id}`}
            points={[
              [left.cx + CARD_W / 2, y, left.z],
              [right.cx - CARD_W / 2, y, right.z],
            ]}
            color={palette.muted}
            dashed
            dashSize={0.08}
            gapSize={0.06}
            lineWidth={1.5}
          />
        );
      })}

      {layout.families.map((family) => {
        const parents = family.parentIds.map((id) => placedById.get(id)).filter((x): x is Placed => !!x);
        const children = family.childIds.map((id) => placedById.get(id)).filter((x): x is Placed => !!x);
        if (parents.length === 0 || children.length === 0) return null;

        const parentMidX = parents.reduce((sum, p) => sum + p.cx, 0) / parents.length;
        const parentBottomY = Math.min(...parents.map((p) => p.bottomY));
        const parentZ = parents[0].z;
        const childTopY = Math.max(...children.map((p) => p.topY));
        const childZ = children[0].z;
        const busY = (parentBottomY + childTopY) / 2;
        const busZ = (parentZ + childZ) / 2;
        const childXs = children.map((p) => p.cx);
        const busLeft = Math.min(parentMidX, ...childXs);
        const busRight = Math.max(parentMidX, ...childXs);
        const color = FAMILY_COLORS[family.colorIndex % FAMILY_COLORS.length];

        return (
          <group key={family.key}>
            <Line
              points={[
                [parentMidX, parentBottomY, parentZ],
                [parentMidX, busY, busZ],
              ]}
              color={color}
              lineWidth={2}
            />
            <Line
              points={[
                [busLeft, busY, busZ],
                [busRight, busY, busZ],
              ]}
              color={color}
              lineWidth={2}
            />
            {children.map((c) => (
              <Line
                key={`drop-${c.p.id}`}
                points={[
                  [c.cx, busY, busZ],
                  [c.cx, childTopY, childZ],
                ]}
                color={color}
                lineWidth={2}
              />
            ))}
          </group>
        );
      })}

      {[...placedById.values()].map((placed) => (
        <PersonCard
          key={placed.p.id}
          placed={placed}
          selected={placed.p.id === selectedId}
          dragging={dragState?.id === placed.p.id}
          palette={palette}
          onDragStart={handleDragStart}
        />
      ))}
    </>
  );
}

export default function FamilyTreeView3D({ people, selectedId, onSelect, focusedPersonName, focusedCount, onClearFocus, onMovePerson }: Props) {
  const layout = useMemo(() => computeLayout(people), [people]);
  const palette = usePalette();
  const controlsRef = useRef<OrbitControlsImpl | null>(null);

  const bounds = useMemo(() => computeBounds(layout.people.map(place)), [layout]);

  const center = useMemo<[number, number, number]>(
    () => [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, (bounds.minZ + bounds.maxZ) / 2],
    [bounds],
  );
  const size = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ, 4);
  const camPos = useMemo<[number, number, number]>(
    () => [center[0] + size * 0.75, center[1] + size * 0.95, center[2] + size * 1.6],
    [center, size],
  );

  useEffect(() => {
    return () => {
      document.body.style.cursor = 'auto';
    };
  }, []);

  const resetView = () => controlsRef.current?.reset();

  return (
    <div className="tree-viewport tree-viewport-3d">
      {focusedPersonName && (
        <div className="focus-banner">
          <span>
            Recentré sur <strong>{focusedPersonName}</strong>
            {typeof focusedCount === 'number' ? ` · ${focusedCount} personne${focusedCount > 1 ? 's' : ''}` : ''}
          </span>
          <button onClick={onClearFocus}>Afficher tout l'arbre</button>
        </div>
      )}
      <div className="tree-controls">
        <button onClick={resetView} title="Réinitialiser la vue">⟲</button>
      </div>
      <div className="tree-canvas-3d">
        {people.length === 0 ? (
          <div className="tree-empty">Aucune personne dans l'arbre pour le moment. Ajoutez-en une pour commencer.</div>
        ) : (
          <Canvas key={people.length} camera={{ position: camPos, fov: 45, near: 0.1, far: 500 }} dpr={[1, 2]}>
            <Suspense fallback={null}>
              <Scene layout={layout} selectedId={selectedId} onSelect={onSelect} onMovePerson={onMovePerson} palette={palette} bounds={bounds} controlsRef={controlsRef} />
            </Suspense>
            <OrbitControls ref={controlsRef} target={center} enableDamping dampingFactor={0.08} minDistance={1} maxDistance={size * 5} makeDefault />
          </Canvas>
        )}
      </div>
      {people.length > 0 && <div className="tree-hint-3d">Glisser le fond pour tourner · molette pour zoomer · glisser une personne pour la déplacer</div>}
    </div>
  );
}
