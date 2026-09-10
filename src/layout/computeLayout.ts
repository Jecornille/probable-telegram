import type { Person, PositionedPerson } from '../types';

export const COL_WIDTH = 250;
export const ROW_HEIGHT = 210;
export const NODE_WIDTH = 170;
export const NODE_HEIGHT = 100;

export interface FamilyGroup {
  key: string;
  parentIds: string[];
  childIds: string[];
  /** Index used to pick a connector color, so distinct family units stay visually
   *  distinguishable from each other where their lines run close together or cross. */
  colorIndex: number;
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

/**
 * Generation (row) for every person: 0 for someone with no known parents,
 * otherwise one more than the deepest known parent. Partners and co-parents
 * are additionally pulled onto the same generation as each other, since a
 * couple has to sit on the same row for their connectors to line up.
 *
 * This has to be solved as a single fixed-point relaxation rather than
 * "compute each person's generation from their parents, then equalize
 * partners" as two separate passes: equalizing a person with a
 * deep-lineage partner can push their generation up, and if that person
 * has *another* child by a *different*, shallower co-parent, that
 * co-parent (and thus the shared child) also needs to move — which a
 * single equalize pass after the fact would miss, leaving a child's
 * generation stale (sometimes shallower than its own parent).
 */
function computeGenerations(people: Person[]): Map<string, number> {
  const byId = new Map(people.map((p) => [p.id, p]));
  const gen = new Map<string, number>(people.map((p) => [p.id, 0]));
  const coParentPairs = getCoParentPairs(people);

  const raise = (id: string, value: number): boolean => {
    if ((gen.get(id) ?? 0) < value) {
      gen.set(id, value);
      return true;
    }
    return false;
  };

  let changed = true;
  let guard = 0;
  const maxGuard = people.length * 4 + 20;
  while (changed && guard < maxGuard) {
    changed = false;
    guard++;

    for (const p of people) {
      const validParents = p.parentIds.filter((pid) => byId.has(pid) && pid !== p.id);
      if (validParents.length === 0) continue;
      const required = 1 + Math.max(...validParents.map((pid) => gen.get(pid) ?? 0));
      if (raise(p.id, required)) changed = true;
    }

    for (const p of people) {
      for (const partnerId of p.partnerIds) {
        if (!byId.has(partnerId)) continue;
        const target = Math.max(gen.get(p.id) ?? 0, gen.get(partnerId) ?? 0);
        if (raise(p.id, target) || raise(partnerId, target)) changed = true;
      }
    }
    for (const [a, b] of coParentPairs) {
      const target = Math.max(gen.get(a) ?? 0, gen.get(b) ?? 0);
      if (raise(a, target) || raise(b, target)) changed = true;
    }
  }

  return gen;
}

/** parentId -> ids of their children who are in the dataset. */
function getChildrenMap(people: Person[]): Map<string, string[]> {
  const byId = new Map(people.map((p) => [p.id, p]));
  const map = new Map<string, string[]>();
  for (const p of people) {
    for (const parentId of p.parentIds) {
      if (!byId.has(parentId)) continue;
      if (!map.has(parentId)) map.set(parentId, []);
      map.get(parentId)!.push(p.id);
    }
  }
  return map;
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

/**
 * Orders every generation's people left-to-right, trying to minimize how much
 * parent-child connectors cross each other.
 *
 * Same-generation partners/co-parents are first grouped into clusters (see
 * `buildClusterOrder`) that always stay together. Clusters are then ordered
 * with the classic layered-graph-drawing "barycenter" heuristic: repeatedly
 * sweep top-to-bottom (position each row by the average position of its
 * members' parents) and bottom-to-top (position each row by the average
 * position of its members' children), a few times over. A single top-down
 * pass — the previous approach — only ever looks at the row directly above,
 * so it can't resolve a layout that only becomes untangled by also
 * considering a family's *children*; alternating sweeps let a row's position
 * settle based on the whole tree, not just its immediate parents.
 */
function computeOrder(
  people: Person[],
  generations: Map<string, number>,
  linkedIds: Map<string, Set<string>>,
  maxGen: number,
): Map<string, number> {
  const byId = new Map(people.map((p) => [p.id, p]));
  const childrenMap = getChildrenMap(people);
  const originalIndex = (id: string): number => people.findIndex((p) => p.id === id);

  const clustersByGen: string[][][] = [];
  for (let g = 0; g <= maxGen; g++) {
    const levelPeople = people.filter((p) => generations.get(p.id) === g);
    const levelIds = new Set(levelPeople.map((p) => p.id));
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
      clusters.push(members.length === 1 ? members : buildClusterOrder(members, linkedIds, originalIndex));
    }
    // Initial order: stable, deterministic, and a reasonable starting point for the sweeps.
    clusters.sort((a, b) => originalIndex(a[0]) - originalIndex(b[0]));
    clustersByGen.push(clusters);
  }

  const positionOf = (g: number): Map<string, number> => {
    const map = new Map<string, number>();
    let idx = 0;
    for (const cluster of clustersByGen[g]) {
      for (const id of cluster) map.set(id, idx++);
    }
    return map;
  };

  const barycenter = (cluster: string[], neighborPos: Map<string, number>, neighborsOf: (id: string) => string[]): number | null => {
    const positions: number[] = [];
    for (const id of cluster) {
      for (const neighborId of neighborsOf(id)) {
        const pos = neighborPos.get(neighborId);
        if (pos !== undefined) positions.push(pos);
      }
    }
    if (positions.length === 0) return null;
    return positions.reduce((sum, pos) => sum + pos, 0) / positions.length;
  };

  // Reorders generation `g` by the average position of each cluster's neighbors in
  // generation `neighborGen`. A cluster with no such neighbors (e.g. it married in
  // with no known parents, during a downward sweep) keeps its current relative spot,
  // rescaled to the neighbor row's width, instead of being shoved to one side.
  const reorder = (g: number, neighborGen: number, neighborsOf: (id: string) => string[]) => {
    const neighborPos = positionOf(neighborGen);
    const neighborSize = clustersByGen[neighborGen].length;
    const size = clustersByGen[g].length;
    const keyed = clustersByGen[g].map((cluster, i) => {
      const key = barycenter(cluster, neighborPos, neighborsOf);
      const fallback = size > 1 && neighborSize > 0 ? (i / (size - 1)) * Math.max(0, neighborSize - 1) : 0;
      return { cluster, key: key ?? fallback };
    });
    keyed.sort((a, b) => a.key - b.key);
    clustersByGen[g] = keyed.map((k) => k.cluster);
  };

  const parentsOf = (id: string): string[] => (byId.get(id)?.parentIds ?? []).filter((pid) => byId.has(pid));
  const childrenOf = (id: string): string[] => childrenMap.get(id) ?? [];

  const SWEEPS = 4;
  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    for (let g = 1; g <= maxGen; g++) reorder(g, g - 1, parentsOf);
    for (let g = maxGen - 1; g >= 0; g--) reorder(g, g + 1, childrenOf);
  }

