import { useState } from 'react';
import type { Person, Sex } from '../types';
import './PersonForm.css';

interface Props {
  people: Person[];
  editingPerson: Person | null;
  onSave: (id: string | null, data: Omit<Person, 'id'>) => void;
  onDelete: (id: string) => void;
  onCancel: () => void;
  onResetPosition?: (id: string) => void;
}

const emptyForm = {
  firstName: '',
  lastName: '',
  birthName: '',
  sex: 'F' as Sex,
  birthYear: '',
  deathYear: '',
  birthPlace: '',
  notes: '',
  parentIds: [] as string[],
  partnerIds: [] as string[],
};

function formFromPerson(person: Person | null): typeof emptyForm {
  if (!person) return emptyForm;
  return {
    firstName: person.firstName,
    lastName: person.lastName,
    birthName: person.birthName ?? '',
    sex: person.sex,
    birthYear: person.birthYear?.toString() ?? '',
    deathYear: person.deathYear?.toString() ?? '',
    birthPlace: person.birthPlace ?? '',
    notes: person.notes ?? '',
    parentIds: person.parentIds,
    partnerIds: person.partnerIds,
  };
}

// Note: parent renders this with a `key` tied to the edited person's id,
// so a fresh instance (and fresh initial state) is created when the target changes.
export default function PersonForm({ people, editingPerson, onSave, onDelete, onCancel, onResetPosition }: Props) {
  const [form, setForm] = useState(() => formFromPerson(editingPerson));

  const selectableParents = people.filter((p) => p.id !== editingPerson?.id);
  const selectablePartners = people.filter((p) => p.id !== editingPerson?.id);

  const handleParentToggle = (id: string) => {
    setForm((f) => {
      const has = f.parentIds.includes(id);
      if (has) return { ...f, parentIds: f.parentIds.filter((p) => p !== id) };
      if (f.parentIds.length >= 2) return f;
      return { ...f, parentIds: [...f.parentIds, id] };
    });
  };

  const handlePartnerToggle = (id: string) => {
    setForm((f) => {
      const has = f.partnerIds.includes(id);
      return has ? { ...f, partnerIds: f.partnerIds.filter((p) => p !== id) } : { ...f, partnerIds: [...f.partnerIds, id] };
    });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.firstName.trim() || !form.lastName.trim()) return;
    onSave(editingPerson?.id ?? null, {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      birthName: form.birthName.trim() || undefined,
      sex: form.sex,
      birthYear: form.birthYear ? Number(form.birthYear) : undefined,
      deathYear: form.deathYear ? Number(form.deathYear) : undefined,
      birthPlace: form.birthPlace.trim() || undefined,
      notes: form.notes.trim() || undefined,
      parentIds: form.parentIds,
      partnerIds: form.partnerIds,
    });
  };

  return (
    <form className="person-form" onSubmit={submit}>
      <h2>{editingPerson ? 'Modifier la personne' : 'Ajouter une personne'}</h2>

      <label>
        Prénom
        <input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required />
      </label>

      <label>
        Nom
        <input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required />
      </label>

      <label>
        Nom de naissance
        <input
          value={form.birthName}
          onChange={(e) => setForm({ ...form, birthName: e.target.value })}
          placeholder="si différent du nom actuel"
        />
      </label>

      <label>
        Sexe
        <select value={form.sex} onChange={(e) => setForm({ ...form, sex: e.target.value as Sex })}>
          <option value="F">Femme</option>
          <option value="M">Homme</option>
          <option value="X">Autre / inconnu</option>
        </select>
      </label>

      <div className="form-row">
        <label>
          Naissance
          <input
            type="number"
            value={form.birthYear}
            onChange={(e) => setForm({ ...form, birthYear: e.target.value })}
            placeholder="année"
          />
        </label>
        <label>
          Décès
          <input
            type="number"
            value={form.deathYear}
            onChange={(e) => setForm({ ...form, deathYear: e.target.value })}
            placeholder="année"
          />
        </label>
      </div>

      <label>
        Lieu de naissance
        <input value={form.birthPlace} onChange={(e) => setForm({ ...form, birthPlace: e.target.value })} />
      </label>

      <fieldset>
        <legend>Parents (max 2)</legend>
        <div className="chip-list">
          {selectableParents.length === 0 && <p className="hint">Aucune autre personne disponible.</p>}
          {selectableParents.map((p) => (
            <label key={p.id} className={`chip ${form.parentIds.includes(p.id) ? 'active' : ''}`}>
              <input
                type="checkbox"
                checked={form.parentIds.includes(p.id)}
                onChange={() => handleParentToggle(p.id)}
                disabled={!form.parentIds.includes(p.id) && form.parentIds.length >= 2}
              />
              {p.firstName} {p.lastName}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Conjoint(s) / partenaire(s)</legend>
        <div className="chip-list">
          {selectablePartners.length === 0 && <p className="hint">Aucune autre personne disponible.</p>}
          {selectablePartners.map((p) => (
            <label key={p.id} className={`chip ${form.partnerIds.includes(p.id) ? 'active' : ''}`}>
              <input type="checkbox" checked={form.partnerIds.includes(p.id)} onChange={() => handlePartnerToggle(p.id)} />
              {p.firstName} {p.lastName}
            </label>
          ))}
        </div>
      </fieldset>

      <label>
        Notes
        <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
      </label>

      {editingPerson && (editingPerson.offsetX || editingPerson.offsetY) ? (
        <p className="hint">
          Cette personne a été déplacée manuellement dans l'arbre.{' '}
          <button type="button" className="link-button" onClick={() => onResetPosition?.(editingPerson.id)}>
            Réinitialiser sa position
          </button>
        </p>
      ) : null}

      <div className="form-actions">
        <button type="submit" className="primary">
          {editingPerson ? 'Enregistrer' : 'Ajouter'}
        </button>
        {editingPerson && (
          <button
            type="button"
            className="danger"
            onClick={() => {
              if (confirm(`Supprimer ${editingPerson.firstName} ${editingPerson.lastName} ?`)) {
                onDelete(editingPerson.id);
              }
            }}
          >
            Supprimer
          </button>
        )}
        <button type="button" onClick={onCancel}>
          Annuler
        </button>
      </div>
    </form>
  );
}
