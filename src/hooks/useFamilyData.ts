import { useCallback, useEffect, useState } from 'react';
import type { Person } from '../types';
import { sampleFamily } from '../data/sampleFamily';

const STORAGE_KEY = 'genealogy-tree-people';

function loadInitial(): Person[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Person[];
  } catch {
    // ignore corrupted storage and fall back to sample data
  }
  return sampleFamily;
}

function makeId(): string {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function useFamilyData() {
  const [people, setPeople] = useState<Person[]>(loadInitial);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(people));
  }, [people]);

  const addPerson = useCallback((data: Omit<Person, 'id'>) => {
    const id = makeId();
    setPeople((prev) => {
      const next = [...prev, { ...data, id }];
      // keep partner links mutual
      for (const partnerId of data.partnerIds) {
        const idx = next.findIndex((p) => p.id === partnerId);
        if (idx >= 0 && !next[idx].partnerIds.includes(id)) {
          next[idx] = { ...next[idx], partnerIds: [...next[idx].partnerIds, id] };
        }
      }
      return next;
    });
    return id;
  }, []);

  const updatePerson = useCallback((id: string, data: Omit<Person, 'id'>) => {
    setPeople((prev) => {
      const before = prev.find((p) => p.id === id);
      // The edit form never touches a manually-dragged position, so carry it over.
      let next = prev.map((p) => (p.id === id ? { ...data, id, offsetX: before?.offsetX, offsetY: before?.offsetY } : p));

      const beforePartners = new Set(before?.partnerIds ?? []);
      const afterPartners = new Set(data.partnerIds);

      // added partner links become mutual
      for (const pid of afterPartners) {
        if (!beforePartners.has(pid)) {
          next = next.map((p) => (p.id === pid && !p.partnerIds.includes(id) ? { ...p, partnerIds: [...p.partnerIds, id] } : p));
        }
      }
      // removed partner links are cleared on the other side too
      for (const pid of beforePartners) {
        if (!afterPartners.has(pid)) {
          next = next.map((p) => (p.id === pid ? { ...p, partnerIds: p.partnerIds.filter((x) => x !== id) } : p));
        }
      }
      return next;
    });
  }, []);

  const movePerson = useCallback((id: string, offsetX: number, offsetY: number) => {
    setPeople((prev) => prev.map((p) => (p.id === id ? { ...p, offsetX, offsetY } : p)));
  }, []);

  const deletePerson = useCallback((id: string) => {
    setPeople((prev) =>
      prev
        .filter((p) => p.id !== id)
        .map((p) => ({
          ...p,
          parentIds: p.parentIds.filter((pid) => pid !== id),
          partnerIds: p.partnerIds.filter((pid) => pid !== id),
        })),
    );
  }, []);

  const resetToSample = useCallback(() => setPeople(sampleFamily), []);
  const clearAll = useCallback(() => setPeople([]), []);
  const importPeople = useCallback((data: Person[]) => setPeople(data), []);

  return { people, addPerson, updatePerson, movePerson, deletePerson, resetToSample, clearAll, importPeople };
}
