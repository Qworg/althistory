import type { Container } from '@/container';
import type { EntityChanges } from '@/repositories/VersionRepository';
import type { StoredCausalRelationship } from './CausalService';
import type { CopyPlan } from './GraphCopyService';
import { arcPlacementsOfCopy } from './copyHierarchy';

/**
 * Give a copied graph the version a branch gets (#35): the source's version head, recorded as
 * the copy's first version, before the live store is written.
 *
 * A branch commits `checkout(source)` as one `branch` version. A copy takes the same head, so what
 * the copy's history holds is what the source's holds, to the field: `parent_arc_id`, `sourceRef`,
 * a link at weight 0, a link to another graph's event. Rebuilding it from the live store lost
 * those, because the live store keeps less than the version store does. A full copy takes the
 * whole head; a time-range or filtered copy takes the head limited to the ids that were copied
 * (`selected`), and a link only when both its events are among them. An arc whose parent was not
 * copied is made a top-level arc (see `arcPlacementsOfCopy`); the plan returned says so, for the
 * live copy to follow.
 *
 * Done first, so a copy that cannot be versioned has written nothing to the live store, and the
 * caller can remove the empty graph. Pressures are not versioned: a copy gives them new ids and
 * the inference recomputes them.
 *
 * A source with no head but with live nodes (data that predates versions, adopted at startup) has
 * nothing to take a head from: the copy is versioned from the selected live nodes instead, so a
 * later edit and rollback do not drop them. A live store that has merely drifted from a head it
 * does have is the source's own inconsistency, and the copy follows the head, as a branch does.
 */
export async function versionCopyFromHead(
  container: Pick<Container, 'graphRepository' | 'graphScopedRepositories' | 'graphWriteVersioningService'>,
  sourceGraphId: string,
  targetGraphId: string,
  sourceName: string,
  selected: ReadonlySet<string> | null
): Promise<CopyPlan> {
  const head = await container.graphRepository.checkout(sourceGraphId);
  const headIsEmpty =
    Object.keys(head.events).length + Object.keys(head.arcs).length + Object.keys(head.relationships).length === 0;
  if (headIsEmpty) return versionFromLiveNodes(container, sourceGraphId, targetGraphId, sourceName, selected);

  const keep = (id: string): boolean => selected === null || selected.has(id);
  const changes: EntityChanges = { added: [], modified: [], deleted: [] };

  const arcs = Object.entries(head.arcs).filter(([id]) => keep(id));
  const placements = selected === null ? new Map() : arcPlacementsOfCopy(
    arcs.map(([id, data]) => ({ id, parent: headParent(data), level: Number(data.level) || 0 }))
  );

  for (const [id, data] of Object.entries(head.events)) {
    if (keep(id)) changes.added.push({ type: 'event', id, data });
  }
  for (const [id, data] of arcs) {
    const placement = placements.get(id);
    if (!placement) {
      changes.added.push({ type: 'arc', id, data });
      continue;
    }
    const metadata = { ...((data.metadata as Record<string, unknown> | undefined) ?? {}), parentArcId: placement.parent };
    changes.added.push({ type: 'arc', id, data: { ...data, parent_arc_id: placement.parent, metadata, level: placement.level } });
  }
  for (const [id, data] of Object.entries(head.relationships)) {
    const cause = String(data.cause_event_id);
    const effect = String(data.effect_event_id);
    if (selected === null || (selected.has(cause) && selected.has(effect))) {
      changes.added.push({ type: 'relationship', id, data });
    }
  }

  if (changes.added.length > 0) {
    await container.graphRepository.commitChanges(targetGraphId, changes, 'branch', `Copied from ${sourceName}`);
  }
  return { arcs: placements };
}

function headParent(data: Record<string, unknown>): string | null {
  if (typeof data.parent_arc_id === 'string') return data.parent_arc_id;
  const fromMetadata = (data.metadata as Record<string, unknown> | undefined)?.parentArcId;
  return typeof fromMetadata === 'string' ? fromMetadata : null;
}

/** The copy's version, built from the source's selected live nodes, for a source that has no head. */
async function versionFromLiveNodes(
  container: Pick<Container, 'graphScopedRepositories' | 'graphWriteVersioningService'>,
  sourceGraphId: string,
  targetGraphId: string,
  sourceName: string,
  selected: ReadonlySet<string> | null
): Promise<CopyPlan> {
  const { eventRepository, arcRepository, causalService } = await container.graphScopedRepositories(sourceGraphId);
  const [allEvents, allArcs, allLinks] = await Promise.all([
    eventRepository.findAll(),
    arcRepository.findAll(),
    causalService.getAllRelationships(),
  ]);
  const keep = (id: string): boolean => selected === null || selected.has(id);
  const events = allEvents.filter((event) => keep(event.id));
  const arcs = allArcs.filter((arc) => keep(arc.id));
  const links = allLinks.filter((link) => selected === null || (selected.has(link.cause_event_id) && selected.has(link.effect_event_id)));
  if (events.length + arcs.length + links.length === 0) return {};

  const parentOf = (arc: { metadata?: Record<string, unknown> }): string | null => {
    const parent = arc.metadata?.parentArcId;
    return typeof parent === 'string' ? parent : null;
  };
  const placements = selected === null ? new Map() : arcPlacementsOfCopy(arcs.map((arc) => ({ id: arc.id, parent: parentOf(arc), level: arc.level })));
  for (const arc of arcs) {
    const placement = placements.get(arc.id);
    // A fresh object from the repository, so the version records the level the copy will have.
    if (placement) (arc as { level: number }).level = placement.level;
  }

  const pairs = new Map<string, { cause_event_id: string; effect_event_id: string; live: StoredCausalRelationship[] }>();
  for (const link of links) {
    const key = `${link.cause_event_id}\u0000${link.effect_event_id}`;
    const pair = pairs.get(key) ?? { cause_event_id: link.cause_event_id, effect_event_id: link.effect_event_id, live: [] };
    pair.live.push(link as StoredCausalRelationship);
    pairs.set(key, pair);
  }

  await container.graphWriteVersioningService.recordBatch(
    targetGraphId,
    {
      events: new Map(events.map((event) => [event.id, event])),
      arcs: new Map(arcs.map((arc) => [arc.id, arc])),
      links: [...pairs.values()],
      parents: new Map(arcs.map((arc) => [arc.id, placements.has(arc.id) ? placements.get(arc.id).parent : parentOf(arc)] as const)),
    },
    [],
    { announceIfNotVersioned: false, summary: `Copied from ${sourceName}` }
  );
  return { arcs: placements };
}
