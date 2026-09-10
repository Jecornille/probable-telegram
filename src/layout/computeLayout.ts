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

/** Pairs of people who co-parent at least one child together, whether or not they're still partners. */
function getCoParentPairs(people: Person[]): [string, string][] {
  const byId = new Map(people.map((p) => [p.id, p]));
  const pairs: [string, string][] = [];
  for (const p of people) {
    const validParents = p.parentIds.filter((pid) => byId.has(pid) && pid !== p.id);
    if (validParents.length === 2) {
      pairs.push([validParents[0], validParents[1]]);
    }
  }
  return pairs;
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

  function equalize(idA: string, idB: string): boolean {
    const a = gen.get(idA) ?? 0;
    const b = gen.get(idB) ?? 0;
    if (a !== b) {
      const max = Math.max(a, b);
      gen.set(idA, max);
      gen.set(idB, max);
      return true;
    }
    return false;
  }

  // Pull partners, and co-parents who share a child (even if no longer partners),
  // onto the same generation — otherwise the parent-child connectors can't line up.
  const coParentPairs = getCoParentPairs(people);
  let changed = true;
  let guard = 0;
  while (changed && guard < people.length + 5) {
    changed = false;
    guard++;
    for (const p of people) {
      for (const partnerId of p.partnerIds) {
        if (!byId.has(partnerId)) continue;
        if (equalize(p.id, partnerId)) changed = true;
      }
    }
    for (const [a, b] of coParentPairs) {
      if (equalize(a, b)) changed = true;
    }
  }

  return gen;
}

/** Every person paired with everyone they should be placed next to: partners and co-parents alike. */
function getLinkedIds(people: Person[]): Map<string, Set<string>> {
  const linked = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!linked.has(a)) linked.set(a, new Set());
    linked.get(a)!.add(b);
  };
  for (const p of people) {
    for (const partnerId of p.partnerIds) {
      link(p.id, partnerId);
      link(partnerId, p.id);
    }
  }
  for (const [a, b] of getCoParentPairs(people)) {
    link(a, b);
    link(b, a);
  }
  return linked;
}

/**
 * Orders a cluster of mutually linked people (partners/co-parents) so that the
 * person with the most connections — e.g. someone with children by several
 * partners — sits in the middle, flanked by those partners, instead of being
 * placed next to only one of them while the rest scatter across the row.
 */
function buildClusterOrder(ids: string[], linked: Map<string, Set<string>>, referenceKey: (id: string) => number): string[] {
  const idSet = new Set(ids);
  const neighborsWithin = (id: string): string[] => [...(linked.get(id) ?? [])].filter((n) => idSet.has(n));

  let hub = ids[0];
  let hubDegree = -1;
  for (const id of [...ids].sort((a, b) => referenceKey(a) - referenceKey(b))) {
    const degree = neighborsWithin(id).length;
    if (degree > hubDegree) {
      hubDegree = degree;
      hub = id;
    }
  }

  const placed = new Set([hub]);
  const left: string[] = [];
  const right: string[] = [];
  const queue: { id: string; side: 'L' | 'R' }[] = [];

  neighborsWithin(hub)
    .sort((a, b) => referenceKey(a) - referenceKey(b))
    .forEach((neighborId, i) => {
      if (placed.has(neighborId)) return;
      placed.add(neighborId);
      queue.push({ id: neighborId, side: i % 2 === 0 ? 'L' : 'R' });
    });

  while (queue.length > 0) {
    const { id, side } = queue.shift()!;
    if (side === 'L') left.unshift(id);
    else right.push(id);

    neighborsWithin(id)
      .filter((n) => !placed.has(n))
      .sort((a, b) => referenceKey(a) - referenceKey(b))
      .forEach((n) => {
        placed.add(n);
        queue.push({ id: n, side });
      });
  }

  const leftover = ids.filter((id) => !placed.has(id));
  return [...left, hub, ...right, ...leftover];
}

export function computeLayout(people: Person[]): LayoutResult {
  const byId = new Map(people.map((p) => [p.id, p]));
  const generations = computeGenerations(people);
  const linkedIds = getLinkedIds(people);
  const maxGen = people.length === 0 ? 0 : Math.max(...people.map((p) => generations.get(p.id) ?? 0));

  const slots = new Map<string, number>();
  let previousLevelSlot = new Map<string, number>();

  for (let g = 0; g <= maxGen; g++) {
    const levelPeople = people.filter((p) => generations.get(p.id) === g);
    const levelIds = new Set(levelPeople.map((p) => p.id));

    // A person's position from their own parents' placement, when known — this is the
    // reliable signal for where their whole partnership cluster belongs in the row.
    const lineageKey = (id: string): number | null => {
      const validParents = (byId.get(id)?.parentIds ?? []).filter((pid) => previousLevelSlot.has(pid));
      if (validParents.length === 0) return null;
      return validParents.reduce((sum, pid) => sum + previousLevelSlot.get(pid)!, 0) / validParents.length;
    };

    const sortKey = (id: string): number => {
      if (g === 0) return people.findIndex((p) => p.id === id);
      const known = lineageKey(id);
      if (known !== null) return known;
      return 1000 + people.findIndex((p) => p.id === id); // no known parent placed: push to the end, stable by original order
    };

    // A cluster's row position should follow whichever members actually descend from
    // the row above (their lineageKey), not a plain average with partners who married
    // in from outside the tree — those carry a large "push to the end" sentinel that
    // would otherwise drag the whole cluster to the wrong spot in the row.
    const clusterPositionKey = (members: string[]): number => {
      const lineageKeys = members.map(lineageKey).filter((k): k is number => k !== null);
      if (lineageKeys.length > 0) {
        return lineageKeys.reduce((sum, k) => sum + k, 0) / lineageKeys.length;
      }
      return members.reduce((sum, id) => sum + sortKey(id), 0) / members.length;
    };

    // Group same-generation people into connected clusters of partners/co-parents,
    // so someone with children by several partners lands with all of them instead
    // of being scattered across the row with unrelated families in between.
    const visited = new Set<string>();
    const clusters: string[][] = [];
    for (const p of levelPeople) {
      if (visited.has(p.id)) continue;
      const stack = [p.id];
      visited.add(p.id);
      const members: string[] = [];
      while (stack.length > 0) {
        const current = stack.pop()!;
        members.push(current);
        for (const neighborId of linkedIds.get(current) ?? []) {
          if (levelIds.has(neighborId) && !visited.has(neighborId)) {
            visited.add(neighborId);
            stack.push(neighborId);
          }
        }
      }
      clusters.push(members);
    }

    const orderedClusters = clusters
      .map((members) => (members.length === 1 ? members : buildClusterOrder(members, linkedIds, sortKey)))
      .map((members) => ({ members, avgKey: clusterPositionKey(members) }))
      .sort((a, b) => a.avgKey - b.avgKey);

    const ordered: Person[] = orderedClusters.flatMap(({ members }) => members.map((id) => byId.get(id)!));

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
