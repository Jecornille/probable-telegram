import type { Person } from '../types';

/**
 * The set of person ids relevant when the tree is centered on `focusId`:
 * the person themselves, all their ancestors, all their descendants, their
 * full/half-siblings, and — so every displayed couple still renders
 * correctly — the partners and co-parents of everyone in that set.
 *
 * Aunts, uncles, and cousins are deliberately left out: the point of
 * focusing is to cut a large, tangled tree down to the one line that
 * matters, not to reproduce the whole thing minus a few branches.
 */
export function computeFocusSubset(people: Person[], focusId: string): Set<string> {
  const byId = new Map(people.map((p) => [p.id, p]));
  if (!byId.has(focusId)) return new Set(people.map((p) => p.id));

  const childrenOf = new Map<string, string[]>();
  for (const p of people) {
    for (const parentId of p.parentIds) {
      if (!byId.has(parentId)) continue;
      if (!childrenOf.has(parentId)) childrenOf.set(parentId, []);
      childrenOf.get(parentId)!.push(p.id);
    }
  }

  const included = new Set<string>([focusId]);

  const upQueue = [focusId];
  while (upQueue.length > 0) {
    const id = upQueue.shift()!;
    for (const parentId of byId.get(id)?.parentIds ?? []) {
      if (byId.has(parentId) && !included.has(parentId)) {
        included.add(parentId);
        upQueue.push(parentId);
      }
    }
  }

  const downQueue = [focusId];
  while (downQueue.length > 0) {
    const id = downQueue.shift()!;
    for (const childId of childrenOf.get(id) ?? []) {
      if (!included.has(childId)) {
        included.add(childId);
        downQueue.push(childId);
      }
    }
  }

  for (const parentId of byId.get(focusId)?.parentIds ?? []) {
    for (const siblingId of childrenOf.get(parentId) ?? []) {
      included.add(siblingId);
    }
  }

  // Pull in partners and co-parents of everyone gathered so far, so a
  // displayed child's other parent (or a displayed person's spouse) is
  // always present too — otherwise their connector has nothing to anchor to.
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...included]) {
      const person = byId.get(id);
      for (const partnerId of person?.partnerIds ?? []) {
        if (byId.has(partnerId) && !included.has(partnerId)) {
          included.add(partnerId);
          changed = true;
        }
      }
      for (const parentId of person?.parentIds ?? []) {
        if (byId.has(parentId) && !included.has(parentId)) {
          included.add(parentId);
          changed = true;
        }
      }
    }
  }

  return included;
}
