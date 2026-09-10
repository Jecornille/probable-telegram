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
}

const MIN_SCALE = 0.3;
const MAX_SCALE = 2.2;

// Distinct, colorblind-friendlier hues so a family's connector lines stay
// identifiable from a neighboring family's even where they run close or cross.
const FAMILY_COLORS = ['#4f6df5', '#d1487b', '#0f9d6e', '#c9701f', '#8a5cf5', '#0e9ab0', '#b8862a', '#c2453d'];

function personLabel(p: PositionedPerson): string {
  const dates = [p.birthYear, p.deathYear].filter(Boolean);
  if (dates.length === 0) return '';
  if (p.deathYear) return `${p.birthYear ?? '?'} – ${p.deathYear}`;
  return `né(e) ${p.birthYear}`;
}

export default function FamilyTreeView({ people, selectedId, onSelect, focusedPersonName, focusedCount, onClearFocus }: Props) {
  const layout = computeLayout(people);
  const containerRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState({ x: 40, y: 40, scale: 1 });
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [dragging, setDragging] = useState(false);

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
              {layout.partnerLinks.map(([a, b]) => (
                <line
                  key={`partner-${a.id}-${b.id}`}
                  className="partner-line"
                  x1={a.x + NODE_WIDTH}
                  y1={a.y + NODE_HEIGHT / 2}
                  x2={b.x}
                  y2={b.y + NODE_HEIGHT / 2}
                />
              ))}
              {layout.families.map((family) => {
                const parents = family.parentIds.map((id) => layout.byId.get(id)!).filter(Boolean);
                const children = family.childIds.map((id) => layout.byId.get(id)!).filter(Boolean);
                if (parents.length === 0 || children.length === 0) return null;

                const parentXs = parents.map((p) => p.x + NODE_WIDTH / 2);
                const parentMidX = (Math.min(...parentXs) + Math.max(...parentXs)) / 2;
                const parentY = Math.max(...parents.map((p) => p.y)) + NODE_HEIGHT;
                const childTopY = Math.min(...children.map((c) => c.y));
                const busY = parentY + (childTopY - parentY) / 2;
                const childXs = children.map((c) => c.x + NODE_WIDTH / 2);
                const busLeft = Math.min(parentMidX, ...childXs);
                const busRight = Math.max(parentMidX, ...childXs);
                const color = FAMILY_COLORS[family.colorIndex % FAMILY_COLORS.length];

                return (
                  <g key={family.key} className="family-group" style={{ stroke: color }}>
                    <line className="link-line" x1={parentMidX} y1={parentY} x2={parentMidX} y2={busY} />
                    <line className="link-line" x1={busLeft} y1={busY} x2={busRight} y2={busY} />
                    {children.map((c) => (
                      <line key={`drop-${c.id}`} className="link-line" x1={c.x + NODE_WIDTH / 2} y1={busY} x2={c.x + NODE_WIDTH / 2} y2={c.y} />
                    ))}
                  </g>
                );
              })}
            </g>

            <g className="nodes">
              {layout.people.map((p) => (
                <g
                  key={p.id}
                  className={`tree-node sex-${p.sex}${p.id === selectedId ? ' selected' : ''}${p.deathYear ? ' deceased' : ''}`}
                  transform={`translate(${p.x}, ${p.y})`}
                  onClick={() => onSelect(p.id)}
                >
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
              ))}
            </g>
          </svg>
        )}
      </div>
    </div>
  );
}