  const slots = new Map<string, number>();
  for (let g = 0; g <= maxGen; g++) {
    let idx = 0;
    for (const cluster of clustersByGen[g]) {
      for (const id of cluster) slots.set(id, idx++);
    }
  }
  return slots;
}

export function computeLayout(people: Person[]): LayoutResult {
  const generations = computeGenerations(people);
  const linkedIds = getLinkedIds(people);
  const maxGen = people.length === 0 ? 0 : Math.max(...people.map((p) => generations.get(p.id) ?? 0));
  const slots = computeOrder(people, generations, linkedIds, maxGen);

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

  const familyMap = new Map<string, Omit<FamilyGroup, 'colorIndex'>>();
  for (const p of positioned) {
    const validParents = p.parentIds.filter((pid) => positionedById.has(pid));
    if (validParents.length === 0) continue;
    const key = [...validParents].sort().join('|');
    if (!familyMap.has(key)) {
      familyMap.set(key, { key, parentIds: validParents, childIds: [] });
    }
    familyMap.get(key)!.childIds.push(p.id);
  }

  // Assign colors left-to-right so the ordering is stable and deterministic.
  const families: FamilyGroup[] = [...familyMap.values()]
    .sort((a, b) => Math.min(...a.parentIds.map((id) => positionedById.get(id)!.x)) - Math.min(...b.parentIds.map((id) => positionedById.get(id)!.x)))
    .map((family, colorIndex) => ({ ...family, colorIndex }));

  const width = positioned.length === 0 ? 0 : Math.max(...positioned.map((p) => p.x)) + NODE_WIDTH;
  const height = positioned.length === 0 ? 0 : Math.max(...positioned.map((p) => p.y)) + NODE_HEIGHT;

  return {
    people: positioned,
    byId: positionedById,
    partnerLinks,
    families,
    width,
    height,
  };
}
