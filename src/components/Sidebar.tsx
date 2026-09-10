import { useMemo, useState } from 'react';
import type { Person } from '../types';
import './Sidebar.css';

interface Props {
  people: Person[];
  selectedId: string | null;
  focusId: string | null;
  onSelect: (id: string) => void;
  onFocus: (id: string | null) => void;
  onAddNew: () => void;
  onResetSample: () => void;
  onClearAll: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
}

function TargetIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8" cy="8" r="2" fill="currentColor" />
    </svg>
  );
}

export default function Sidebar({ people, selectedId, focusId, onSelect, onFocus, onAddNew, onResetSample, onClearAll, onExport, onImport }: Props) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...people].sort((a, b) => `${a.firstName}${a.lastName}`.localeCompare(`${b.firstName}${b.lastName}`));
    if (!q) return sorted;
    return sorted.filter((p) => `${p.firstName} ${p.lastName}`.toLowerCase().includes(q));
  }, [people, query]);

  return (
    <aside className="sidebar">
      <h1>Arbre généalogique</h1>

      <button className="primary full-width" onClick={onAddNew}>
        + Ajouter une personne
      </button>

      <input className="search" placeholder="Rechercher..." value={query} onChange={(e) => setQuery(e.target.value)} />

      <ul className="person-list">
        {filtered.map((p) => (
          <li key={p.id} className="person-row">
            <button className={`person-item${p.id === selectedId ? ' selected' : ''}`} onClick={() => onSelect(p.id)}>
              <span className={`dot sex-${p.sex}`} />
              <span>
                {p.firstName} {p.lastName}
              </span>
              {(p.birthYear || p.deathYear) && (
                <span className="years">
                  {p.birthYear ?? '?'}
                  {p.deathYear ? ` – ${p.deathYear}` : ''}
                </span>
              )}
            </button>
            <button
              className={`focus-toggle${p.id === focusId ? ' active' : ''}`}
              onClick={() => onFocus(p.id === focusId ? null : p.id)}
              title={p.id === focusId ? "Afficher tout l'arbre" : `Centrer l'arbre sur ${p.firstName}`}
            >
              <TargetIcon />
            </button>
          </li>
        ))}
        {filtered.length === 0 && <li className="hint">Aucun résultat.</li>}
      </ul>

      <div className="sidebar-footer">
        <span className="count">{people.length} personne{people.length > 1 ? 's' : ''}</span>
        <div className="footer-actions">
          <button onClick={onExport} title="Exporter en JSON">Exporter</button>
          <label className="import-label" title="Importer un fichier JSON">
            Importer
            <input
              type="file"
              accept="application/json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onImport(file);
                e.target.value = '';
              }}
            />
          </label>
        </div>
        <div className="footer-actions">
          <button onClick={onResetSample}>Exemple</button>
          <button
            className="danger"
            onClick={() => {
              if (confirm('Supprimer toutes les personnes ?')) onClearAll();
            }}
          >
            Tout effacer
          </button>
        </div>
      </div>
    </aside>
  );
}
