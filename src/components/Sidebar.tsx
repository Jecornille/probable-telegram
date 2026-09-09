import { useMemo, useState } from 'react';
import type { Person } from '../types';
import './Sidebar.css';

interface Props {
  people: Person[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAddNew: () => void;
  onResetSample: () => void;
  onClearAll: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
}

export default function Sidebar({ people, selectedId, onSelect, onAddNew, onResetSample, onClearAll, onExport, onImport }: Props) {
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
          <li key={p.id}>
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
