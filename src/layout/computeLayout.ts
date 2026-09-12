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
 *
 * A person with no recorded parents, no partner/co-parent link, and no
 * children of their own has nothing to anchor their row to, so they'd
 * otherwise always land on row 0 — even someone clearly born decades after
 * the tree's actual earliest generation. As a last-resort tie-breaker for
 * exactly those fully-isolated people, their birth year is compared against
 * the average birth year of each already-anchored row, and they're placed
 * on whichever row fits best. This never overrides an actual relationship:
 * anyone with a parent, partner, co-parent, or child link keeps the row
 * that comes from that (a childless root ancestor stays on row 0 on
 * purpose — that's a real, correct position, not a fallback).
 */
function computeGenerations(people: Person[], linkedIds: Map<string, Set<string>>): Map<string, number> {
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

  const parentIdsInUse = new Set(people.flatMap((p) => p.parentIds));
  const isIsolated = (p: Person) =>
    p.parentIds.length === 0 && (linkedIds.get(p.id)?.size ?? 0) === 0 && !parentIdsInUse.has(p.id);

  const birthYearSumByGen = new Map<number, { sum: number; count: number }>();
  for (const p of people) {
    if (isIsolated(p) || p.birthYear === undefined) continue;
    const g = gen.get(p.id) ?? 0;
    const entry = birthYearSumByGen.get(g) ?? { sum: 0, count: 0 };
    entry.sum += p.birthYear;
    entry.count += 1;
    birthYearSumByGen.set(g, entry);
  }
  const avgBirthYearByGen = [...birthYearSumByGen.entries()].map(([g, { sum, count }]) => [g, sum / count] as const);

  if (avgBirthYearByGen.length > 0) {
    for (const p of people) {
      if (!isIsolated(p) || p.birthYear === undefined) continue;
      let bestGen = avgBirthYearByGen[0][0];
      let bestDiff = Math.abs(avgBirthYearByGen[0][1] - p.birthYear);
      for (const [g, avgYear] of avgBirthYearByGen) {
        const diff = Math.abs(avgYear - p.birthYear);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestGen = g;
        }
      }
      gen.set(p.id, bestGen);
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
 * pass only ever looks at the row directly above, so it can't resolve a
 * layout that only becomes untangled by also considering a family's
 * *children*; alternating sweeps let a row's position settle based on the
 * whole tree, not just its immediate parents.
 *
 * This only determines left-to-right *order* — see `assignCoordinates` for
 * turning that into actual, parent-aligned pixel positions.
 */
function computeClusterOrder(
  people: Person[],
  generations: Map<string, number>,
  linkedIds: Map<string, Set<string>>,
  childrenMap: Map<string, string[]>,
  maxGen: number,
): string[][][] {
  const byId = new Map(people.map((p) => [p.id, p]));
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

  // Barycenter sweeps are a good global heuristic but can still leave two
  // adjacent clusters in the wrong relative order — a local optimum the
  // averaging can't see past. This is the classic Sugiyama "transpose" pass:
  // for every adjacent pair in every row, actually count how many connector
  // crossings each of the two orderings produces against the rows directly
  // above and below, and swap whenever that's strictly fewer. Repeated to a
  // fixed point (bounded), this mops up residual crossings the sweeps missed
  // — the effect that matters most on a smaller, focused view, where a
  // single bad swap is a much larger fraction of the whole picture.
  const crossingsBetween = (leftPositions: number[], rightPositions: number[]): number => {
    let count = 0;
    for (const a of leftPositions) {
      for (const b of rightPositions) {
        if (a > b) count++;
      }
    }
    return count;
  };

  const positionsInRow = (cluster: string[], neighborPos: Map<string, number>, neighborsOf: (id: string) => string[]): number[] => {
    const positions: number[] = [];
    for (const id of cluster) {
      for (const neighborId of neighborsOf(id)) {
        const pos = neighborPos.get(neighborId);
        if (pos !== undefined) positions.push(pos);
      }
    }
    return positions;
  };

  const transposeOnce = (): boolean => {
    let improved = false;
    for (let g = 0; g <= maxGen; g++) {
      const aboveNeighborPos = g > 0 ? positionOf(g - 1) : null;
      const belowNeighborPos = g < maxGen ? positionOf(g + 1) : null;
      const row = clustersByGen[g];
      for (let i = 0; i < row.length - 1; i++) {
        const left = row[i];
        const right = row[i + 1];

        const leftAbove = aboveNeighborPos ? positionsInRow(left, aboveNeighborPos, parentsOf) : [];
        const rightAbove = aboveNeighborPos ? positionsInRow(right, aboveNeighborPos, parentsOf) : [];
        const leftBelow = belowNeighborPos ? positionsInRow(left, belowNeighborPos, childrenOf) : [];
        const rightBelow = belowNeighborPos ? positionsInRow(right, belowNeighborPos, childrenOf) : [];

        const current = crossingsBetween(leftAbove, rightAbove) + crossingsBetween(leftBelow, rightBelow);
        const swapped = crossingsBetween(rightAbove, leftAbove) + crossingsBetween(rightBelow, leftBelow);

        if (swapped < current) {
          row[i] = right;
          row[i + 1] = left;
          improved = true;
        }
      }
    }
    return improved;
  };

  const MAX_TRANSPOSE_PASSES = 8;
  for (let pass = 0; pass < MAX_TRANSPOSE_PASSES; pass++) {
    if (!transposeOnce()) break;
  }

  return clustersByGen;
}

/**
 * Turns a left-to-right cluster order into actual pixel x positions, trying to
 * center each cluster under (or over) the average position of its parents and
 * children rather than just packing everyone into fixed grid columns —
 * otherwise an only child never lines up under its parents, and a small
 * family always hugs the left edge of the row instead of sitting under
 * where its relatives actually are.
 *
 * Same idea as `computeClusterOrder`: alternating top-down/bottom-up sweeps,
 * each one nudging every cluster toward the average position of its
 * neighbors in the adjacent row. A cluster's own width (it may hold several
 * people) is respected as a minimum gap from its neighbors on the same row,
 * resolved with a left-to-right and a right-to-left pass averaged together
 * so a clash on one side doesn't just push everything toward the other.
 */
function assignCoordinates(
  clustersByGen: string[][][],
  maxGen: number,
  parentsOf: (id: string) => string[],
  childrenOf: (id: string) => string[],
): Map<string, number> {
  const widths: number[][] = clustersByGen.map((clusters) => clusters.map((c) => c.length));

  // Initial centers: simply packed left-to-right, matching cluster widths.
  const centers: number[][] = clustersByGen.map((clusters, g) => {
    const row: number[] = [];
    let cursor = 0;
    for (let i = 0; i < clusters.length; i++) {
      row.push(cursor + widths[g][i] / 2);
      cursor += widths[g][i];
    }
    return row;
  });

  const personCenterOf = (g: number): Map<string, number> => {
    const map = new Map<string, number>();
    clustersByGen[g].forEach((cluster, i) => {
      for (const id of cluster) map.set(id, centers[g][i]);
    });
    return map;
  };

  const desiredCenters = (g: number, neighborGen: number, neighborsOf: (id: string) => string[]): number[] => {
    const neighborPos = personCenterOf(neighborGen);
    return clustersByGen[g].map((cluster, i) => {
      const positions: number[] = [];
      for (const id of cluster) {
        for (const neighborId of neighborsOf(id)) {
          const pos = neighborPos.get(neighborId);
          if (pos !== undefined) positions.push(pos);
        }
      }
      return positions.length > 0 ? positions.reduce((sum, pos) => sum + pos, 0) / positions.length : centers[g][i];
    });
  };

  // Resolves desired centers into ones that respect a minimum gap (half of each
  // neighbor pair's combined width) between consecutive clusters, run once
  // left-to-right and once right-to-left, then averaged.
  const resolve = (g: number, desired: number[]): number[] => {
    const w = widths[g];
    const n = desired.length;
    if (n === 0) return desired;

    const leftToRight = [...desired];
    for (let i = 1; i < n; i++) {
      const minGap = (w[i - 1] + w[i]) / 2;
      leftToRight[i] = Math.max(leftToRight[i], leftToRight[i - 1] + minGap);
    }

    const rightToLeft = [...desired];
    for (let i = n - 2; i >= 0; i--) {
      const minGap = (w[i] + w[i + 1]) / 2;
      rightToLeft[i] = Math.min(rightToLeft[i], rightToLeft[i + 1] - minGap);
    }

    return desired.map((_, i) => (leftToRight[i] + rightToLeft[i]) / 2);
  };

  const SWEEPS = 6;
  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    for (let g = 1; g <= maxGen; g++) centers[g] = resolve(g, desiredCenters(g, g - 1, parentsOf));
    for (let g = maxGen - 1; g >= 0; g--) centers[g] = resolve(g, desiredCenters(g, g + 1, childrenOf));
  }

  let minLeftEdge = 0;
  let any = false;
  for (let g = 0; g <= maxGen; g++) {
    clustersByGen[g].forEach((_, i) => {
      const leftEdge = centers[g][i] - widths[g][i] / 2;
      if (!any || leftEdge < minLeftEdge) {
        minLeftEdge = leftEdge;
        any = true;
      }
    });
  }

  const positions = new Map<string, number>();
  for (let g = 0; g <= maxGen; g++) {
    clustersByGen[g].forEach((cluster, i) => {
      const leftEdge = centers[g][i] - widths[g][i] / 2 - minLeftEdge;
      cluster.forEach((id, localIndex) => {
        positions.set(id, (leftEdge + localIndex) * COL_WIDTH);
      });
    });
  }
  return positions;
}

export function computeLayout(people: Person[]): LayoutResult {
  const byId = new Map(people.map((p) => [p.id, p]));
  const linkedIds = getLinkedIds(people);
  const generations = computeGenerations(people, linkedIds);
  const maxGen = people.length === 0 ? 0 : Math.max(...people.map((p) => generations.get(p.id) ?? 0));
  const childrenMap = getChildrenMap(people);

  const clustersByGen = computeClusterOrder(people, generations, linkedIds, childrenMap, maxGen);
  const parentsOf = (id: string): string[] => (byId.get(id)?.parentIds ?? []).filter((pid) => byId.has(pid));
  const childrenOf = (id: string): string[] => childrenMap.get(id) ?? [];
  const xPositions = assignCoordinates(clustersByGen, maxGen, parentsOf, childrenOf);

  const rawPositioned = people.map((p) => ({
    ...p,
    generation: generations.get(p.id) ?? 0,
    slot: Math.round((xPositions.get(p.id) ?? 0) / COL_WIDTH),
    x: (xPositions.get(p.id) ?? 0) + (p.offsetX ?? 0),
    y: (generations.get(p.id) ?? 0) * ROW_HEIGHT + (p.offsetY ?? 0),
  }));

  // A manual drag can push someone's x/y below 0 (the auto-layout itself never
  // does). The SVG canvas starts at (0, 0) and clips anything before that, so
  // re-anchor the whole diagram — shifting every person together, not just the
  // dragged one — to keep the leftmost/topmost position at 0 and everyone on
  // screen, the same way scrolling a document doesn't change where things sit
  // relative to each other.
  const minX = rawPositioned.length === 0 ? 0 : Math.min(0, ...rawPositioned.map((p) => p.x));
  const minY = rawPositioned.length === 0 ? 0 : Math.min(0, ...rawPositioned.map((p) => p.y));
  const positioned: PositionedPerson[] = rawPositioned.map((p) => ({ ...p, x: p.x - minX, y: p.y - minY }));

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
