import type { Person, PositionedPerson } from '../types';

export const COL_WIDTH = 200;
export const ROW_HEIGHT = 170;
export const NODE_WIDTH = 170;
export const NODE_HEIGHT = 86;

export interface FamilyGroup {
  key: string;
  parentIds: string[];
  childIds: string[];
}

export interface LayoutResult {
  people: PositionedPerson[];
  byId: Map<string, PositionedPerson>;
  partnerLinks: [PositionedPerson, PositionedPerson][];
  families: FamilyGroup[];
  width: number;
  height: number;
}

function computeGenerations(people: Person[]): Map<string, number> {
  const byId = new Map(people.map((p) => [p.id, p]));
  const gen = new Map<string, number>();
  const visiting = new Set<string>();

  function resolve(id: string): number {
    if (gen.has(id)) return gen.get(id)!;
    if (visiting.has(id)) return 0; // guard against accidental cycles
    visiting.add(id);
    const person = byId.get(id);
    const validParents = (person?.parentIds ?? []).filter((pid) => byId.has(pid) && pid !== id);
    const g = validParents.length === 0 ? 0 : 1 + Math.max(...validParents.map(resolve));
    visiting.delete(id);
    gen.set(id, g);
    return g;
  }

  for (const p of people) resolve(p.id);

  // Pull partners onto the same generation as their spouse (marrying into a family).
  let changed = true;
  let guard = 0;
  while (changed && guard < people.length + 5) {
    changed = false;
    guard++;
    for (const p of people) {
      for (const partnerId of p.partnerIds) {
        if (!byId.has(partnerId)) continue;
        const a = gen.get(p.id) ?? 0;
        const b = gen.get(partnerId) ?? 0;
        if (a !== b) {
          const max = Math.max(a, b);
          gen.set(p.id, max);
          gen.set(partnerId, max);
          changed = true;
        }
      }
    }
  }

  return gen;
}

export function computeLayout(people: Person[]): LayoutResult {
  const byId = new Map(people.map((p) => [p.id, p]));
  const generations = computeGenerations(people);
  const maxGen = people.length === 0 ? 0 : Math.max(...people.map((p) => generations.get(p.id) ?? 0));

  const slots = new Map<string, number>();
  let previousLevelSlot = new Map<string, number>();

  for (let g = 0; g <= maxGen; g++) {
    const levelPeople = people.filter((p) => generations.get(p.id) === g);
    const placed = new Set<string>();
    const ordered: Person[] = [];

    const sortKey = (p: Person): number => {
      if (g === 0) return people.indexOf(p);
      const validParents = p.parentIds.filter((pid) => previousLevelSlot.has(pid));
      if (validParents.length > 0) {
        const avg = validParents.reduce((sum, pid) => sum + previousLevelSlot.get(pid)!, 0) / validParents.length;
        return avg;
      }
      return 1000 + people.indexOf(p); // no known parent placed: push to the end, stable by original order
    };

    const sorted = [...levelPeople].sort((a, b) => sortKey(a) - sortKey(b));

    for (const p of sorted) {
      if (placed.has(p.id)) continue;
      ordered.push(p);
      placed.add(p.id);
      for (const partnerId of p.partnerIds) {
        if (placed.has(partnerId)) continue;
        const partner = byId.get(partnerId);
        if (partner && generations.get(partner.id) === g) {
          ordered.push(partner);
          placed.add(partner.id);
        }
      }
    }

    const currentLevelSlot = new Map<string, number>();
    ordered.forEach((p, i) => {
      slots.set(p.id, i);
      currentLevelSlot.set(p.id, i);
    });
    previousLevelSlot = currentLevelSlot;
  }

  const positioned: PositionedPerson[] = people.map((p) => ({
    ...p,
    generation: generations.get(p.id) ?? 0,
    slot: slots.get(p.id) ?? 0,
    x: (slots.get(p.id) ?? 0) * COL_WIDTH,
    y: (generations.get(p.id) ?? 0) * ROW_HEIGHT,
  }));

  const positionedById = new Map(positioned.map((p) => [p.id, p]));

  const partnerLinks: [PositionedPerson, PositionedPerson][] = [];
  const seenPartnerPairs = new Set<string>();
  for (const p of positioned) {
    for (const partnerId of p.partnerIds) {
      const partner = positionedById.get(partnerId);
      if (!partner || partner.generation !== p.generation) continue;
      const key = [p.id, partnerId].sort().join('|');
      if (seenPartnerPairs.has(key)) continue;
      seenPartnerPairs.add(key);
      partnerLinks.push(p.x <= partner.x ? [p, partner] : [partner, p]);
    }
  }

  const familyMap = new Map<string, FamilyGroup>();
  for (const p of positioned) {
    const validParents = p.parentIds.filter((pid) => positionedById.has(pid));
    if (validParents.length === 0) continue;
    const key = [...validParents].sort().join('|');
    if (!familyMap.has(key)) {
      familyMap.set(key, { key, parentIds: validParents, childIds: [] });
    }
    familyMap.get(key)!.childIds.push(p.id);
  }

  const width = positioned.length === 0 ? 0 : Math.max(...positioned.map((p) => p.x)) + NODE_WIDTH;
  const height = positioned.length === 0 ? 0 : Math.max(...positioned.map((p) => p.y)) + NODE_HEIGHT;

  return {
    people: positioned,
    byId: positionedById,
    partnerLinks,
    families: [...familyMap.values()],
    width,
    height,
  };
}
