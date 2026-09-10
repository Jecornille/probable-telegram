import { useMemo, useState } from 'react';
import Sidebar from './components/Sidebar';
import PersonForm from './components/PersonForm';
import FamilyTreeView from './components/FamilyTreeView';
import { useFamilyData } from './hooks/useFamilyData';
import type { Person } from './types';
import './App.css';

type PanelMode = { kind: 'closed' } | { kind: 'add' } | { kind: 'edit'; id: string };

function App() {
  const { people, addPerson, updatePerson, deletePerson, resetToSample, clearAll, importPeople } = useFamilyData();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelMode>({ kind: 'closed' });

  const editingPerson: Person | null = useMemo(() => {
    if (panel.kind !== 'edit') return null;
    return people.find((p) => p.id === panel.id) ?? null;
  }, [panel, people]);

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

  return (
    <div className="app-shell">
      <Sidebar
        people={people}
        selectedId={selectedId}
        onSelect={handleSelect}
        onAddNew={() => setPanel({ kind: 'add' })}
        onResetSample={resetToSample}
        onClearAll={clearAll}
        onExport={handleExport}
        onImport={handleImport}
      />

      <main className="tree-area">
        <FamilyTreeView people={people} selectedId={selectedId} onSelect={handleSelect} />
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
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
