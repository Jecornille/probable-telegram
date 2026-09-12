import { lazy, Suspense, useMemo, useState } from 'react';
import Sidebar from './components/Sidebar';
import PersonForm from './components/PersonForm';
import FamilyTreeView from './components/FamilyTreeView';
import { useFamilyData } from './hooks/useFamilyData';
import { computeFocusSubset } from './utils/focusSubset';
import { parseGedcom, serializeGedcom } from './utils/gedcom';
import type { Person } from './types';
import './App.css';

const FamilyTreeView3D = lazy(() => import('./components/FamilyTreeView3D'));

type PanelMode = { kind: 'closed' } | { kind: 'add' } | { kind: 'edit'; id: string };
type ViewMode = '2d' | '3d';

function App() {
  const { people, addPerson, updatePerson, movePerson, deletePerson, resetToSample, clearAll, importPeople } = useFamilyData();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelMode>({ kind: 'closed' });
  const [focusId, setFocusId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('2d');

  const editingPerson: Person | null = useMemo(() => {
    if (panel.kind !== 'edit') return null;
    return people.find((p) => p.id === panel.id) ?? null;
  }, [panel, people]);

  const focusedPerson = useMemo(() => (focusId ? (people.find((p) => p.id === focusId) ?? null) : null), [focusId, people]);

  const visiblePeople = useMemo(() => {
    if (!focusedPerson) return people;
    const idsSet = computeFocusSubset(people, focusedPerson.id);
    return people.filter((p) => idsSet.has(p.id));
  }, [people, focusedPerson]);

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setPanel({ kind: 'edit', id });
  };

  const handleSave = (id: string | null, data: Omit<Person, 'id'>) => {
    if (id) {
      updatePerson(id, data);
    } else {
      const newId = addPerson(data);
      setSelectedId(newId);
    }
    setPanel({ kind: 'closed' });
  };

  const handleDelete = (id: string) => {
    deletePerson(id);
    if (selectedId === id) setSelectedId(null);
    if (focusId === id) setFocusId(null);
    setPanel({ kind: 'closed' });
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(people, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'arbre-genealogique.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result)) as Person[];
        if (Array.isArray(data)) {
          importPeople(data);
          setPanel({ kind: 'closed' });
          setSelectedId(null);
        }
      } catch {
        alert("Le fichier n'est pas un JSON valide.");
      }
    };
    reader.readAsText(file);
  };

  const handleExportGedcom = () => {
    const blob = new Blob([serializeGedcom(people)], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'arbre-genealogique.ged';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportGedcom = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = parseGedcom(String(reader.result));
        if (data.length === 0) {
          alert("Aucune personne n'a pu être lue dans ce fichier GEDCOM.");
          return;
        }
        importPeople(data);
        setPanel({ kind: 'closed' });
        setSelectedId(null);
      } catch {
        alert("Le fichier GEDCOM n'a pas pu être lu.");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="app-shell">
      <Sidebar
        people={people}
        selectedId={selectedId}
        focusId={focusId}
        onSelect={handleSelect}
        onFocus={setFocusId}
        onAddNew={() => setPanel({ kind: 'add' })}
        onResetSample={resetToSample}
        onClearAll={clearAll}
        onExport={handleExport}
        onImport={handleImport}
        onExportGedcom={handleExportGedcom}
        onImportGedcom={handleImportGedcom}
      />

      <main className="tree-area">
        <div className="view-toggle">
          <button className={viewMode === '2d' ? 'active' : ''} onClick={() => setViewMode('2d')}>
            Vue 2D
          </button>
          <button className={viewMode === '3d' ? 'active' : ''} onClick={() => setViewMode('3d')}>
            Vue 3D
          </button>
        </div>
        {viewMode === '2d' ? (
          <FamilyTreeView
            people={visiblePeople}
            selectedId={selectedId}
            onSelect={handleSelect}
            focusedPersonName={focusedPerson ? `${focusedPerson.firstName} ${focusedPerson.lastName}` : null}
            focusedCount={visiblePeople.length}
            onClearFocus={() => setFocusId(null)}
            onMovePerson={movePerson}
          />
        ) : (
          <Suspense fallback={<div className="tree-3d-loading">Chargement de la vue 3D…</div>}>
            <FamilyTreeView3D
              people={visiblePeople}
              selectedId={selectedId}
              onSelect={handleSelect}
              focusedPersonName={focusedPerson ? `${focusedPerson.firstName} ${focusedPerson.lastName}` : null}
              focusedCount={visiblePeople.length}
              onClearFocus={() => setFocusId(null)}
              onMovePerson={movePerson}
            />
          </Suspense>
        )}
      </main>

      {panel.kind !== 'closed' && (
        <div className="panel-backdrop" onClick={() => setPanel({ kind: 'closed' })}>
          <div className="panel" onClick={(e) => e.stopPropagation()}>
            <PersonForm
              key={panel.kind === 'edit' ? panel.id : 'new'}
              people={people}
              editingPerson={editingPerson}
              onSave={handleSave}
              onDelete={handleDelete}
              onCancel={() => setPanel({ kind: 'closed' })}
              onResetPosition={(id) => movePerson(id, 0, 0)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
