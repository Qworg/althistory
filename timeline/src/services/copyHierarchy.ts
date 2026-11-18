/** Where an arc stands in the hierarchy of a copy that did not take every arc. */
export interface ArcPlacement {
  parent: string | null;
  level: number;
}

/**
 * The arcs of a partial copy whose place changes (#35).
 *
 * An arc whose parent was not copied would name an arc the copy does not hold, and the copy's own
 * export would be refused on import (`ORPHAN_REFERENCE`). Such an arc becomes a top-level arc (no
 * parent, level 0), and the arcs copied beneath it follow it down: each takes its parent's new level
 * plus one. Arcs whose chain to the top is whole are left exactly as they are, so they are not in the
 * result.
 *
 * `arcs`: every arc that was copied, with the parent and level it had in the source.
 */
export function arcPlacementsOfCopy(
  arcs: ReadonlyArray<{ id: string; parent: string | null; level: number }>
): Map<string, ArcPlacement> {
  const copied = new Map(arcs.map((arc) => [arc.id, arc]));
  const changed = new Map<string, ArcPlacement>();

  // The arc at the top of an arc's copied chain, and how many steps down from it the arc is. A chain
  // that loops is cut where it returns, so a corrupt source cannot make this run for ever.
  const topOf = (id: string): { top: string; depth: number } => {
    const seen = new Set<string>([id]);
    let current = id;
    let depth = 0;
    for (;;) {
      const parent = copied.get(current)?.parent ?? null;
      if (parent === null || !copied.has(parent) || seen.has(parent)) return { top: current, depth };
      seen.add(parent);
      current = parent;
      depth += 1;
    }
  };

  for (const arc of arcs) {
    const { top, depth } = topOf(arc.id);
    const top_ = copied.get(top);
    const lost = top_ !== undefined && top_.parent !== null && !copied.has(top_.parent);
    if (!lost) continue;
    changed.set(arc.id, { parent: depth === 0 ? null : arc.parent, level: depth });
  }
  return changed;
}
