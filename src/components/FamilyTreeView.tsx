import { useCallback, useEffect, useRef, useState } from 'react';
import type { PositionedPerson } from '../types';
import { computeLayout, NODE_HEIGHT, NODE_WIDTH } from '../layout/computeLayout';
import type { Person } from '../types';
import './FamilyTreeView.css';

interface Props {
  people: Person[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  focusedPersonName?: string | null;
  focusedCount?: number;
  onClearFocus?: () => void;
  onMovePerson?: (id: string, offsetX: number, offsetY: number) => void;
}

const MIN_SCALE = 0.3;
const MAX_SCALE = 2.2;
const DRAG_THRESHOLD_PX = 4;

// Distinct, colorblind-friendlier hues so a family's connector lines stay
// identifiable from a neighboring family's even where they run close or cross.
const FAMILY_COLORS = ['#4f6df5', '#d1487b', '#0f9d6e', '#c9701f', '#8a5cf5', '#0e9ab0', '#b8862a', '#c2453d'];

function personLabel(p: PositionedPerson): string {
  const dates = [p.birthYear, p.deathYear].filter(Boolean);
  if (dates.length === 0) return '';
  if (p.deathYear) return `${p.birthYear ?? '?'} – ${p.deathYear}`;
  return `né(e) ${p.birthYear}`;
}

interface NodeDragState {
  id: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startOffsetX: number;
  startOffsetY: number;
  moved: boolean;
}

export default function FamilyTreeView({ people, selectedId, onSelect, focusedPersonName, focusedCount, onClearFocus, onMovePerson }: Props) {
  const layout = computeLayout(people);
  const containerRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState({ x: 40, y: 40, scale: 1 });
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const nodeDragState = useRef<NodeDragState | null>(null);
  const [dragPreview, setDragPreview] = useState<{ id: string; dx: number; dy: number } | null>(null);

  useEffect(() => {
    // Center the view roughly once when the tree size changes drastically.
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (layout.width > 0) {
      setTransform((t) => ({ ...t, x: Math.max(40, (rect.width - layout.width * t.scale) / 2) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people.length]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    setTransform((t) => {
      const delta = -e.deltaY * 0.0015;
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.scale * (1 + delta)));
      const scaleRatio = newScale / t.scale;
      const newX = mouseX - (mouseX - t.x) * scaleRatio;
      const newY = mouseY - (mouseY - t.y) * scaleRatio;
      return { x: newX, y: newY, scale: newScale };
    });
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest('.tree-node')) return;
      dragState.current = { startX: e.clientX, startY: e.clientY, origX: transform.x, origY: transform.y };
      setDragging(true);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [transform.x, transform.y],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState.current) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    setTransform((t) => ({ ...t, x: dragState.current!.origX + dx, y: dragState.current!.origY + dy }));
  }, []);

  const onPointerUp = useCallback(() => {
    dragState.current = null;
    setDragging(false);
  }, []);

  const zoomBy = (factor: number) => {
    setTransform((t) => ({ ...t, scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.scale * factor)) }));
  };

  const resetView = () => setTransform({ x: 40, y: 40, scale: 1 });

  // Renders a person's base (computed + persisted offset) position, nudged by
  // whatever live drag delta is in progress for them — so a node and every
  // connector touching it stay visually attached to the cursor while dragging,
  // and snap to the committed position once the drag is released.
  const renderPos = useCallback(
    (p: PositionedPerson): { x: number; y: number } => {
      if (dragPreview && dragPreview.id === p.id) {
        return { x: p.x + dragPreview.dx, y: p.y + dragPreview.dy };
      }
      return { x: p.x, y: p.y };
    },
    [dragPreview],
  );

  const onNodePointerDown = useCallback((e: React.PointerEvent, p: PositionedPerson) => {
    e.stopPropagation();
    nodeDragState.current = {
      id: p.id,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startOffsetX: p.offsetX ?? 0,
      startOffsetY: p.offsetY ?? 0,
      moved: false,
    };
    (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId);
  }, []);

  const onNodePointerMove = useCallback((e: React.PointerEvent) => {
    const state = nodeDragState.current;
    if (!state || e.pointerId !== state.pointerId) return;
    const screenDx = e.clientX - state.startClientX;
    const screenDy = e.clientY - state.startClientY;
    if (!state.moved && Math.hypot(screenDx, screenDy) < DRAG_THRESHOLD_PX) return;
    state.moved = true;
    setDragPreview({ id: state.id, dx: screenDx / transform.scale, dy: screenDy / transform.scale });
  }, [transform.scale]);

  const onNodePointerUp = useCallback(
    (e: React.PointerEvent, p: PositionedPerson) => {
      const state = nodeDragState.current;
      if (!state || e.pointerId !== state.pointerId) return;
      nodeDragState.current = null;
      setDragPreview(null);

      if (!state.moved) {
        onSelect(p.id);
        return;
      }
      const screenDx = e.clientX - state.startClientX;
      const screenDy = e.clientY - state.startClientY;
      onMovePerson?.(p.id, state.startOffsetX + screenDx / transform.scale, state.startOffsetY + screenDy / transform.scale);
    },
    [onSelect, onMovePerson, transform.scale],
  );

  return (
    <div className="tree-viewport">
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
        <button onClick={() => zoomBy(1.2)} title="Zoomer">+</button>
        <button onClick={() => zoomBy(1 / 1.2)} title="Dézoomer">−</button>
        <button onClick={resetView} title="Réinitialiser la vue">⟲</button>
      </div>
      <div
        ref={containerRef}
        className={`tree-canvas${dragging ? ' dragging' : ''}`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {people.length === 0 ? (
          <div className="tree-empty">Aucune personne dans l'arbre pour le moment. Ajoutez-en une pour commencer.</div>
        ) : (
          <svg
            width={Math.max(1, layout.width)}
            height={Math.max(1, layout.height)}
            style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`, transformOrigin: '0 0' }}
          >
            <g className="connectors">
              {layout.partnerLinks.map(([a, b]) => {
                const posA = renderPos(a);
                const posB = renderPos(b);
                return (
                  <line
                    key={`partner-${a.id}-${b.id}`}
                    className="partner-line"
                    x1={posA.x + NODE_WIDTH}
                    y1={posA.y + NODE_HEIGHT / 2}
                    x2={posB.x}
                    y2={posB.y + NODE_HEIGHT / 2}
                  />
                );
              })}
              {layout.families.map((family) => {
                const parents = family.parentIds.map((id) => layout.byId.get(id)!).filter(Boolean);
                const children = family.childIds.map((id) => layout.byId.get(id)!).filter(Boolean);
                if (parents.length === 0 || children.length === 0) return null;

                const parentPositions = parents.map(renderPos);
                const childPositions = children.map(renderPos);

                const parentXs = parentPositions.map((pos) => pos.x + NODE_WIDTH / 2);
                const parentMidX = (Math.min(...parentXs) + Math.max(...parentXs)) / 2;
                const parentY = Math.max(...parentPositions.map((pos) => pos.y)) + NODE_HEIGHT;
                const childTopY = Math.min(...childPositions.map((pos) => pos.y));
                const busY = parentY + (childTopY - parentY) / 2;
                const childXs = childPositions.map((pos) => pos.x + NODE_WIDTH / 2);
                const busLeft = Math.min(parentMidX, ...childXs);
                const busRight = Math.max(parentMidX, ...childXs);
                const color = FAMILY_COLORS[family.colorIndex % FAMILY_COLORS.length];

                return (
                  <g key={family.key} className="family-group" style={{ stroke: color }}>
                    <line className="link-line" x1={parentMidX} y1={parentY} x2={parentMidX} y2={busY} />
                    <line className="link-line" x1={busLeft} y1={busY} x2={busRight} y2={busY} />
                    {children.map((c, i) => (
                      <line
                        key={`drop-${c.id}`}
                        className="link-line"
                        x1={childPositions[i].x + NODE_WIDTH / 2}
                        y1={busY}
                        x2={childPositions[i].x + NODE_WIDTH / 2}
                        y2={childPositions[i].y}
                      />
                    ))}
                  </g>
                );
              })}
            </g>

            <g className="nodes">
              {layout.people.map((p) => {
                const pos = renderPos(p);
                const isDragging = dragPreview?.id === p.id;
                return (
                  <g
                    key={p.id}
                    className={`tree-node sex-${p.sex}${p.id === selectedId ? ' selected' : ''}${p.deathYear ? ' deceased' : ''}${isDragging ? ' dragging' : ''}`}
                    transform={`translate(${pos.x}, ${pos.y})`}
                    onPointerDown={(e) => onNodePointerDown(e, p)}
                    onPointerMove={onNodePointerMove}
                    onPointerUp={(e) => onNodePointerUp(e, p)}
                  >
                    <title>{p.firstName} {p.lastName} — cliquer pour modifier, glisser pour déplacer</title>
                    <rect width={NODE_WIDTH} height={NODE_HEIGHT} rx={10} className="node-box" />
                    <text x={NODE_WIDTH / 2} y={26} className="node-name" textAnchor="middle">
                      {p.firstName}
                    </text>
                    <text x={NODE_WIDTH / 2} y={46} className="node-name" textAnchor="middle">
                      {p.lastName}
                    </text>
                    {p.birthName && (
                      <text x={NODE_WIDTH / 2} y={62} className="node-birth-name" textAnchor="middle">
                        né(e) {p.birthName}
                      </text>
                    )}
                    <text x={NODE_WIDTH / 2} y={84} className="node-dates" textAnchor="middle">
                      {personLabel(p)}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        )}
      </div>
    </div>
  );
}
